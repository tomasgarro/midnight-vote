import WebSocket from 'ws';

// The wallet indexer client expects this browser-shaped global in Node.
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  MidnightBech32m,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
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
import type {
  MidnightIssuerRuntimeConfig,
  MidnightIssuerWalletAdapter,
} from './midnight-issuer-runtime.js';
import {
  readWalletSnapshot,
  WALLET_SNAPSHOT_VERSION,
  type WalletSnapshot,
  walletSnapshotOwner,
  writeWalletSnapshot,
} from './wallet-state.js';

/** How often the issuer wallet's state is saved while the service runs. */
const WALLET_STATE_SAVE_INTERVAL_MS = 5 * 60 * 1_000;
/** A stopping container is killed after its grace period; the last save must fit in it. */
const SHUTDOWN_SAVE_LIMIT_MS = 15_000;

/** Production Node wallet adapter for the dedicated Preview credential issuer. */
export async function createMidnightIssuerWalletAdapter(
  config: MidnightIssuerRuntimeConfig,
): Promise<MidnightIssuerWalletAdapter> {
  const walletSeed = Buffer.from(normalizeSecret(config.issuerSeedHex, 'issuerSeedHex'), 'hex');
  const issuerSecret = Uint8Array.from(
    Buffer.from(normalizeSecret(config.issuerRoleSecretHex, 'issuerRoleSecretHex'), 'hex'),
  );
  const hd = HDWallet.fromSeed(walletSeed);
  walletSeed.fill(0);
  if (hd.type !== 'seedOk') {
    issuerSecret.fill(0);
    throw new Error('CICO issuer seed could not be turned into an HD wallet');
  }
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  hd.hdWallet.clear();
  if (derived.type !== 'keysDerived') {
    issuerSecret.fill(0);
    throw new Error('CICO issuer wallet role keys could not be derived');
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const configuration: DefaultConfiguration = {
    networkId: 'preview',
    costParameters: {
      feeBlocksMargin: 5,
      additionalFeeOverhead: 2_000_000_000_000_000n,
    },
    relayURL: new URL(config.relayUrl ?? 'wss://rpc.preview.midnight.network'),
    provingServerUrl: new URL(config.proofServerUrl),
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
  const statePath = config.walletStatePath?.trim() || null;
  // Public values only: they name the wallet without being able to spend from it.
  const owner = walletSnapshotOwner(configuration.networkId, [
    String(shieldedSecretKeys.coinPublicKey),
    String(shieldedSecretKeys.encryptionPublicKey),
    String(unshieldedKeystore.getPublicKey()),
  ]);
  const initialize = (from: WalletSnapshot | null): Promise<WalletFacade> =>
    WalletFacade.init({
      configuration,
      shielded: (walletConfig) =>
        from
          ? ShieldedWallet(walletConfig).restore(from.shielded)
          : ShieldedWallet(walletConfig).startWithSecretKeys(shieldedSecretKeys),
      unshielded: (walletConfig) =>
        from
          ? UnshieldedWallet(walletConfig).restore(from.unshielded)
          : UnshieldedWallet(walletConfig).startWithPublicKey(
              UnshieldedPublicKey.fromKeyStore(unshieldedKeystore),
            ),
      dust: (walletConfig) =>
        from
          ? DustWallet(walletConfig).restore(from.dust)
          : DustWallet(walletConfig).startWithSecretKey(
              dustSecretKey,
              ledger.LedgerParameters.initialParameters().dust,
            ),
    });

  const snapshot = statePath
    ? readWalletSnapshot(statePath, { networkId: configuration.networkId, owner })
    : null;
  let restored = false;
  let facade: WalletFacade;
  if (snapshot) {
    try {
      facade = await initialize(snapshot);
      restored = true;
      console.log(`[cico] issuer wallet state restored from ${snapshot.savedAt}`);
    } catch (error) {
      // A state the SDK refuses must never keep the service from starting.
      console.warn(
        `[cico] saved issuer wallet state could not be used (${(error as Error).message}); replaying`,
      );
      facade = await initialize(null);
    }
  } else {
    facade = await initialize(null);
  }

  let saving = false;
  // Saving must never disturb issuance: a failure is logged and forgotten.
  const saveState = async (reason: string): Promise<void> => {
    if (!statePath || saving) return;
    saving = true;
    try {
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
      console.log(`[cico] issuer wallet state saved (${reason})`);
    } catch (error) {
      console.warn(`[cico] issuer wallet state not saved: ${(error as Error).message}`);
    } finally {
      saving = false;
    }
  };
  let saveTimer: ReturnType<typeof setInterval> | null = null;

  let coinPublicKey: string | null = null;
  let encryptionPublicKey: string | null = null;
  let stopped = false;
  return {
    // The wallet may be replaced once, if a restored state fails to start.
    get facade() {
      return facade;
    },
    secretKeys: { shieldedSecretKeys, dustSecretKey },
    issuerSecret,
    get coinPublicKey() {
      if (!coinPublicKey) throw new Error('CICO issuer wallet is not synchronized');
      return coinPublicKey;
    },
    get encryptionPublicKey() {
      if (!encryptionPublicKey) throw new Error('CICO issuer wallet is not synchronized');
      return encryptionPublicKey;
    },
    async start() {
      try {
        await facade.start(shieldedSecretKeys, dustSecretKey);
      } catch (error) {
        if (!restored) throw error;
        console.warn(
          `[cico] restored issuer wallet did not start (${(error as Error).message}); replaying`,
        );
        await facade.stop().catch(() => undefined);
        restored = false;
        facade = await initialize(null);
        await facade.start(shieldedSecretKeys, dustSecretKey);
      }
      // Also while it is still replaying: a restart in the middle of a long
      // replay then continues from the last save instead of from nothing.
      saveTimer = setInterval(() => void saveState('periodic'), WALLET_STATE_SAVE_INTERVAL_MS);
      saveTimer.unref();
    },
    async waitUntilSynced() {
      const state = await facade.waitForSyncedState();
      if (!state.isSynced) throw new Error('CICO issuer wallet did not reach a synchronized state');
      coinPublicKey = ShieldedCoinPublicKey.codec
        .encode(configuration.networkId, state.shielded.coinPublicKey)
        .asString();
      encryptionPublicKey = ShieldedEncryptionPublicKey.codec
        .encode(configuration.networkId, state.shielded.encryptionPublicKey)
        .asString();
      // Exercise the network-specific codec here so a bad network config fails
      // before any credential transaction is constructed.
      MidnightBech32m.encode(configuration.networkId, state.shielded.address).asString();
      await saveState('synchronized');
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (saveTimer) clearInterval(saveTimer);
      // A last save, bounded: the process is about to be killed.
      await Promise.race([
        saveState('shutdown'),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_SAVE_LIMIT_MS)),
      ]);
      issuerSecret.fill(0);
      await facade.stop();
    },
  };
}

function normalizeSecret(value: string, label: string): string {
  const normalized = value.trim().replace(/^0x/u, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new TypeError(`${label} must be exactly 32 bytes of hexadecimal data`);
  }
  return normalized;
}
