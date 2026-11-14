import {
  LedgerTransaction,
  type LedgerTransactionTypes,
  type MidnightConfig,
  type TransactionStage,
} from '@midnight-ntwrk/midnight-js-types';
import { Transaction } from '@midnightntwrk/ledger-v9';
import type { WalletFacade, WalletTransaction } from '@midnightntwrk/wallet-sdk';

/** The new runtime must never inherit a wallet's mainnet or historical-era configuration. */
export const PREVIEW_PROVIDER_CONFIG = Object.freeze({
  networkId: 'preview',
  ttlSeconds: 3600,
}) satisfies Readonly<MidnightConfig>;

export type Ledger9Handle<S extends TransactionStage> = LedgerTransaction<S, 'v9'>;
export type Ledger9Transaction<S extends TransactionStage> = LedgerTransactionTypes['v9'][S];

/** Plain data for a worker/process boundary; a cloned LedgerTransaction loses its private bytes. */
export interface SerializedLedger9Transaction<S extends TransactionStage> {
  readonly era: 'v9';
  readonly stage: S;
  readonly bytes: Uint8Array;
}

export class TransactionBoundaryError extends Error {
  readonly code = 'MIDNIGHT_VOTE_TRANSACTION_BOUNDARY';

  constructor(
    readonly reason: 'invalid-handle' | 'invalid-envelope' | 'wrong-era' | 'wrong-stage',
  ) {
    super(`Transaction boundary rejected: ${reason}.`);
    this.name = 'TransactionBoundaryError';
  }
}

/**
 * Midnight.js checks a serialized header when constructing a handle. Decode as well:
 * a header with a truncated/corrupt body must not cross our application boundary.
 * Decoding establishes the encoding and stage, not proof validity or chain inclusion.
 */
export function adoptLedger9Bytes<S extends TransactionStage>(
  bytes: Uint8Array,
  stage: S,
): Ledger9Handle<S> {
  const handle = LedgerTransaction.fromBytes('v9', stage, bytes);
  handle.deserialize({ v9: Transaction });
  return handle;
}

export function requireLedger9Handle<S extends TransactionStage>(
  value: unknown,
  stage: S,
): Ledger9Handle<S> {
  if (!LedgerTransaction.isLedgerTransaction(value)) {
    throw new TransactionBoundaryError('invalid-handle');
  }
  if (value.era !== 'v9') throw new TransactionBoundaryError('wrong-era');
  if (value.stage !== stage) throw new TransactionBoundaryError('wrong-stage');
  return adoptLedger9Bytes(value.serialize(), stage);
}

export function sealLedger9Transaction<S extends TransactionStage>(
  stage: S,
  transaction: Ledger9Transaction<S>,
): Ledger9Handle<S> {
  return adoptLedger9Bytes(transaction.serialize(), stage);
}

export function decodeLedger9Transaction<S extends TransactionStage>(
  handle: LedgerTransaction<S>,
): Ledger9Transaction<S> {
  return requireLedger9Handle(handle, handle.stage).deserialize({
    v9: Transaction,
  }) as Ledger9Transaction<S>;
}

export function serializeLedger9Transaction<S extends TransactionStage>(
  handle: LedgerTransaction<S>,
): SerializedLedger9Transaction<S> {
  const checked = requireLedger9Handle(handle, handle.stage);
  return Object.freeze({ era: 'v9', stage: checked.stage, bytes: checked.serialize() });
}

export function restoreLedger9Transaction<S extends TransactionStage>(
  envelope: unknown,
  expectedStage: S,
): Ledger9Handle<S> {
  if (typeof envelope !== 'object' || envelope === null) {
    throw new TransactionBoundaryError('invalid-envelope');
  }
  const record = envelope as Record<string, unknown>;
  if (record.era !== 'v9') throw new TransactionBoundaryError('wrong-era');
  if (record.stage !== expectedStage) throw new TransactionBoundaryError('wrong-stage');
  if (!(record.bytes instanceof Uint8Array)) throw new TransactionBoundaryError('invalid-envelope');
  return adoptLedger9Bytes(record.bytes, expectedStage);
}

/**
 * The wallet chooses its current protocol version at adoption time. Passing bytes
 * avoids sharing WASM objects between the framework's and wallet's ledger copies.
 * Balancing/submission remain the caller's explicit operations.
 */
export function adoptForLedger9Wallet<S extends TransactionStage>(
  wallet: Pick<WalletFacade, 'adoptTransaction'>,
  handle: LedgerTransaction<S>,
): WalletTransaction<S> {
  const checked = requireLedger9Handle(handle, handle.stage);
  const adopted = wallet.adoptTransaction(checked.serialize(), checked.stage);
  if (adopted.protocolVersion < 2_000_000n) throw new TransactionBoundaryError('wrong-era');
  if (adopted.stage !== checked.stage) throw new TransactionBoundaryError('wrong-stage');
  // The wallet must preserve the same transaction, not merely return another valid handle.
  const returned = adopted.serialize();
  const sent = checked.serialize();
  if (returned.length !== sent.length || !returned.every((byte, index) => byte === sent[index])) {
    throw new TransactionBoundaryError('invalid-envelope');
  }
  return adopted;
}
