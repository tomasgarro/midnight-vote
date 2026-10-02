import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import {
  ageClassCode,
  assuranceCode,
  deriveBallotCommitment,
  isoTimestampSeconds,
  padBytes32,
} from './crypto.js';
import {
  assertCanonicalReferendumBinding,
  type CredentialTreeView,
  credentialTreeView,
  findBallotPath,
  isBallotRevealed,
  parseCredentialRegistryV1,
  parseReferendumV2,
  type ReferendumV2PrivateState,
  resolveAdmittedCredentialPath,
} from './midnight-v2.js';
import {
  createReferendumV2Executor,
  type ReferendumV2Executor,
  type ReferendumV2ExecutorConfig,
  type ReferendumV2Providers,
} from './midnight-v2-executors.js';
import type { WalletlessActionExecutionContext } from './midnight-v2-relayer-providers.js';
import type {
  BallotOpening,
  BallotOpeningVaultPort,
  CivicActionPort,
  CivicCredentialPort,
  CivicCredentialPrivateMaterial,
  CivicCredentialPrivateStatePort,
  PassAdmission,
} from './ports.js';
import type { CredentialRegistryHistoryPort } from './registry-history.js';
import type {
  CanonicalReceipt,
  CastVoteRequest,
  PublicCohortRequest,
  RevealVoteRequest,
} from './types.js';
import { CivicCredentialError } from './types.js';

const privateStateActionTails = new WeakMap<object, Promise<void>>();

export interface ReferendumV2CatalogEntry {
  readonly referendumId: string;
  readonly contractAddress: string;
  readonly config: ReferendumV2ExecutorConfig;
}

/** What the chain says about one ballot commitment this device holds an opening for. */
export interface RevealBallotState {
  readonly ballotCommitment: Uint8Array;
  /** Path in the ballot tree, or null when the commitment never reached the referendum. */
  readonly revealPath: MerkleTreePath<Uint8Array> | null;
  /** True once the commitment has been counted. */
  readonly revealed: boolean;
}

export interface RevealContext {
  readonly phase: 'COMMIT' | 'REVEAL' | 'FINALIZED';
  readonly closed: boolean;
  /** One entry per requested commitment, in the order requested. */
  readonly ballots: readonly RevealBallotState[];
}

/** Where this device's sealed answer stands, read from its vault and the chain. */
export type SealedAnswerStatus = 'none' | 'sealed' | 'counted';

export interface MidnightCivicActionStateResolver {
  assertCanonicalBinding(entry: ReferendumV2CatalogEntry): Promise<void>;
  resolveCredentialPath(
    entry: ReferendumV2CatalogEntry,
    credentialLeaf: Uint8Array,
  ): Promise<MerkleTreePath<Uint8Array>>;
  /** Optional: defaults to one canonical read of the referendum's public state. */
  resolveRevealContext?(
    entry: ReferendumV2CatalogEntry,
    ballotCommitments: readonly Uint8Array[],
  ): Promise<RevealContext>;
}

export interface MidnightCivicActionAdapterOptions {
  readonly providers: ReferendumV2Providers;
  readonly credential: CivicCredentialPort & CivicCredentialPrivateStatePort;
  readonly referenda: readonly ReferendumV2CatalogEntry[];
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly stateResolver?: MidnightCivicActionStateResolver;
  readonly executorFactory?: (
    providers: ReferendumV2Providers,
    config: ReferendumV2ExecutorConfig,
  ) => ReferendumV2Executor;
  /** Optional durable/indexer-backed lookup used after reload or an uncertain response. */
  readonly receiptResolver?: (transactionId: string) => Promise<CanonicalReceipt | null>;
  /** Present only for the atomic walletless provider; Lace does not need it. */
  readonly actionExecutionContext?: WalletlessActionExecutionContext;
  /**
   * Device-local vault for ballot openings. Without it an answer can be sealed
   * but never counted by this device, so `revealVote` reports the capability
   * as unavailable.
   */
  readonly ballotOpenings?: BallotOpeningVaultPort;
  /**
   * Where the registry gained each pass. With it, a pass is proven against the
   * newest root the consultation admitted that already held it, so a person is
   * not held up by passes issued after theirs. Without it, a pass can be
   * proven only while the registry's current root is admitted.
   */
  readonly registryHistory?: CredentialRegistryHistoryPort;
  /** Seconds since the epoch; only chooses the wording of a refusal. */
  readonly nowUnix?: () => number;
}

