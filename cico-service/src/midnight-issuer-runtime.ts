import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  type FinalizedTransaction,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type {
  MidnightProvider,
  ProofProvider,
  PublicDataProvider,
  UnboundTransaction,
  WalletProvider,
  ZKConfigProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  type CREDENTIAL_REGISTRY_V1_PRIVATE_STATE_ID,
  type CredentialRegistryV1Executor,
  type CredentialRegistryV1PrivateState,
  type CredentialRegistryV1Providers,
  createCredentialRegistryV1Executor,
  deriveRoleKey,
  inMemoryPrivateStateProvider,
} from 'midnight-referendum-api';

export type CredentialRegistryV1CircuitKey = 'addCredential' | 'freeze';

export interface MidnightIssuerRuntimeConfig {
  /** Dedicated 32-byte fee-wallet seed; never pass RELAYER_SEED here. */
  readonly issuerSeedHex: string;
  /** Independent Compact registry authority; never reuse a wallet or relayer seed. */
  readonly issuerRoleSecretHex: string;
  readonly networkId: string;
  readonly indexerHttpUrl: string;
  readonly indexerWsUrl: string;
  readonly proofServerUrl: string;
  readonly approvedProofServerOrigins?: readonly string[];
  readonly zkConfigBasePath: string;
  readonly registryContractAddress: string;
  readonly registryId: Uint8Array;
  readonly issuerId: Uint8Array;
  readonly credentialEpoch: bigint;
  readonly relayUrl?: string;
  readonly explorerBaseUrl?: string;
  readonly balanceTtlMs?: number;
  /**
   * File that keeps the issuer wallet's synchronized state between starts, so
   * a restart does not replay the chain. It holds no key. Omit to keep nothing.
   */
  readonly walletStatePath?: string;
}

/** Narrow seam around WalletFacade; production code supplies the SDK adapter. */
export interface MidnightIssuerWalletAdapter {
  readonly facade: {
    balanceUnboundTransaction(
      tx: unknown,
      keys: unknown,
      options: { readonly ttl: Date },
    ): Promise<unknown>;
    finalizeRecipe(recipe: unknown): Promise<{ serialize(): Uint8Array }>;
    submitTransaction(tx: unknown): Promise<string>;
  };
  readonly secretKeys: unknown;
  readonly issuerSecret: Uint8Array;
  readonly coinPublicKey: string;
  readonly encryptionPublicKey: string;
  start(): Promise<void>;
  waitUntilSynced(): Promise<void>;
  stop(): Promise<void>;
  /** The wallet's public address and whether it holds DUST now; null if it cannot say. */
  describe?(): Promise<MidnightIssuerWalletDescription | null>;
}

export interface MidnightIssuerWalletDescription {
  readonly address: string;
  readonly dustAvailable: boolean;
}

export interface MidnightIssuerTransactionCodec {
  serialize(tx: { serialize(): Uint8Array }): Uint8Array;
  deserializeUnbound(bytes: Uint8Array): unknown;
  deserializeFinalized(bytes: Uint8Array): unknown;
}

export interface MidnightIssuerRuntimeDependencies {
  readonly createWallet: (
    config: MidnightIssuerRuntimeConfig,
  ) => Promise<MidnightIssuerWalletAdapter>;
  readonly setNetworkId?: typeof setNetworkId;
  readonly createPublicDataProvider?: (httpUrl: string, wsUrl: string) => PublicDataProvider;
  readonly createZkConfigProvider?: (
    basePath: string,
  ) => ZKConfigProvider<CredentialRegistryV1CircuitKey>;
  readonly createProofProvider?: (
    url: string,
    zk: ZKConfigProvider<CredentialRegistryV1CircuitKey>,
  ) => ProofProvider;
  readonly createExecutor?: (
    providers: CredentialRegistryV1Providers,
    config: Parameters<typeof createCredentialRegistryV1Executor>[1],
  ) => CredentialRegistryV1Executor;
  readonly transactionCodec?: MidnightIssuerTransactionCodec;
}

export interface MidnightIssuerRuntime {
  readonly executor: CredentialRegistryV1Executor;
  readonly providers: CredentialRegistryV1Providers;
  readonly stop: () => Promise<void>;
  /** Public facts about the wallet that pays; null when it cannot be asked. */
  readonly describeWallet: () => Promise<MidnightIssuerWalletDescription | null>;
}

export async function startMidnightIssuerRuntime(
  config: MidnightIssuerRuntimeConfig,
  dependencies: MidnightIssuerRuntimeDependencies,
): Promise<MidnightIssuerRuntime> {
  validateConfig(config);
  (dependencies.setNetworkId ?? setNetworkId)('preview');
  const wallet = await dependencies.createWallet(config);
  try {
    await wallet.start();
    await wallet.waitUntilSynced();
    const providers = createMidnightIssuerProviders(config, wallet, dependencies);
    const executor = (dependencies.createExecutor ?? createCredentialRegistryV1Executor)(
      providers,
      {
        registryId: config.registryId,
        issuerId: config.issuerId,
        credentialEpoch: config.credentialEpoch,
        issuerKey: deriveRoleKey('cico:registry:issuer:', wallet.issuerSecret),
        network: 'preview',
        ...(config.explorerBaseUrl ? { explorerBaseUrl: config.explorerBaseUrl } : {}),
      },
    );
    let stopped = false;
    return {
      executor,
      providers,
      describeWallet: async () => {
        try {
          return (await wallet.describe?.()) ?? null;
        } catch {
          return null;
        }
      },
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await wallet.stop();
      },
    };
  } catch (error) {
    await wallet.stop().catch(() => undefined);
    throw error;
  }
}

