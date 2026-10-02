import WebSocket from 'ws';

// The wallet SDK's indexer client expects a global WebSocket, which Node does
// not provide in the shape it wants. This must run before the SDK is used.
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  type DefaultConfiguration,
  WalletEntrySchema,
  WalletFacade,
} from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey as UnshieldedPublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { RelayerConfig } from './config.js';
import {
  readWalletSnapshot,
  WALLET_SNAPSHOT_VERSION,
  type WalletSnapshot,
  walletSnapshotOwner,
  writeWalletSnapshot,
} from './wallet-state.js';

export interface RelayerWallet {
  facade: WalletFacade;
  secretKeys: {
    shieldedSecretKeys: ledger.ZswapSecretKeys;
    dustSecretKey: ledger.DustSecretKey;
  };
  /**
   * Needed to sign DUST registration: only the owner of the NIGHT UTXOs can
   * register them, so no other wallet can do it on the relayer's behalf.
   */
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  /**
   * When the state this wallet started from was saved, or null when it started
   * with nothing and has the whole history to replay.
   */
  restoredFrom: string | null;
  /**
   * Saves what the wallet has learned so far, so the next start continues from
   * here. Resolves to false when no state file is configured.
   */
  saveState(): Promise<boolean>;
  stop(): Promise<void>;
}

export interface RelayerWalletOptions {
  /** File that keeps the wallet's state between starts. Omit to keep nothing. */
  statePath?: string;
  log?: (line: string) => void;
}

/** How long a balanced transaction stays valid before the network drops it. */
export const BALANCE_TTL_MS = 60 * 60 * 1000;

export async function startRelayerWallet(
  config: RelayerConfig,
  options: RelayerWalletOptions = {},
): Promise<RelayerWallet> {
  const seed = Buffer.from(config.seedHex, 'hex');
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') {
    throw new Error('RELAYER_SEED could not be turned into an HD wallet.');
  }

  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  // Drop the root key as soon as the three role keys exist, so it does not sit
  // in memory for the lifetime of a long-running server.
  hd.hdWallet.clear();
  if (derived.type !== 'keysDerived') {
    throw new Error('Could not derive the relayer role keys from the seed.');
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);

  const configuration: DefaultConfiguration = {
    networkId: config.networkId,
    // additionalFeeOverhead guards against the node client reporting zeroed
    // ledger parameters after an RPC disconnect: with a zero fee estimate the
    // dust balancer selects no coins and emits an empty intent, which the node
    // rejects as TransactionMalformed(NotNormalized) (custom error 117). The
    // overhead (~2e15 SPECKs ≈ 0.002 DUST, ~5x a castVote fee) keeps the spend
    // list non-empty and the transaction normalized; any excess is change.
    costParameters: { feeBlocksMargin: 5, additionalFeeOverhead: 2_000_000_000_000_000n },
    relayURL: new URL(config.relayUrl),
    provingServerUrl: new URL(config.provingServerUrl),
    indexerClientConnection: {
      indexerHttpUrl: config.indexerHttpUrl,
      indexerWsUrl: config.indexerWsUrl,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
  };

  const unshieldedKeystore = createKeystore(
    derived.keys[Roles.NightExternal],
    configuration.networkId,
  );

  const log = options.log ?? (() => undefined);
  const statePath = options.statePath?.trim() || null;
  // Public values only: they name the wallet without being able to spend from it.
  const owner = walletSnapshotOwner(configuration.networkId, [
    String(shieldedSecretKeys.coinPublicKey),
    String(shieldedSecretKeys.encryptionPublicKey),
    String(unshieldedKeystore.getPublicKey()),
  ]);

  const start = async (from: WalletSnapshot | null): Promise<WalletFacade> => {
    const started = await WalletFacade.init({
      configuration,
      shielded: (cfg) =>
        from
          ? ShieldedWallet(cfg).restore(from.shielded)
          : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
      unshielded: (cfg) =>
        from
          ? UnshieldedWallet(cfg).restore(from.unshielded)
          : UnshieldedWallet(cfg).startWithPublicKey(
              UnshieldedPublicKey.fromKeyStore(unshieldedKeystore),
            ),
      // The dust parameters argument is mandatory; omitting it fails at runtime.
      dust: (cfg) =>
        from
          ? DustWallet(cfg).restore(from.dust)
          : DustWallet(cfg).startWithSecretKey(
              dustSecretKey,
              ledger.LedgerParameters.initialParameters().dust,
            ),
    });
    try {
      await started.start(shieldedSecretKeys, dustSecretKey);
    } catch (error) {
      await started.stop().catch(() => undefined);
      throw error;
    }
    return started;
  };

  const snapshot = statePath
    ? readWalletSnapshot(statePath, { networkId: configuration.networkId, owner })
    : null;
  let facade: WalletFacade;
  let restoredFrom: string | null = null;
  if (snapshot) {
    try {
      facade = await start(snapshot);
      restoredFrom = snapshot.savedAt;
      log(`wallet state restored from ${snapshot.savedAt}`);
    } catch (error) {
      // A state the SDK refuses must never keep the wallet from starting.
      log(`saved wallet state could not be used (${(error as Error).message}); replaying`);
      facade = await start(null);
    }
  } else {
    facade = await start(null);
  }

  const saveState = async (): Promise<boolean> => {
    if (!statePath) return false;
    const [shielded, unshielded, dust] = await Promise.all([
      facade.shielded.serializeState(),
      facade.unshielded.serializeState(),
      facade.dust.serializeState(),
    ]);
    writeWalletSnapshot(statePath, {
      version: WALLET_SNAPSHOT_VERSION,
      networkId: configuration.networkId,
      owner,
      savedAt: new Date().toISOString(),
      shielded,
      unshielded,
      dust,
    });
    return true;
  };

  return {
    facade,
    secretKeys: { shieldedSecretKeys, dustSecretKey },
    unshieldedKeystore,
    restoredFrom,
    saveState,
    stop: () => facade.stop(),
  };
}

