import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { asContractAddress } from '@midnight-ntwrk/midnight-js-types';
import { iso31661 } from 'iso-3166';
import {
  createReferendumV2Executor,
  deriveRegistryContractBinding,
  type FrozenCredentialRegistryReference,
  isoNumericCountry,
  padBytes32,
  type RarimoCountryMapper,
  type ReferendumV2CircuitKeys,
  type ReferendumV2ExecutorConfig,
  type ReferendumV2Providers,
  readCredentialRegistryIssuerKey,
} from 'midnight-referendum-api';
import { HmacActionCapabilityIssuer } from './action-capability-issuer.js';
import { type CicoReferendumConfig, loadCicoServiceConfig } from './config.js';
import {
  CredentialEpochCoordinator,
  MidnightCredentialEpochReader,
} from './credential-epoch-coordinator.js';
import { CredentialIssuerService } from './credential-issuer-service.js';
import {
  CredentialRootPublisher,
  type CredentialRootPublisherLogger,
  type CredentialRootPublisherReferendumTarget,
  MidnightCredentialRootPublisherReader,
} from './credential-root-publisher.js';
import { FileCredentialIssuanceStore, FileEvidenceAuthorizationStore } from './durable-stores.js';
import { createCicoHttpService } from './http.js';
import { checkIssuerRole } from './issuer-role-check.js';
import { startMidnightIssuerRuntime } from './midnight-issuer-runtime.js';
import { createMidnightIssuerWalletAdapter } from './midnight-issuer-wallet.js';
import { RarimoHttpVerificationGateway } from './rarimo-http-gateway.js';

const countryMapper: RarimoCountryMapper = (() => {
  const alpha3ToNumeric = new Map(
    iso31661.map((entry) => [entry.alpha3, isoNumericCountry(entry.numeric)] as const),
  );
  const numericToAlpha3 = new Map(
    iso31661.map((entry) => [isoNumericCountry(entry.numeric), entry.alpha3] as const),
  );
  return {
    fromAlpha3: (value) => alpha3ToNumeric.get(value.trim().toUpperCase()),
    toAlpha3: (value) => numericToAlpha3.get(value),
  };
})();

