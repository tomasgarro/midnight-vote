import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { ChargedState } from '@midnight-ntwrk/compact-runtime';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  type FinalizedTransaction,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  createProofProvider,
  type MidnightProvider,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { catchError, combineLatest, map, Observable, retry, throwError } from 'rxjs';
import * as GeneratedReferendum from './generated/referendum/index.js';
import { browserPrivateStateProvider, inMemoryPrivateStateProvider } from './private-state.js';
import type {
  AppProviders,
  ContractState,
  DerivedState,
  ImpureCircuitKeys,
  PrivateState,
  ReferendumExecutor,
  TransactionReceipt,
  VoteReveal,
} from './types.js';
import { PRIVATE_STATE_ID } from './types.js';

export {
  createExternalEligibilityProvider,
  createFixtureEligibilityProvider,
  eligibilityCommitmentForSecret,
} from './eligibility.js';
export type {
  BallotOpeningDurability,
  BallotOpeningRecordStore,
  BrowserBallotOpeningVault,
} from './private-state.js';
export {
  browserBallotOpeningVault,
  browserCivicCredentialVault,
  browserPrivateStateProvider,
  browserRarimoEnrollmentVault,
  createBallotOpeningVault,
  deserializePrivateStateFromStorage,
  inMemoryPrivateStateProvider,
  serializePrivateStateForStorage,
} from './private-state.js';
export type {
  AppProviders,
  ContractState,
  DerivedState,
  EligibilityAttestation,
  ImpureCircuitKeys,
  PassportSession,
  PrivateState,
  ReferendumExecutor,
  TransactionReceipt,
  VoteCommitment,
  VoteReveal,
} from './types.js';
export { PRIVATE_STATE_ID } from './types.js';

export interface ProviderOptions {
  /** Explicit local fallback; never inferred from the node URI. */
  proofServerUri?: string;
  zkConfigBaseUrl?: string;
}

function previewSafeIndexerProvider(
  provider: AppProviders['publicDataProvider'],
): AppProviders['publicDataProvider'] {
  const original = provider.contractStateObservable.bind(provider);
  return {
    ...provider,
    contractStateObservable(address, config) {
      // Preview indexer versions have returned offset:null for a latest
      // subscription. A bounded retry lets the subscription reconnect without
      // changing the endpoint selected by the wallet.
      return original(address, config).pipe(
        retry({ delay: 250, count: 1 }),
        catchError((error: unknown) => {
          if (config.type === 'latest') {
            return original(address, { type: 'all' });
          }
          return throwError(() => error);
        }),
      );
    },
  };
}

export interface RelayerProviderOptions {
  /** Base URL of the sponsored relayer, e.g. http://localhost:8790 */
  relayerUrl: string;
  /**
   * Required in relayer mode. With no wallet in the flow there is nothing to
   * delegate proving to, so the browser must reach a proof server directly.
   */
  proofServerUri: string;
  networkId: string;
  indexerUri: string;
  indexerWsUri: string;
  zkConfigBaseUrl?: string;
  /**
   * Node scripts must pass their own provider: `FetchZkConfigProvider` reads
   * assets over HTTP, and Node's fetch cannot open `file://` URLs.
   */
  zkConfigProvider?: AppProviders['zkConfigProvider'];
}

async function relayerJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`El relayer respondió ${response.status}. ${detail}`.trim());
  }
  return (await response.json()) as T;
}

/**
 * Compatibility-only legacy wallet-less provider set for Node operators.
 * Browser callers must use the Passport-v2 sponsored-wallet composition, which
 * delegates proving to Lace and exposes only the atomic /v2 action boundary.
 *
 * `castVote` is authorised by Merkle membership and the nullifier, never by
 * the submitter, so the relayer funds the transaction without gaining any say
 * over the ballot. It does learn the nullifier and the caller's IP; it cannot
 * learn the choice, which stays sealed until reveal.
 */