/** How many earlier passes a lookup goes back before it gives up. */
const EARLIER_PASSES = 48;

/** The assertion `castVote` fails with when the holder's nullifier is spent. */
const ALREADY_ANSWERED_ASSERTION = 'This voter has already voted in this referendum';

/** The runtime wraps a failed assertion several times; the text is in one of the causes. */
function refusedAsAlreadyAnswered(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (current.message.includes(ALREADY_ANSWERED_ASSERTION)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Browser-owned v2 vote adapter. It prepares the Compact witness locally and
 * calls the Midnight executor; no HTTP action request ever receives `choice`.
 *
 * Sealing and counting are two transactions. The opening (choice and salt) is
 * written to the device vault before the cast is submitted and removed once
 * the count is confirmed. Nobody else holds it, so nobody else can count the
 * answer or learn it early.
 */
export class MidnightCivicActionAdapter implements CivicActionPort {
  readonly adapterName = 'midnight-browser-civic-actions-v2';

  private readonly providers: ReferendumV2Providers;
  private readonly credential: CivicCredentialPort & CivicCredentialPrivateStatePort;
  private readonly referenda: ReadonlyMap<string, ReferendumV2CatalogEntry>;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly stateResolver: MidnightCivicActionStateResolver;
  private readonly executorFactory: NonNullable<
    MidnightCivicActionAdapterOptions['executorFactory']
  >;
  private readonly receiptResolver?: MidnightCivicActionAdapterOptions['receiptResolver'];
  private readonly actionExecutionContext?: WalletlessActionExecutionContext;
  private readonly ballotOpenings?: BallotOpeningVaultPort;
  private readonly resolveRevealContext: NonNullable<
    MidnightCivicActionStateResolver['resolveRevealContext']
  >;
  private readonly pendingReveals = new Map<string, Promise<CanonicalReceipt>>();
  private readonly receipts = new Map<string, CanonicalReceipt>();
  private readonly pendingVotes = new Map<
    string,
    {
      readonly choice: CastVoteRequest['choice'];
      readonly authorizationHandle: string;
      readonly operation: Promise<CanonicalReceipt>;
    }
  >();

  constructor(options: MidnightCivicActionAdapterOptions) {
    this.providers = options.providers;
    this.credential = options.credential;
    this.referenda = new Map(
      options.referenda.map((entry) => {
        if (!entry.referendumId.trim() || !entry.contractAddress.trim()) {
          throw new TypeError('Referendum catalog IDs and addresses must not be empty');
        }
        return [entry.referendumId, entry] as const;
      }),
    );
    if (this.referenda.size !== options.referenda.length) {
      throw new TypeError('Referendum catalog IDs must be unique');
    }
    this.randomBytes = options.randomBytes ?? secureRandomBytes;
    const canonical = createCanonicalStateResolver(
      options.providers,
      options.registryHistory,
      options.nowUnix ?? (() => Math.floor(Date.now() / 1000)),
    );
    this.stateResolver = options.stateResolver ?? canonical;
    this.resolveRevealContext =
      options.stateResolver?.resolveRevealContext?.bind(options.stateResolver) ??
      canonical.resolveRevealContext;
    this.ballotOpenings = options.ballotOpenings;
    this.executorFactory = options.executorFactory ?? createReferendumV2Executor;
    this.receiptResolver = options.receiptResolver;
    this.actionExecutionContext = options.actionExecutionContext;
  }

  async castVote(request: CastVoteRequest): Promise<CanonicalReceipt> {
    const existing = this.pendingVotes.get(request.referendumId);
    if (existing) {
      if (
        existing.choice !== request.choice ||
        existing.authorizationHandle !== request.authorization.handle
      ) {
        throw new CivicCredentialError(
          'CONFLICT',
          'A different vote is already pending for this referendum',
        );
      }
      return existing.operation;
    }
    const operation = withPrivateStateActionLock(actionLockKey(this.providers), () =>
      this.castVoteOnce(request),
    );
    this.pendingVotes.set(request.referendumId, {
      choice: request.choice,
      authorizationHandle: request.authorization.handle,
      operation,
    });
    try {
      return await operation;
    } finally {
      if (this.pendingVotes.get(request.referendumId)?.operation === operation) {
        this.pendingVotes.delete(request.referendumId);
      }
    }
  }

  private async castVoteOnce(request: CastVoteRequest): Promise<CanonicalReceipt> {
    const entry = this.referenda.get(request.referendumId);
    if (!entry) throw new CivicCredentialError('POLICY_NOT_SATISFIED', 'Unknown referendum');

    const authorization = await this.credential.getActionAuthorization();
    if (!authorization || authorization.handle !== request.authorization.handle) {
      throw new CivicCredentialError(
        'CREDENTIAL_NOT_FOUND',
        'The civic credential authorization is missing or stale',
      );
    }
    const material = await this.credential.getPrivateCredentialMaterial();
    if (!material) {
      throw new CivicCredentialError(
        'CREDENTIAL_NOT_FOUND',
        'The browser has no issued private credential material',
      );
    }

    const held = (await this.ballotOpenings?.list(request.referendumId)) ?? [];
    if (held.some((opening) => opening.status === 'sealed')) {
      // The contract would refuse the repeat anyway, but only after a proof was built.
      throw new CivicCredentialError(
        'ANSWER_ALREADY_SEALED',
        'This device already sealed an answer for this referendum',
      );
    }
    // An earlier attempt may have reached the chain without this device ever
    // seeing the confirmation: the page was dropped, or the wait gave up. Only
    // the chain can say. If it did land, that is the person's answer, and a
    // second proof would be built for nothing.
    const unsettled = ownOpenings(held, entry).filter((opening) => opening.status === 'sealing');
    if (unsettled.length > 0 && this.ballotOpenings) {
      const context = await this.resolveRevealContext(
        entry,
        unsettled.map((opening) => opening.ballotCommitment),
      );
      const landed = context.ballots.findIndex(
        (ballot) => ballot.revealed || ballot.revealPath !== null,
      );
      const opening = landed < 0 ? undefined : unsettled[landed];
      if (opening) {
        await this.ballotOpenings.save({ ...opening, status: 'sealed' });
        throw new CivicCredentialError(
          'ANSWER_ALREADY_SEALED',
          'This device already sealed an answer for this referendum',
        );
      }
    }

    await this.stateResolver.assertCanonicalBinding(entry);
    const voterPath = await this.stateResolver.resolveCredentialPath(
      entry,
      material.credentialLeaf,
    );
    const voteSalt = this.randomBytes(32);
    const privateState = buildReferendumV2VoterPrivateState(
      material,
      voterPath,
      request.choice,
      voteSalt,
    );
    const opening: BallotOpening = {
      referendumId: request.referendumId,
      contractAddress: entry.contractAddress,
      choice: request.choice,
      voteSalt: new Uint8Array(voteSalt),
      ballotCommitment: deriveBallotCommitment(entry.config.eventId, request.choice, voteSalt),
      status: 'sealing',
      countAuthorization: request.authorization.handle,
    };
    // Written before the cast leaves the device. If the response is lost the
    // opening survives, and the chain later says whether the cast landed. A
    // failed attempt is never overwritten by a retry for the same reason.
    await this.ballotOpenings?.save(opening);

    const executor = this.executorFactory(this.providers, entry.config);
    await executor.join(entry.contractAddress, privateState);
    let receipt: CanonicalReceipt;
    try {
      receipt = this.actionExecutionContext
        ? await this.actionExecutionContext.run(
            {
              credentialAuthorization: request.authorization.handle,
              contractAddress: entry.contractAddress,
              circuit: 'castVote',
              action: 'vote',
            },
            () => executor.castVote(),
          )
        : await executor.castVote();
    } catch (error) {
      // The contract's own rule, met while the circuit ran on this device and
      // before any proof: the holder's nullifier is already spent. None of
      // this device's openings is on chain, or the check above would have said
      // so, which means the answer was sealed where its record was not kept.
      if (refusedAsAlreadyAnswered(error)) {
        throw new CivicCredentialError(
          'HOLDER_ALREADY_ANSWERED',
          'The holder of this pass has already answered this referendum, and this device has no record of that answer',
        );
      }
      throw error;
    }
    assertVoteReceipt(receipt, entry.contractAddress, 'castVote');
    await this.ballotOpenings?.save({
      ...opening,
      status: 'sealed',
      sealedAt: receipt.blockTimestamp,
    });
    this.receipts.set(receipt.transactionId, receipt);
    return receipt;
  }

  /**
   * Whether this device's pass can answer this consultation now. It reads the
   * registry and the consultation, as sealing does, and builds no proof. The
   * app asks it while a new pass waits for its root to be published.
   */
  async getPassAdmission(referendumId: string): Promise<PassAdmission> {
    const entry = this.referenda.get(referendumId);
    if (!entry) throw new CivicCredentialError('POLICY_NOT_SATISFIED', 'Unknown referendum');
    const material = await this.credential.getPrivateCredentialMaterial();
    if (!material) return 'no-pass';
    try {
      await this.stateResolver.resolveCredentialPath(entry, material.credentialLeaf);
      return 'admitted';
    } catch (error) {
      if (error instanceof CivicCredentialError) {
        if (error.code === 'CREDENTIAL_NOT_ADMITTED') return 'pending';
        if (error.code === 'CREDENTIAL_ADMISSION_CLOSED') return 'closed';
      }
      throw error;
    }
  }

  /**
   * Where this device's answer stands. Observing a count that already landed
   * removes the opening, so `counted` is reported once; the caller keeps its
   * own marker.
   */
  async getSealedAnswerStatus(referendumId: string): Promise<SealedAnswerStatus> {
    const entry = this.referenda.get(referendumId);
    if (!entry || !this.ballotOpenings) return 'none';
    const openings = ownOpenings(await this.ballotOpenings.list(referendumId), entry);
    if (openings.length === 0) return 'none';
    const context = await this.resolveRevealContext(
      entry,
      openings.map((opening) => opening.ballotCommitment),
    );
    if (context.ballots.some((ballot) => ballot.revealed)) {
      await this.ballotOpenings.clear(referendumId);
      return 'counted';
    }
    return context.ballots.some((ballot) => ballot.revealPath !== null) ? 'sealed' : 'none';
  }

  async revealVote(request: RevealVoteRequest): Promise<CanonicalReceipt> {
    const pending = this.pendingReveals.get(request.referendumId);
    if (pending) return pending;
    const operation = withPrivateStateActionLock(actionLockKey(this.providers), () =>
      this.revealVoteOnce(request),
    );
    this.pendingReveals.set(request.referendumId, operation);
    try {
      return await operation;
    } finally {
      if (this.pendingReveals.get(request.referendumId) === operation) {
        this.pendingReveals.delete(request.referendumId);
      }
    }
  }

  private async revealVoteOnce(request: RevealVoteRequest): Promise<CanonicalReceipt> {
    const entry = this.referenda.get(request.referendumId);
    if (!entry) throw new CivicCredentialError('POLICY_NOT_SATISFIED', 'Unknown referendum');
    const vault = this.ballotOpenings;
    if (!vault) {
      throw new CivicCredentialError(
        'CAPABILITY_UNAVAILABLE',
        'This build keeps no ballot openings, so it cannot count an answer',
      );
    }
    if (request.authorization) {
      const authorization = await this.credential.getActionAuthorization();
      if (!authorization || authorization.handle !== request.authorization.handle) {
        throw new CivicCredentialError(
          'CREDENTIAL_NOT_FOUND',
          'The civic credential authorization is missing or stale',
        );
      }
    }

    const openings = ownOpenings(await vault.list(request.referendumId), entry);
    if (openings.length === 0) {
      throw new CivicCredentialError(
        'BALLOT_OPENING_NOT_FOUND',
        'This device holds no sealed answer for this referendum',
      );
    }
    const context = await this.resolveRevealContext(
      entry,
      openings.map((opening) => opening.ballotCommitment),
    );
    if (context.ballots.length !== openings.length) {
      throw new Error('Reveal context does not match the requested ballot commitments');
    }
    // Only the chain can say which attempt landed; at most one can, because
    // every attempt spends the same referendum nullifier.
    const index = context.ballots.findIndex(
      (ballot) => ballot.revealed || ballot.revealPath !== null,
    );
    const ballot = index < 0 ? undefined : context.ballots[index];
    const opening = index < 0 ? undefined : openings[index];
    if (!ballot || !opening) {
      throw new CivicCredentialError(
        'BALLOT_OPENING_NOT_FOUND',
        'No answer sealed from this device reached the referendum',
      );
    }
    if (ballot.revealed) {
      await vault.clear(request.referendumId);
      throw new CivicCredentialError('CONFLICT', 'This answer was already counted');
    }
    if (context.phase === 'COMMIT' || !context.closed) {
      throw new CivicCredentialError(
        'REVEAL_NOT_OPEN',
        'Answers are still open; the count has not started',
        true,
      );
    }
    if (context.phase === 'FINALIZED') {
      throw new CivicCredentialError('REVEAL_NOT_OPEN', 'The count has closed');
    }
    if (!ballot.revealPath) {
      throw new CivicCredentialError(
        'BALLOT_OPENING_NOT_FOUND',
        'No answer sealed from this device reached the referendum',
      );
    }

    // The relay sponsors the fee against an authorization. A pass that is
    // still valid supplies it; otherwise the one kept with the sealed answer
    // does. A wallet pays for itself and needs neither.
    const sponsorship = request.authorization?.handle ?? opening.countAuthorization;
    if (this.actionExecutionContext && !sponsorship) {
      throw new CivicCredentialError(
        'CREDENTIAL_NOT_FOUND',
        'Nothing on this device can sponsor the count; verify the pass again',
      );
    }

    const executor = this.executorFactory(this.providers, entry.config);
    await executor.join(entry.contractAddress, { role: 'voter', revealPath: ballot.revealPath });
    const count = () => executor.revealVote(opening.choice, new Uint8Array(opening.voteSalt));
    const receipt = this.actionExecutionContext
      ? await this.actionExecutionContext.run(
          {
            credentialAuthorization: sponsorship as string,
            contractAddress: entry.contractAddress,
            circuit: 'revealVote',
            action: 'vote',
          },
          count,
        )
      : await count();
    assertVoteReceipt(receipt, entry.contractAddress, 'revealVote');
    // The opening proves how the answer was cast. Once counted it has no
    // further use, so it does not stay on the device.
    await vault.clear(request.referendumId);
    this.receipts.set(receipt.transactionId, receipt);
    return receipt;
  }

  async recordPublicCohort(_request: PublicCohortRequest): Promise<CanonicalReceipt> {
    throw new CivicCredentialError(
      'CAPABILITY_UNAVAILABLE',
      'Public country cohort disclosure requires a separate audited opt-in contract',
    );
  }

  async getCanonicalReceipt(transactionId: string): Promise<CanonicalReceipt | null> {
    const resolved = await this.receiptResolver?.(transactionId);
    if (resolved) {
      if (resolved.transactionId !== transactionId || resolved.status !== 'confirmed') {
        throw new Error('Canonical receipt resolver returned mismatched public data');
      }
      this.receipts.set(transactionId, resolved);
      return resolved;
    }
    return this.receipts.get(transactionId) ?? null;
  }
}

export function buildReferendumV2VoterPrivateState(
  material: CivicCredentialPrivateMaterial,
  voterPath: MerkleTreePath<Uint8Array>,
  choice: CastVoteRequest['choice'],
  voteSalt: Uint8Array,
): ReferendumV2PrivateState {
  return {
    role: 'voter',
    voterSecret: requireBytes32(material.voterSecret, 'voterSecret'),
    holderBinding: requireBytes32(material.holderBinding, 'holderBinding'),
    holderBlind: requireBytes32(material.holderBlind, 'holderBlind'),
    credentialBlind: requireBytes32(material.credentialBlind, 'credentialBlind'),
    credentialCountry: padBytes32(material.claims.country),
    credentialAgeClass: ageClassCode(material.claims.ageClass),
    credentialAssurance: assuranceCode(material.claims.assurance),
    credentialClaimEpoch: BigInt(material.claims.credentialEpoch),
    credentialValidUntil: isoTimestampSeconds(material.claims.validUntil, 'validUntil'),
    voterPath,
    voterChoice: choice,
    voteSalt: requireBytes32(voteSalt, 'voteSalt'),
  };
}

function createCanonicalStateResolver(
  providers: ReferendumV2Providers,
  registryHistory: CredentialRegistryHistoryPort | undefined,
  nowUnix: () => number,
): Required<MidnightCivicActionStateResolver> {
  // The registry as it was after each earlier pass, newest first. One request
  // lists the blocks; a state is fetched only when the one before it did not do.
  async function* earlierRegistryViews(
    history: CredentialRegistryHistoryPort,
    registryContractAddress: string,
  ): AsyncGenerator<CredentialTreeView> {
    const heights = await history.credentialBlockHeights(registryContractAddress, EARLIER_PASSES);
    for (const blockHeight of heights) {
      const past = await providers.publicDataProvider.queryContractState(registryContractAddress, {
        type: 'blockHeight',
        blockHeight,
      });
      if (past) yield credentialTreeView(past.data);
    }
  }

  return {
    async assertCanonicalBinding(entry) {
      const registryState = await providers.publicDataProvider.queryContractState(
        entry.config.registry.registryContractAddress,
      );
      if (!registryState) throw new Error('Credential registry has no canonical state');
      const referendumState = await providers.publicDataProvider.queryContractState(
        entry.contractAddress,
      );
      if (!referendumState) throw new Error('Referendum has no canonical state');
      const referendum = parseReferendumV2(referendumState.data);
      assertCanonicalReferendumBinding(
        entry.config.registry,
        parseCredentialRegistryV1(registryState.data),
        referendum,
      );
      if (referendum.phase !== 'COMMIT' || referendum.closed) {
        throw new Error('Referendum is not accepting votes');
      }
      if (!equalBytes(referendum.eventId, entry.config.eventId)) {
        throw new Error('Referendum event ID does not match the catalog');
      }
    },
    async resolveCredentialPath(entry, credentialLeaf) {
      const registryContractAddress = entry.config.registry.registryContractAddress;
      const registryState =
        await providers.publicDataProvider.queryContractState(registryContractAddress);
      if (!registryState) throw new Error('Credential registry has no canonical state');
      const referendumState = await providers.publicDataProvider.queryContractState(
        entry.contractAddress,
      );
      if (!referendumState) throw new Error('Referendum has no canonical state');
      const referendum = parseReferendumV2(referendumState.data);
      return resolveAdmittedCredentialPath({
        credentialLeaf,
        current: credentialTreeView(registryState.data),
        frozen: parseCredentialRegistryV1(registryState.data).frozen,
        referendum,
        enrollmentDeadlinePassed: BigInt(nowUnix()) >= referendum.enrollmentClosesAtUnix,
        ...(registryHistory
          ? { earlier: () => earlierRegistryViews(registryHistory, registryContractAddress) }
          : {}),
      });
    },
    async resolveRevealContext(entry, ballotCommitments) {
      const referendumState = await providers.publicDataProvider.queryContractState(
        entry.contractAddress,
      );
      if (!referendumState) throw new Error('Referendum has no canonical state');
      const referendum = parseReferendumV2(referendumState.data);
      if (!equalBytes(referendum.eventId, entry.config.eventId)) {
        throw new Error('Referendum event ID does not match the catalog');
      }
      return {
        phase: referendum.phase,
        closed: referendum.closed,
        ballots: ballotCommitments.map((ballotCommitment) => ({
          ballotCommitment,
          revealPath: ballotPathOrNull(referendumState.data, ballotCommitment),
          revealed: isBallotRevealed(referendumState.data, ballotCommitment),
        })),
      };
    },
  };
}

function ballotPathOrNull(
  data: Parameters<typeof findBallotPath>[0],
  ballotCommitment: Uint8Array,
): MerkleTreePath<Uint8Array> | null {
  try {
    return findBallotPath(data, ballotCommitment);
  } catch {
    return null;
  }
}

/** Openings for this exact contract; a redeployed referendum never reuses an old one. */
function ownOpenings(
  openings: readonly BallotOpening[],
  entry: ReferendumV2CatalogEntry,
): readonly BallotOpening[] {
  return openings.filter((opening) => opening.contractAddress === entry.contractAddress);
}

function requireBytes32(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }
  return new Uint8Array(value);
}

function assertVoteReceipt(
  receipt: CanonicalReceipt,
  contractAddress: string,
  circuit: 'castVote' | 'revealVote',
): void {
  if (
    receipt.status !== 'confirmed' ||
    receipt.action !== 'vote' ||
    receipt.circuit !== circuit ||
    receipt.contractAddress !== contractAddress ||
    receipt.network === 'mainnet'
  ) {
    throw new Error('Midnight did not return a canonical v2 vote receipt');
  }
}

function secureRandomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new CivicCredentialError(
      'ADAPTER_UNAVAILABLE',
      'Secure browser randomness is unavailable',
    );
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function actionLockKey(providers: ReferendumV2Providers): object {
  const privateStateProvider = providers.privateStateProvider as unknown;
  return privateStateProvider !== null &&
    (typeof privateStateProvider === 'object' || typeof privateStateProvider === 'function')
    ? privateStateProvider
    : providers;
}

async function withPrivateStateActionLock<T>(key: object, action: () => Promise<T>): Promise<T> {
  const previous = privateStateActionTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  privateStateActionTails.set(key, current);
  await previous;

  try {
    return await action();
  } finally {
    release();
    if (privateStateActionTails.get(key) === current) {
      privateStateActionTails.delete(key);
    }
  }
}
