import { LedgerTransaction, type LedgerTransactionTypes } from '@midnight-ntwrk/midnight-js-types';
import { CostModel, type ProvingProvider, Transaction } from '@midnightntwrk/ledger-v9';
import { ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it, vi } from 'vitest';
import {
  adoptForLedger9Wallet,
  adoptLedger9Bytes,
  decodeLedger9Transaction,
  PREVIEW_PROVIDER_CONFIG,
  requireLedger9Handle,
  restoreLedger9Transaction,
  sealLedger9Transaction,
  serializeLedger9Transaction,
} from './transaction-boundary.js';

// Empty transactions invoke no circuits. This exercises actual ledger serialization,
// not contract proofs, funds, a node, or a fake claim of successful voting.
const inertProver: ProvingProvider = {
  check: () => Promise.resolve([]),
  prove: () => Promise.resolve(new Uint8Array()),
  lookupKey: () => Promise.resolve(undefined),
};

async function fixtures() {
  const unproven = Transaction.fromParts('preview');
  const unbound = await unproven.prove(inertProver, CostModel.initialCostModel());
  return { unproven, unbound, finalized: unbound.bind() };
}

describe('real Ledger 9 transaction boundary', () => {
  it('uses the explicit Preview-only provider configuration expected by Midnight.js 5', () => {
    expect(PREVIEW_PROVIDER_CONFIG).toEqual({ networkId: 'preview', ttlSeconds: 3600 });
    expect(Object.isFrozen(PREVIEW_PROVIDER_CONFIG)).toBe(true);
  });

  it('round-trips a real transaction at each stage with the caller ledger copy', async () => {
    const { unproven, unbound, finalized } = await fixtures();
    const entries = [
      ['Unproven', unproven],
      ['Unbound', unbound],
      ['Finalized', finalized],
    ] as const;
    for (const [stage, transaction] of entries) {
      const handle = sealLedger9Transaction(stage, transaction);
      const restored = restoreLedger9Transaction(
        structuredClone(serializeLedger9Transaction(handle)),
        stage,
      );
      expect(restored.era).toBe('v9');
      expect(restored.stage).toBe(stage);
      expect(decodeLedger9Transaction(restored).serialize()).toEqual(transaction.serialize());
    }
    const typed: LedgerTransactionTypes['v9']['Unproven'] = decodeLedger9Transaction(
      sealLedger9Transaction('Unproven', unproven),
    );
    expect(typed.serialize()).toEqual(unproven.serialize());
  });

  it('copies bytes across a process boundary so callers cannot mutate the original handle', () => {
    const handle = sealLedger9Transaction('Unproven', Transaction.fromParts('preview'));
    const before = handle.serialize();
    const envelope = serializeLedger9Transaction(handle);
    const restored = restoreLedger9Transaction(envelope, 'Unproven');
    envelope.bytes.fill(0);
    expect(handle.serialize()).toEqual(before);
    expect(restored.serialize()).toEqual(before);
  });

  it('rejects an envelope relabelled with another era or stage', () => {
    const handle = sealLedger9Transaction('Unproven', Transaction.fromParts('preview'));
    const envelope = serializeLedger9Transaction(handle);
    expect(() => restoreLedger9Transaction({ ...envelope, era: 'v8' }, 'Unproven')).toThrow(
      'wrong-era',
    );
    expect(() => restoreLedger9Transaction(envelope, 'Finalized')).toThrow('wrong-stage');
    expect(() => adoptLedger9Bytes(envelope.bytes, 'Finalized')).toThrow();
  });

  it('rejects header-shaped payloads that Midnight.js alone cannot fully validate', () => {
    const bytes = Transaction.fromParts('preview').serialize();
    const truncated = bytes.subarray(0, bytes.length - 1);
    expect(LedgerTransaction.fromBytes('v9', 'Unproven', truncated).era).toBe('v9');
    expect(() => adoptLedger9Bytes(truncated, 'Unproven')).toThrow();
  });

  it('rejects plain objects, JSON bytes and cloned handles instead of treating them as transactions', () => {
    const handle = sealLedger9Transaction('Unproven', Transaction.fromParts('preview'));
    expect(() =>
      requireLedger9Handle(
        { era: 'v9', stage: 'Unproven', serialize: handle.serialize },
        'Unproven',
      ),
    ).toThrow('invalid-handle');
    expect(() => requireLedger9Handle(structuredClone(handle), 'Unproven')).toThrow(
      'invalid-handle',
    );
    expect(() =>
      restoreLedger9Transaction({ era: 'v9', stage: 'Unproven', bytes: [1, 2, 3] }, 'Unproven'),
    ).toThrow('invalid-envelope');
  });

  it('refuses a stage promotion for an existing valid handle', () => {
    const handle = sealLedger9Transaction('Unproven', Transaction.fromParts('preview'));
    expect(() => requireLedger9Handle(handle, 'Finalized')).toThrow('wrong-stage');
  });

  it('hands actual serialized bytes to the wallet and preserves its verified stage', () => {
    const tx = Transaction.fromParts('preview');
    const handle = sealLedger9Transaction('Unproven', tx);
    const called = vi.fn();
    const adoptTransaction = <S extends WalletTransaction.Stage>(bytes: Uint8Array, stage: S) => {
      called(bytes, stage);
      return WalletTransaction.adopt(
        stage,
        { serialize: () => new Uint8Array(bytes) },
        ProtocolVersion.V9NativeForkVersion,
      );
    };
    const adopted = adoptForLedger9Wallet({ adoptTransaction }, handle);
    expect(WalletTransaction.is(adopted)).toBe(true);
    expect(called).toHaveBeenCalledWith(tx.serialize(), 'Unproven');
    expect(adopted.serialize()).toEqual(tx.serialize());
  });

  it('rejects a wallet acting on the old protocol instead of silently restamping transactions', () => {
    const handle = sealLedger9Transaction('Unproven', Transaction.fromParts('preview'));
    const adoptTransaction = <S extends WalletTransaction.Stage>(bytes: Uint8Array, stage: S) =>
      WalletTransaction.adopt(
        stage,
        { serialize: () => new Uint8Array(bytes) },
        ProtocolVersion.ProtocolVersion(1_000_000n),
      );
    expect(() => adoptForLedger9Wallet({ adoptTransaction }, handle)).toThrow('wrong-era');
  });

  it('refuses a wallet response that changes the serialized transaction', () => {
    const handle = sealLedger9Transaction('Unproven', Transaction.fromParts('preview'));
    const adoptTransaction = <S extends WalletTransaction.Stage>(_bytes: Uint8Array, stage: S) =>
      WalletTransaction.adopt(
        stage,
        Transaction.fromParts('undeployed'),
        ProtocolVersion.V9NativeForkVersion,
      );
    expect(() => adoptForLedger9Wallet({ adoptTransaction }, handle)).toThrow('invalid-envelope');
  });
});