export async function createRelayerProviders(
  options: RelayerProviderOptions,
): Promise<AppProviders> {
  if (typeof window !== 'undefined') {
    throw new TypeError(
      'The legacy relayer provider is unavailable in a browser; use Passport-v2 sponsored-wallet providers',
    );
  }
  setNetworkId(options.networkId as Parameters<typeof setNetworkId>[0]);

  const base = options.relayerUrl.replace(/\/$/, '');
  const keys = await relayerJson<{ coinPublicKey: string; encryptionPublicKey: string }>(
    `${base}/keys`,
  );

  const publicDataProvider = previewSafeIndexerProvider(
    indexerPublicDataProvider(options.indexerUri, options.indexerWsUri),
  );
  const privateStateProvider =
    typeof window === 'undefined'
      ? inMemoryPrivateStateProvider<typeof PRIVATE_STATE_ID, PrivateState>()
      : browserPrivateStateProvider<typeof PRIVATE_STATE_ID, PrivateState>();
  // The legacy provider is explicitly Node-only; the browser branch above
  // makes this a constant and prevents an accidental browser URL fallback.
  const browserOrigin = '';
  const zkConfigProvider =
    options.zkConfigProvider ??
    new FetchZkConfigProvider<ImpureCircuitKeys>(
      options.zkConfigBaseUrl ?? `${browserOrigin}/managed/referendum`,
      fetch.bind(globalThis),
    );
  const proofProvider = httpClientProofProvider<ImpureCircuitKeys>(
    options.proofServerUri,
    zkConfigProvider,
  );

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => keys.coinPublicKey,
    getEncryptionPublicKey: () => keys.encryptionPublicKey,
    balanceTx: async (tx, _ttl) => {
      const { tx: balancedHex } = await relayerJson<{ tx: string }>(`${base}/balance`, {
        tx: toHex(tx.serialize()),
      });
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        fromHex(balancedHex),
      ) satisfies FinalizedTransaction;
    },
  };
  const midnightProvider: MidnightProvider = {
    submitTx: async (tx) => {
      const { txId } = await relayerJson<{ txId: string }>(`${base}/submit`, {
        tx: toHex(tx.serialize()),
      });
      return txId;
    },
  };

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

