import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type {
  FinalizedTransaction,
  ProvingProvider,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  createProofProvider,
  type MidnightProvider,
  type WalletProvider,
  type ZKConfigProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { catchError, retry, throwError } from 'rxjs';
import { browserPrivateStateProvider, inMemoryPrivateStateProvider } from '../private-state.js';
import {
  WalletlessActionClient,
  type WalletlessActionJob,
} from '../receipts/walletless-action-client.js';
import {
  createDeviceKeyMaterialProvider,
  type DeviceKeyMaterialProvider,
} from './device-proving.js';
import type { REFERENDUM_V2_PRIVATE_STATE_ID, ReferendumV2PrivateState } from './midnight-v2.js';
import type { ReferendumV2Providers } from './midnight-v2-executors.js';
import type { ReferendumV2CircuitKeys } from './midnight-v2-providers.js';
import type { CivicActionKind } from './types.js';

export interface WalletlessActionCapabilityRequest {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  /** Opaque issuer handle. It is sent to the capability issuer, never the relay. */
  readonly credentialAuthorization: string;
}

export interface WalletlessActionCapabilityIssuer {
  issue(request: WalletlessActionCapabilityRequest): Promise<string>;
}

export interface HttpWalletlessActionCapabilityIssuerOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

/** Narrow browser-to-CICO client. The opaque credential handle never reaches the relay. */
export class HttpWalletlessActionCapabilityIssuer implements WalletlessActionCapabilityIssuer {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpWalletlessActionCapabilityIssuerOptions) {
    assertLocalOrSecureUrl(options.baseUrl, 'capability issuer');
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async issue(request: WalletlessActionCapabilityRequest): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/action-capabilities`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !isRecord(payload) || typeof payload.actionCapability !== 'string') {
      throw new Error(`CICO action capability request failed (${response.status})`);
    }
    return payload.actionCapability;
  }
}

export interface WalletlessActionScope {
  readonly credentialAuthorization: string;
  readonly contractAddress: string;
  readonly circuit: ReferendumV2CircuitKeys;
  readonly action: CivicActionKind;
}

/** Binds credential authorization to exactly one provider invocation. */
export interface WalletlessActionExecutionContext {
  run<T>(scope: WalletlessActionScope, operation: () => Promise<T>): Promise<T>;
}

/** Public, digest-only evidence for one walletless relay invocation. */
export interface WalletlessActionTrace {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly actionIdDigest: string;
  readonly idempotencyKeyDigest: string;
  readonly requestHash: string;
  readonly txDigest: string;
  readonly capabilityDigest: string;
  readonly transactionId: string;
  readonly status: 'confirmed';
}

interface PendingActionRecord {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface WalletlessPendingActionStore {
  get(key: string): Promise<PendingActionRecord | null>;
  put(key: string, record: PendingActionRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemoryWalletlessPendingActionStore implements WalletlessPendingActionStore {
  private readonly records = new Map<string, PendingActionRecord>();

  async get(key: string): Promise<PendingActionRecord | null> {
    const value = this.records.get(key);
    return value ? { ...value } : null;
  }

  async put(key: string, record: PendingActionRecord): Promise<void> {
    this.records.set(key, { ...record });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

/**
 * A browser with no wallet, typically a phone, has nowhere to build a proof.
 * Hosted proving sends the witness to a proving server run by the operator.
 * That server sees the answer, its salt and the credential opening while it
 * works, so the mode can only be selected together with the flag below.
 */
export interface HostedProvingOptions {
  readonly proofServerUri: string;
  /**
   * The literal `true`, set only after the person was shown, in plain words,
   * that the proving server sees their answer while it builds the proof.
   */
  readonly disclosureAccepted: true;
}

/**
 * On-device proving (ADR-011). The prover runs in the person's own browser, so
 * nothing about the answer is sent to a proving server. It needs no
 * disclosure, because no other party sees the witness.
 */
export interface DeviceProvingOptions {
  readonly provingProvider: ProvingProvider;
}

/** Who builds the proof for this runtime. Shown to the person, never inferred. */
export type ProvingParty = 'wallet' | 'device' | 'hosted-server' | 'operator';

export interface ReferendumV2WalletlessProviderOptions {
  readonly relayUrl: string;
  /** Node/operator fallback. Browser proving comes from Lace or from `hostedProving`. */
  readonly proofServerUri?: string;
  /** Connected Lace API used for browser-side proving in sponsored mode. */
  readonly api?: ConnectedAPI;
  /** Disclosed hosted proving for browsers without a wallet. Never combined with `api`. */
  readonly hostedProving?: HostedProvingOptions;
  /** Proving in this browser, without a wallet. Never combined with another prover. */
  readonly deviceProving?: DeviceProvingOptions;
  readonly networkId: 'undeployed' | 'preview';
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly capabilityIssuer: WalletlessActionCapabilityIssuer;
  readonly zkConfigBaseUrl?: string;
  /** Node/operator escape hatch; browser callers must use the fetched provider. */
  readonly zkConfigProvider?: ZKConfigProvider<ReferendumV2CircuitKeys>;
  readonly pendingStore?: WalletlessPendingActionStore;
  readonly pollIntervalMs?: number;
  readonly submissionTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ReferendumV2WalletlessRuntime {
  readonly providers: ReferendumV2Providers;
  readonly provingParty: ProvingParty;
  readonly actionContext: WalletlessActionExecutionContext;
  /** Returns the last confirmed action without exposing the capability token. */
  readonly getLastActionTrace: () => WalletlessActionTrace | null;
}

/**
 * Keys and public parameters for the two circuits a citizen's own device
 * proves: sealing an answer and counting it. Organizer circuits are refused.
 */
export function createReferendumV2DeviceKeyMaterial(options: {
  readonly zkConfigBaseUrl: string;
  readonly paramsBaseUrl: string;
  readonly fetchImpl?: typeof fetch;
}): DeviceKeyMaterialProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return createDeviceKeyMaterialProvider<ReferendumV2CircuitKeys>({
    zkConfigProvider: new FetchZkConfigProvider<ReferendumV2CircuitKeys>(
      options.zkConfigBaseUrl,
      fetchImpl,
    ),
    circuits: ['castVote', 'revealVote'],
    paramsBaseUrl: options.paramsBaseUrl,
    fetchImpl,
  });
}

/**
 * Builds the seedless v2 provider set. The proof comes from exactly one place:
 * Lace, the person's own browser (ADR-011), or the operator's proving server
 * behind its disclosure flag (ADR-010). This provider then forwards only the
 * serialized proven, unbound transaction to the atomic relay. Balancing and
 * submission never become two browser-visible operations. Node operator
 * scripts may use the explicit proof-server fallback.
 */
export async function createReferendumV2WalletlessProviders(
  options: ReferendumV2WalletlessProviderOptions,
): Promise<ReferendumV2WalletlessRuntime> {
  const hasBrowserWindow = typeof window !== 'undefined';
  const hosted = options.hostedProving;
  const device = options.deviceProving;
  if (options.api && (options.proofServerUri || hosted)) {
    throw new TypeError(
      'proofServerUri cannot be combined with a Lace API; browser proving must stay in the wallet',
    );
  }
  if (device) {
    // One prover per runtime. A second one would make it unclear who saw the witness.
    if (options.api || options.proofServerUri || hosted) {
      throw new TypeError('deviceProving cannot be combined with another prover');
    }
    if (
      typeof device.provingProvider?.prove !== 'function' ||
      typeof device.provingProvider?.check !== 'function'
    ) {
      throw new TypeError('deviceProving requires a proving provider');
    }
  }
  if (hosted) {
    if (options.proofServerUri) {
      throw new TypeError('hostedProving and proofServerUri are mutually exclusive');
    }
    // A runtime check as well as a type: a JSON config or a cast must not switch it on.
    if ((hosted as { disclosureAccepted?: unknown }).disclosureAccepted !== true) {
      throw new TypeError('Hosted proving requires the person to have accepted its disclosure');
    }
    assertLocalOrSecureUrl(hosted.proofServerUri, 'proof server');
  }
  if (hasBrowserWindow && !options.api && !hosted && !device) {
    throw new TypeError('Sponsored browser providers require a connected Lace API for proving');
  }
  assertLocalOrSecureUrl(options.relayUrl, 'relay');
  if (!options.api && !hosted && !device) {
    if (!options.proofServerUri) {
      throw new TypeError('proofServerUri is required for Node sponsored providers');
    }
    assertLocalOrSecureUrl(options.proofServerUri, 'proof server');
  }
  const provingParty: ProvingParty = options.api
    ? 'wallet'
    : device
      ? 'device'
      : hosted
        ? 'hosted-server'
        : 'operator';
  setNetworkId(options.networkId);

  const fetchImpl = options.fetchImpl ?? fetch;
  const relay = new WalletlessActionClient({ baseUrl: options.relayUrl, fetchImpl });
  const publicKeys = await relayJson<{ coinPublicKey: string; encryptionPublicKey: string }>(
    `${options.relayUrl.replace(/\/+$/u, '')}/keys`,
    fetchImpl,
  );
  const rawPublicDataProvider = indexerPublicDataProvider(options.indexerUri, options.indexerWsUri);
  const originalObservable =
    rawPublicDataProvider.contractStateObservable.bind(rawPublicDataProvider);
  const publicDataProvider: typeof rawPublicDataProvider = {
    ...rawPublicDataProvider,
    contractStateObservable(address, observableConfig) {
      return originalObservable(address, observableConfig).pipe(
        retry({ delay: 250, count: 1 }),
        catchError((error: unknown) =>
          observableConfig.type === 'latest'
            ? originalObservable(address, { type: 'all' })
            : throwError(() => error),
        ),
      );
    },
  };
  const privateStateProvider =
    typeof window === 'undefined'
      ? inMemoryPrivateStateProvider<
          typeof REFERENDUM_V2_PRIVATE_STATE_ID,
          ReferendumV2PrivateState
        >()
      : browserPrivateStateProvider<
          typeof REFERENDUM_V2_PRIVATE_STATE_ID,
          ReferendumV2PrivateState
        >();
  const browserOrigin = hasBrowserWindow ? window.location.origin : '';
  const zkConfigBaseUrl = options.zkConfigBaseUrl ?? `${browserOrigin}/managed/referendum-v2`;
  if (options.zkConfigProvider) {
    // Explicitly injected providers are only intended for Node-side runners
    // with local managed assets; browser callers cannot serialize these keys.
    if (typeof window !== 'undefined') {
      throw new TypeError('zkConfigProvider injection is unavailable in a browser');
    }
  }
  if (
    !options.zkConfigProvider &&
    typeof window === 'undefined' &&
    !/^https?:\/\//iu.test(zkConfigBaseUrl)
  ) {
    throw new TypeError('zkConfigBaseUrl must be absolute outside a browser');
  }
  const zkConfigProvider =
    options.zkConfigProvider ??
    new FetchZkConfigProvider<ReferendumV2CircuitKeys>(zkConfigBaseUrl, fetchImpl);
  const proofProvider = options.api
    ? createProofProvider(
        await options.api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider()),
      )
    : device
      ? createProofProvider(device.provingProvider)
      : httpClientProofProvider<ReferendumV2CircuitKeys>(
          (hosted?.proofServerUri ?? options.proofServerUri) as string,
          zkConfigProvider,
        );
  const pendingStore = options.pendingStore ?? new InMemoryWalletlessPendingActionStore();
  const pollIntervalMs = boundedDelay(options.pollIntervalMs ?? 500, 'pollIntervalMs');
  // How long the device waits for the relay's transaction to reach the chain.
  // The relay holds an action for a random moment, builds its own fee proof on
  // a small shared server, and one action waits behind another. Two minutes was
  // enough on a laptop and tight on the server. Giving up early is costly: the
  // person's device builds a second proof only to find the first one landed.
  const submissionTimeoutMs = boundedDelay(
    options.submissionTimeoutMs ?? 300_000,
    'submissionTimeoutMs',
  );
  let activeScope: WalletlessActionScope | null = null;
  let lastActionTrace: WalletlessActionTrace | null = null;

  const actionContext: WalletlessActionExecutionContext = {
    async run(scope, operation) {
      if (activeScope) throw new Error('A walletless action scope is already active');
      activeScope = { ...scope };
      try {
        return await operation();
      } finally {
        activeScope = null;
      }
    },
  };

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => publicKeys.coinPublicKey,
    getEncryptionPublicKey: () => publicKeys.encryptionPublicKey,
    // The relay, not the browser, performs the one atomic balance/finalize step.
    balanceTx: async (provenTx) => provenTx as unknown as FinalizedTransaction,
  };
  const midnightProvider: MidnightProvider = {
    async submitTx(provenTx) {
      const scope = activeScope;
      if (!scope) throw new Error('Walletless submission has no credential-bound action scope');
      const tx = toHex(provenTx.serialize()).toLowerCase();
      const pendingKey = await digestText(
        `midnight-referendum:pending-v2:1:${scope.contractAddress}:${scope.circuit}:${scope.credentialAuthorization}`,
      );
      const previous = await pendingStore.get(pendingKey);
      if (previous) {
        const recovered = await relay.getAction(previous.actionId);
        if (recovered && recovered.requestHash === previous.requestHash) {
          const transactionId = await waitForCanonicalReceipt(
            relay,
            recovered,
            pollIntervalMs,
            submissionTimeoutMs,
          );
          await pendingStore.delete(pendingKey);
          return transactionId;
        }
        await pendingStore.delete(pendingKey);
      }

      const actionId = randomId();
      const idempotencyKey = randomId();
      const requestHash = await walletlessActionRequestHash({
        action: scope.action,
        contractAddress: scope.contractAddress,
        circuit: scope.circuit,
        network: options.networkId,
        tx,
      });
      const actionCapability = await options.capabilityIssuer.issue({
        actionId,
        idempotencyKey,
        requestHash,
        network: options.networkId,
        contractAddress: scope.contractAddress,
        circuit: scope.circuit,
        action: scope.action,
        credentialAuthorization: scope.credentialAuthorization,
      });
      await pendingStore.put(pendingKey, { actionId, idempotencyKey, requestHash });
      const job = await relay.submit({
        actionId,
        idempotencyKey,
        requestHash,
        actionCapability,
        network: options.networkId,
        contractAddress: scope.contractAddress,
        circuit: scope.circuit,
        action: scope.action,
        tx,
      });
      const transactionId = await waitForCanonicalReceipt(
        relay,
        job,
        pollIntervalMs,
        submissionTimeoutMs,
      );
      lastActionTrace = {
        actionId,
        idempotencyKey,
        actionIdDigest: await digestText(`midnight-referendum:v2-action-id-digest:1:${actionId}`),
        idempotencyKeyDigest: await digestText(
          `midnight-referendum:v2-idempotency-digest:1:${idempotencyKey}`,
        ),
        requestHash,
        txDigest: await digestText(`midnight-referendum:v2-tx:1:${tx}`),
        capabilityDigest: await digestText(
          `midnight-referendum:v2-capability-digest:1:${actionCapability}`,
        ),
        transactionId,
        status: 'confirmed',
      };
      await pendingStore.delete(pendingKey);
      return transactionId;
    },
  };

  return {
    providers: {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    },
    provingParty,
    actionContext,
    getLastActionTrace: () => (lastActionTrace ? { ...lastActionTrace } : null),
  };
}

async function waitForCanonicalReceipt(
  relay: WalletlessActionClient,
  initial: WalletlessActionJob,
  intervalMs: number,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let job: WalletlessActionJob | null = initial;
  for (;;) {
    if (!job) throw new Error('Walletless relay lost the accepted action');
    if (job.status === 'failed' || job.status === 'recovery_required') {
      throw new Error(`Walletless relay stopped with ${job.errorCode ?? job.status}`);
    }
    const receipt = await relay.getReceipt(initial.actionId);
    if (receipt) {
      if (
        receipt.network !== initial.network ||
        receipt.contractAddress !== initial.contractAddress ||
        receipt.circuit !== initial.circuit ||
        (job.transactionId && receipt.transactionId !== job.transactionId)
      ) {
        throw new Error('Walletless canonical receipt does not match the accepted action');
      }
      return receipt.transactionId;
    }
    if (Date.now() >= deadline) throw new Error('Walletless relay submission is still pending');
    await delay(intervalMs);
    job = await relay.getAction(initial.actionId);
  }
}

/** Browser/WebCrypto equivalent of the relay's deterministic request digest. */
export async function walletlessActionRequestHash(input: {
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  readonly tx: string;
}): Promise<string> {
  return digestText(
    `midnight-referendum:v2-action:1:${stableJson({
      action: input.action,
      contractAddress: input.contractAddress,
      circuit: input.circuit,
      network: input.network,
      tx: input.tx,
      version: 1,
    })}`,
  );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

async function digestText(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure random UUID support is required');
  return globalThis.crypto.randomUUID();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedDelay(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 10 * 60_000) {
    throw new TypeError(`${label} is outside the supported range`);
  }
  return value;
}

async function relayJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Walletless relay key endpoint returned ${response.status}`);
  return (await response.json()) as T;
}

function assertLocalOrSecureUrl(value: string, label: string): void {
  const url = new URL(value);
  const local =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new TypeError(`${label} URL must use HTTPS outside localhost`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