export function createMidnightIssuerProviders(
  config: MidnightIssuerRuntimeConfig,
  wallet: MidnightIssuerWalletAdapter,
  dependencies: Pick<
    MidnightIssuerRuntimeDependencies,
    | 'createPublicDataProvider'
    | 'createZkConfigProvider'
    | 'createProofProvider'
    | 'transactionCodec'
  >,
): CredentialRegistryV1Providers {
  const codec = dependencies.transactionCodec ?? defaultTransactionCodec;
  const zk = (dependencies.createZkConfigProvider ?? defaultZkConfigProvider)(
    config.zkConfigBasePath,
  );
  const publicDataProvider = (dependencies.createPublicDataProvider ?? indexerPublicDataProvider)(
    config.indexerHttpUrl,
    config.indexerWsUrl,
  );
  const proofProvider = (dependencies.createProofProvider ?? httpClientProofProvider)(
    config.proofServerUrl,
    zk,
  );
  const privateStateProvider = inMemoryPrivateStateProvider<
    typeof CREDENTIAL_REGISTRY_V1_PRIVATE_STATE_ID,
    CredentialRegistryV1PrivateState
  >();
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => wallet.coinPublicKey,
    getEncryptionPublicKey: () => wallet.encryptionPublicKey,
    balanceTx: async (tx: UnboundTransaction, ttl?: Date) => {
      const unbound = codec.deserializeUnbound(codec.serialize(tx));
      const recipe = await wallet.facade.balanceUnboundTransaction(unbound, wallet.secretKeys, {
        ttl: ttl ?? new Date(Date.now() + (config.balanceTtlMs ?? 3_600_000)),
      });
      const finalized = await wallet.facade.finalizeRecipe(recipe);
      return codec.deserializeFinalized(codec.serialize(finalized)) as FinalizedTransaction;
    },
  };
  const midnightProvider: MidnightProvider = {
    submitTx: async (tx: FinalizedTransaction) => {
      const finalized = codec.deserializeFinalized(codec.serialize(tx));
      return wallet.facade.submitTransaction(finalized);
    },
  };
  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider: zk,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

const defaultTransactionCodec: MidnightIssuerTransactionCodec = {
  serialize: (tx) => new Uint8Array(tx.serialize()),
  deserializeUnbound: (bytes) =>
    Transaction.deserialize('signature', 'proof', 'pre-binding', new Uint8Array(bytes)),
  deserializeFinalized: (bytes) =>
    Transaction.deserialize('signature', 'proof', 'binding', new Uint8Array(bytes)),
};

function defaultZkConfigProvider(
  basePath: string,
): ZKConfigProvider<CredentialRegistryV1CircuitKey> {
  return new NodeZkConfigProvider<CredentialRegistryV1CircuitKey>(basePath);
}

function validateConfig(config: MidnightIssuerRuntimeConfig): void {
  if (config.networkId !== 'preview') {
    throw new Error('CICO issuer runtime is Preview-only and fails closed');
  }
  if (!/^[0-9a-f]{64}$/iu.test(config.issuerSeedHex.replace(/^0x/u, ''))) {
    throw new TypeError('issuerSeedHex must be a dedicated 32-byte hexadecimal seed');
  }
  if (!/^[0-9a-f]{64}$/iu.test(config.issuerRoleSecretHex.replace(/^0x/u, ''))) {
    throw new TypeError('issuerRoleSecretHex must be a dedicated 32-byte hexadecimal secret');
  }
  if (
    config.issuerSeedHex.replace(/^0x/u, '').toLowerCase() ===
    config.issuerRoleSecretHex.replace(/^0x/u, '').toLowerCase()
  ) {
    throw new TypeError('issuer wallet seed and Compact authority secret must be independent');
  }
  if (!(config.registryId instanceof Uint8Array) || config.registryId.length !== 32) {
    throw new TypeError('registryId must be exactly 32 bytes');
  }
  if (!(config.issuerId instanceof Uint8Array) || config.issuerId.length !== 32) {
    throw new TypeError('issuerId must be exactly 32 bytes');
  }
  if (typeof config.credentialEpoch !== 'bigint' || config.credentialEpoch < 0n) {
    throw new TypeError('credentialEpoch must be a non-negative bigint');
  }
  if (!config.registryContractAddress.trim()) {
    throw new TypeError('registryContractAddress must not be empty');
  }
  const proof = new URL(config.proofServerUrl);
  const local = isLoopbackHostname(proof.hostname);
  if (proof.username || proof.password || proof.search || proof.hash) {
    throw new TypeError('proofServerUrl must not contain credentials, query, or fragment');
  }
  if (proof.protocol === 'http:' && !local) {
    throw new Error('Non-local proof servers must use HTTPS');
  }
  if (!local && !(config.approvedProofServerOrigins ?? []).includes(proof.origin)) {
    throw new Error('Proof server origin is not local or explicitly approved');
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}