/**
 * What `WalletProvider.balanceTx` hands over: proven, but not yet bound. Its
 * binding tag is `embedded-fr`, not the `pedersen-schnorr` of a finalized
 * transaction, so it must be deserialized as PreBinding — reading it as
 * finalized fails with a header-tag mismatch.
 */
export type UnboundTransaction = ledger.Transaction<
  ledger.SignatureEnabled,
  ledger.Proof,
  ledger.PreBinding
>;

/**
 * Balances a proven-but-unfunded transaction against the relayer's own coins
 * and finalizes it, so the citizen never needs NIGHT, DUST, or a wallet.
 *
 * The transaction arrives already proven: the relayer supplies fees, not
 * authority. The referendum contract authorises `castVote` on Merkle
 * membership and the nullifier, never on who submitted it, so paying the fee
 * grants the relayer no power over the ballot.
 */
export async function balanceAndFinalize(
  wallet: RelayerWallet,
  tx: UnboundTransaction,
): Promise<ledger.FinalizedTransaction> {
  const recipe = await wallet.facade.balanceUnboundTransaction(tx, wallet.secretKeys, {
    ttl: new Date(Date.now() + BALANCE_TTL_MS),
  });
  const recipeBalancing = (recipe as { balancingTransaction?: { toString(c?: boolean): string } })
    .balancingTransaction;
  const spendCount = recipeBalancing
    ? (recipeBalancing.toString(true).match(/DustSpend/g) ?? []).length
    : 0;
  console.log(`[relayer] balanced: recipe=${recipe.type} dustSpends=${spendCount}`);
  if (recipeBalancing && spendCount === 0) {
    console.warn(
      '[relayer] WARNING: dust balancing selected no coins — the node will reject this as NotNormalized',
    );
  }
  return wallet.facade.finalizeRecipe(recipe);
}

/** Proven but unbound — what arrives at /balance. */
export function deserializeUnbound(hex: string): UnboundTransaction {
  return ledger.Transaction.deserialize(
    'signature',
    'proof',
    'pre-binding',
    Uint8Array.from(Buffer.from(hex, 'hex')),
  );
}

/** Fully bound — what arrives at /submit. */
export function deserializeFinalized(hex: string): ledger.FinalizedTransaction {
  return ledger.Transaction.deserialize(
    'signature',
    'proof',
    'binding',
    Uint8Array.from(Buffer.from(hex, 'hex')),
  );
}

export function serializeFinalized(tx: ledger.FinalizedTransaction): string {
  return Buffer.from(tx.serialize()).toString('hex');
}