export async function createProviders(
  api: ConnectedAPI,
  options: ProviderOptions = {},
): Promise<AppProviders> {
  if (typeof window !== 'undefined' && options.proofServerUri) {
    throw new TypeError(
      'HTTP proof providers are unavailable in a browser; use Lace wallet proving',
    );
  }
  const config = await api.getConfiguration();
  setNetworkId(config.networkId);

  const publicDataProvider = previewSafeIndexerProvider(
    indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
  );
  const privateStateProvider =
    typeof window === 'undefined'
      ? inMemoryPrivateStateProvider<typeof PRIVATE_STATE_ID, PrivateState>()
      : browserPrivateStateProvider<typeof PRIVATE_STATE_ID, PrivateState>();
  const browserOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const zkConfigProvider = new FetchZkConfigProvider<ImpureCircuitKeys>(
    options.zkConfigBaseUrl ?? `${browserOrigin}/managed/referendum`,
    fetch.bind(globalThis),
  );

  // Wallet-delegated proving is the default. A proof server is an explicit
  // local development fallback and is never derived from substrateNodeUri.
  const proofProvider = options.proofServerUri
    ? httpClientProofProvider<ImpureCircuitKeys>(options.proofServerUri, zkConfigProvider)
    : createProofProvider(await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider()));

  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } = await api.getShieldedAddresses();
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey,
    balanceTx: async (tx, _ttl) => {
      const { tx: balancedHex } = await api.balanceUnsealedTransaction(toHex(tx.serialize()), {});
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        fromHex(balancedHex),
      ) satisfies FinalizedTransaction;
    },
  };
  const midnightProvider: MidnightProvider = {
    submitTx: async (tx) => {
      await api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

export interface ReferendumConfig {
  issuerSecret: Uint8Array;
  organizerSecret: Uint8Array;
  eventId: Uint8Array;
  explorerBaseUrl?: string;
}

export function createReferendumPrivateState(
  config: Pick<ReferendumConfig, 'issuerSecret' | 'organizerSecret'>,
): PrivateState {
  return {
    issuerSecret: config.issuerSecret,
    organizerSecret: config.organizerSecret,
    // Aliases keep old generated artifacts runnable while a new artifact is
    // being synchronized; the new witness names are the supported interface.
    issuer: config.issuerSecret,
    organizer: config.organizerSecret,
  } as PrivateState;
}

function createCompiledReferendum(_privateState: PrivateState) {
  const witnesses = {
    issuerSecret: (context: any) => [
      context.privateState,
      context.privateState.issuerSecret ?? context.privateState.issuer,
    ],
    organizerSecret: (context: any) => [
      context.privateState,
      context.privateState.organizerSecret ?? context.privateState.organizer,
    ],
    voterSecret: (context: any) => [context.privateState, context.privateState.voterSecret],
    voterPath: (context: any) => [context.privateState, context.privateState.voterPath],
    // The UI stores the choice as a string ("YES" | "NO" | "ABSTAIN"); the
    // circuit takes the generated Choice enum value.
    voterChoice: (context: any) => [
      context.privateState,
      typeof context.privateState.voterChoice === 'string'
        ? (GeneratedReferendum.Choice as any)[context.privateState.voterChoice]
        : context.privateState.voterChoice,
    ],
    voteSalt: (context: any) => [context.privateState, context.privateState.voteSalt],
    revealPath: (context: any) => [context.privateState, context.privateState.revealPath],
  };
  let compiled = CompiledContract.make('referendum', GeneratedReferendum.Contract as any) as any;
  compiled = (CompiledContract.withWitnesses as any)(compiled, witnesses as any);
  return (CompiledContract.withCompiledFileAssets as any)(compiled, 'managed/referendum');
}

function receiptFrom(value: any, explorerBaseUrl?: string): TransactionReceipt {
  const data = value.public ?? value;
  const txHash = String(data.txHash ?? data.txId);
  return {
    txId: String(data.txId),
    txHash,
    blockHeight: Number(data.blockHeight),
    blockHash: String(data.blockHash),
    blockTimestamp: Number(data.blockTimestamp),
    status: String(data.status),
    ...(explorerBaseUrl ? { explorerUrl: `${explorerBaseUrl.replace(/\/$/, '')}/${txHash}` } : {}),
  };
}

/** Midnight.js lifecycle wrapper used by the Preview UI and future Passport executor. */
export function createReferendumExecutor(
  providers: AppProviders,
  config: ReferendumConfig,
): ReferendumExecutor {
  const explorerBaseUrl = config.explorerBaseUrl;
  let contract: any;
  const call = async (circuit: string, ...args: unknown[]) => {
    if (!contract) throw new Error('The referendum contract is not joined');
    return receiptFrom(await contract.callTx[circuit](...args), explorerBaseUrl);
  };

  return {
    async deploy(initialPrivateState) {
      contract = await deployContract(
        providers as any,
        {
          compiledContract: createCompiledReferendum(initialPrivateState),
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: initialPrivateState as any,
          args: [config.issuerSecret, config.organizerSecret, config.eventId],
        } as any,
      );
      return contract;
    },
    async join(contractAddress, initialPrivateState) {
      contract = await findDeployedContract(
        providers as any,
        {
          contractAddress,
          compiledContract: createCompiledReferendum(initialPrivateState),
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: initialPrivateState as any,
        } as any,
      );
      return contract;
    },
    issue: (commitment) => call('issue', commitment),
    castVote: () => call('castVote'),
    // The UI and the CLI both carry the choice as a string ("YES" | "NO" |
    // "ABSTAIN"), but the circuit argument is the generated Choice enum, and
    // passing the string through reaches the runtime as a type error at call
    // time rather than at compile time. The voterChoice witness already does
    // this conversion; the reveal argument has to do it too.
    revealVote: (choice: VoteReveal['choice'], salt) =>
      call(
        'revealVote',
        typeof choice === 'string' ? (GeneratedReferendum.Choice as any)[choice] : choice,
        salt,
      ),
    closeVote: () => call('closeVote'),
    finalizeVote: () => call('finalizeVote'),
  };
}

const PHASES = ['COMMIT', 'REVEAL', 'FINALIZED'] as const;
const CHOICES = [
  ['YES', 0],
  ['NO', 1],
  ['ABSTAIN', 2],
] as const;

/**
 * Reads the public referendum state from canonical ledger data.
 *
 * Only aggregates exist here. During COMMIT the tally is genuinely all zeros —
 * there is nothing to leak, because no choice has been revealed yet — and it
 * fills in during REVEAL. `member` is checked before `lookup` because a Map
 * entry the constructor never inserted would otherwise throw.
 */
export function parseReferendumLedger(data: ChargedState): ContractState {
  const ledger = (GeneratedReferendum as any).ledger(data);
  const tally = new Map<'YES' | 'NO' | 'ABSTAIN', bigint>();
  for (const [label, key] of CHOICES) {
    tally.set(label, ledger.tally.member(key) ? BigInt(ledger.tally.lookup(key)) : 0n);
  }
  return {
    phase: PHASES[Number(ledger.phase)] ?? 'COMMIT',
    closed: Boolean(ledger.closed),
    issuedVoters: BigInt(ledger.issuedVoters),
    tally,
  };
}

/** Live public state for the results panel. Needs no wallet and no private state. */
export function watchReferendumState(
  providers: Pick<AppProviders, 'publicDataProvider'>,
  contractAddress: string,
): Observable<ContractState> {
  return providers.publicDataProvider
    .contractStateObservable(contractAddress, { type: 'latest' })
    .pipe(
      map((state) => parseReferendumLedger(state.data)),
      retry({ delay: 2_000 }),
    );
}

/** Resolve a private voter witness path from the current canonical ledger state. */
export async function findEligibilityPath(
  providers: AppProviders,
  contractAddress: string,
  commitment: Uint8Array,
): Promise<PrivateState['voterPath']> {
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!state) throw new Error('The referendum contract has no canonical state yet');
  const ledger = (GeneratedReferendum as any).ledger(state.data);
  const path = ledger.eligibleVoters.findPathForLeaf(commitment);
  if (!path) throw new Error('This wallet is not present in the referendum eligibility tree');
  return path;
}

export function createStateObservable(
  publicDataProvider: AppProviders['publicDataProvider'],
  privateStateProvider: AppProviders['privateStateProvider'],
  contractAddress: string,
  parseLedger: (data: ChargedState) => ContractState,
): Observable<DerivedState> {
  const public$ = publicDataProvider
    .contractStateObservable(contractAddress, { type: 'latest' })
    .pipe(map((state) => parseLedger(state.data)));
  const private$ = new Observable<PrivateState | null>((subscriber) => {
    privateStateProvider
      .get(PRIVATE_STATE_ID)
      .then((s) => subscriber.next(s))
      .catch((err) => subscriber.error(err));
  });
  return combineLatest([public$, private$]).pipe(
    map(([contractState, currentPrivateState]) => ({
      contractState,
      privateState: currentPrivateState,
    })),
    retry({ delay: 500 }),
  );
}

export * from './consultation/index.js';
export * from './passport-v2/index.js';
export type { PassportSession as CivicPassportSession } from './passport-v2/types.js';
export * from './pulse/index.js';
export * from './receipts/index.js';