export async function startCicoService(): Promise<() => Promise<void>> {
  const config = loadCicoServiceConfig();
  const gateway = new RarimoHttpVerificationGateway({
    baseUrl: config.rarimoBaseUrl,
    privateHeaders: config.rarimoPrivateHeaders,
    proofParamsAllowedOrigins: config.rarimoProofParamsAllowedOrigins,
    proofRequestBaseUrl: config.rarimoProofRequestBaseUrl,
  });
  // Before the wallet starts, which can take long: is this service the issuer
  // of the registry it is configured for? A wrong secret stops it here.
  setNetworkId('preview');
  const issuerRole = await checkIssuerRole({
    issuerRoleSecretHex: config.issuerRuntime.issuerRoleSecretHex,
    registryContractAddress: config.issuerRuntime.registryContractAddress,
    readIssuerKey: async (address) => {
      const state = await indexerPublicDataProvider(
        config.issuerRuntime.indexerHttpUrl,
        config.issuerRuntime.indexerWsUrl,
      ).queryContractState(asContractAddress(address));
      return state ? readCredentialRegistryIssuerKey(state.data) : null;
    },
    warn: (message) => process.stderr.write(`[cico] ${message}\n`),
  });
  if (issuerRole === 'matches') {
    process.stdout.write('[cico] issuer role secret matches the registry on chain\n');
  }
  const runtime = await startMidnightIssuerRuntime(config.issuerRuntime, {
    createWallet: createMidnightIssuerWalletAdapter,
  });
  const issuerSecret = hexBytes(config.issuerRuntime.issuerRoleSecretHex);
  const issuanceStore = new FileCredentialIssuanceStore(
    join(config.stateDirectory, 'credential-issuances.json'),
  );
  const epochCoordinator = new CredentialEpochCoordinator({
    executor: runtime.executor,
    reader: new MidnightCredentialEpochReader(runtime.providers.publicDataProvider),
    registryContractAddress: config.issuerRuntime.registryContractAddress,
    registryId: config.issuerRuntime.registryId,
    issuerId: config.issuerRuntime.issuerId,
    credentialEpoch: config.issuerRuntime.credentialEpoch,
    issuerSecret,
  });
  const issuer = new CredentialIssuerService({
    executor: runtime.executor,
    registryContractAddress: config.issuerRuntime.registryContractAddress,
    issuerSecret,
    epochMutations: epochCoordinator,
    evidenceAuthorizations: new FileEvidenceAuthorizationStore(
      join(config.stateDirectory, 'evidence-authorizations.json'),
    ),
    issuanceStore,
    validateEvidenceAuthorization: (request) =>
      gateway.validateCredentialIssuance(request, {
        issuerId: config.issuerIdText,
        credentialEpoch: config.credentialEpoch,
        credentialTtlMs: config.credentialTtlMs,
        maximumIssuanceDelayMs: config.maximumIssuanceDelayMs,
        countryMapper,
      }),
  });
  const rootPublisher = createRootPublisher(config, runtime, epochCoordinator);
  const server = createCicoHttpService({
    gateway,
    issuer: rootPublisher
      ? {
          adapterName: issuer.adapterName,
          async issueCredential(request) {
            const result = await issuer.issueCredential(request);
            // The person now waits for a root that holds their pass. Start
            // publishing it at once instead of at the next tick.
            rootPublisher.trigger();
            return result;
          },
        }
      : issuer,
    allowedOrigins: config.allowedOrigins,
    ...(config.actionCapabilities
      ? {
          actionCapabilityIssuer: new HmacActionCapabilityIssuer({
            ...config.actionCapabilities,
            credentialAuthorizationExists: (handle) => issuanceStore.hasIssuanceId(handle),
          }),
        }
      : {}),
    // Only offered when a publisher exists. Without referenda there is no batch
    // to wait for, and the route says so rather than inventing an empty one.
    ...(rootPublisher ? { enrollmentStatus: () => rootPublisher.getStatus() } : {}),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await runtime.stop();
    throw error;
  }
  rootPublisher?.start();
  process.stdout.write(`[cico] ready network=preview host=${config.host} port=${config.port}\n`);
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    rootPublisher?.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await runtime.stop();
  };
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

/**
 * Builds the CredentialRootPublisher when at least one referendum is
 * configured. Nothing is constructed for the default deployment (no
 * referenda), so existing behaviour is unaffected; a misconfigured referendum
 * entry fails config loading (see config.ts) rather than silently running
 * without a publisher.
 */
function createRootPublisher(
  config: ReturnType<typeof loadCicoServiceConfig>,
  runtime: Awaited<ReturnType<typeof startMidnightIssuerRuntime>>,
  epochCoordinator: CredentialEpochCoordinator,
): CredentialRootPublisher | undefined {
  if (config.referenda.length === 0) return undefined;
  if (!config.referendumZkConfigPath) {
    throw new Error('CICO_REFERENDUM_ZK_CONFIG_PATH is required when referenda are configured');
  }
  if (!existsSync(config.referendumZkConfigPath)) {
    // Fail at startup rather than at the first publish attempt. A missing key
    // directory here means enrolled voters are silently never admitted.
    throw new Error(
      `Missing compiled referendum assets at ${config.referendumZkConfigPath}; run npm run compile:v2`,
    );
  }
  const referendumZkConfigProvider = new NodeZkConfigProvider<ReferendumV2CircuitKeys>(
    config.referendumZkConfigPath,
  );
  // The proof provider is not contract-agnostic: it closes over the zk config
  // provider it was built with and fetches each circuit's prover key/zkir
  // through it. Reusing the runtime's would send referendum circuits to the
  // registry's key directory, so it needs its own referendum-rooted pair.
  const referendumProofProvider = httpClientProofProvider<ReferendumV2CircuitKeys>(
    config.issuerRuntime.proofServerUrl,
    referendumZkConfigProvider,
  );
  const rootPublisherSecret = hexBytes(config.rootPublisherSecretHex);
  const registryContractBinding = deriveRegistryContractBinding(
    config.issuerRuntime.registryContractAddress,
  );
  const referenda: CredentialRootPublisherReferendumTarget[] = config.referenda.map((entry) =>
    buildReferendumTarget(
      entry,
      config,
      registryContractBinding,
      runtime,
      rootPublisherSecret,
      referendumZkConfigProvider,
      referendumProofProvider,
    ),
  );
  const everySeconds = Math.round(config.rootPublisher.intervalMs / 1000);
  process.stdout.write(
    `[cico] root publisher: ${referenda.length} consultation(s), every ${everySeconds} s\n`,
  );
  return new CredentialRootPublisher({
    registryExecutor: runtime.executor,
    registryContractAddress: config.issuerRuntime.registryContractAddress,
    reader: new MidnightCredentialRootPublisherReader(runtime.providers.publicDataProvider),
    referenda,
    minBatchSize: config.rootPublisher.minBatchSize,
    maxWaitMs: config.rootPublisher.maxWaitMs,
    intervalMs: config.rootPublisher.intervalMs,
    logger: rootPublisherLogger,
    // One wallet pays for passes and for roots: one transaction at a time.
    walletMutation: (operation) => epochCoordinator.runWalletMutation(operation),
  });
}

/**
 * The publisher's own words on the service log. A person waiting to answer
 * waits on this, so a failure has to be readable there. What it names is
 * public: contract addresses, registry roots, counts, and the network's error.
 */
const rootPublisherLogger: CredentialRootPublisherLogger = {
  info: (message, details) => process.stdout.write(logLine(message, details)),
  warn: (message, details) => process.stderr.write(logLine(message, details)),
  error: (message, details) => process.stderr.write(logLine(message, details)),
};

function logLine(message: string, details?: Record<string, unknown>): string {
  const text = details ? ` ${JSON.stringify(details)}` : '';
  return `[cico] ${message}${text.length > 600 ? `${text.slice(0, 600)}…` : text}\n`;
}

function buildReferendumTarget(
  entry: CicoReferendumConfig,
  config: ReturnType<typeof loadCicoServiceConfig>,
  registryContractBinding: Uint8Array,
  runtime: Awaited<ReturnType<typeof startMidnightIssuerRuntime>>,
  rootPublisherSecret: Uint8Array,
  referendumZkConfigProvider: NodeZkConfigProvider<ReferendumV2CircuitKeys>,
  referendumProofProvider: ReferendumV2Providers['proofProvider'],
): CredentialRootPublisherReferendumTarget {
  const registry: FrozenCredentialRegistryReference = {
    registryContractAddress: config.issuerRuntime.registryContractAddress,
    registryContractBinding,
    registryId: config.issuerRuntime.registryId,
    issuerId: config.issuerRuntime.issuerId,
    credentialEpoch: config.issuerRuntime.credentialEpoch,
    frozenRoot: { field: entry.initialRootField },
  };
  const executorConfig: ReferendumV2ExecutorConfig = {
    registry,
    eventId: entry.eventId,
    organizerKey: entry.organizerKey,
    rootPublisherKey: entry.rootPublisherKey,
    countryPolicy: entry.countryPolicy ? padBytes32(entry.countryPolicy) : new Uint8Array(32),
    countryPolicyEnabled: entry.countryPolicy !== null,
    minimumAssurance: entry.minimumAssurance,
    requireAdult: entry.requireAdult,
    validityReference: entry.validityReference,
    opensAtUnix: entry.opensAtUnix,
    enrollmentClosesAtUnix: entry.enrollmentClosesAtUnix,
    closesAtUnix: entry.closesAtUnix,
    revealClosesAtUnix: entry.revealClosesAtUnix,
    network: 'preview',
    ...(config.issuerRuntime.explorerBaseUrl
      ? { explorerBaseUrl: config.issuerRuntime.explorerBaseUrl }
      : {}),
  };
  return {
    contractAddress: entry.contractAddress,
    // The remaining providers (public data, wallet, midnight, private state)
    // are contract-agnostic and reused as-is; the zk config and the proof
    // provider built on top of it are rooted at a specific contract's
    // compiled artifacts, so the referendum's own pair is swapped in. Without
    // that swap this compiles perfectly and fails at the first publish,
    // looking for publishCredentialRoot.* under the registry's key directory.
    executor: createReferendumV2Executor(
      {
        ...(runtime.providers as unknown as ReferendumV2Providers),
        zkConfigProvider: referendumZkConfigProvider,
        proofProvider: referendumProofProvider,
      },
      executorConfig,
    ),
    rootPublisherSecret,
  };
}

async function main(): Promise<void> {
  const stop = await startCicoService();
  const shutdown = () => {
    void stop().then(
      () => process.exit(0),
      (error: unknown) => {
        process.stderr.write(`[cico] shutdown failed: ${safeError(error)}\n`);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

void main().catch((error: unknown) => {
  process.stderr.write(`[cico] startup failed: ${safeError(error)}\n`);
  process.exitCode = 1;
});
