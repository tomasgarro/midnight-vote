import { asContractAddress, type PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  type CanonicalReceipt,
  type CredentialRegistryV1Executor,
  type CredentialRegistryV1PrivateState,
  type CredentialRegistryV1State,
  parseCredentialRegistryV1,
  parseReferendumV2,
  type ReferendumV2Executor,
  type ReferendumV2PrivateState,
  type ReferendumV2State,
} from 'midnight-referendum-api';

/**
 * Reads canonical registry/referendum ledger state through the indexer.
 * Caller-supplied roots are never trusted; every decision is made from a
 * fresh canonical read.
 */
export interface CredentialRootPublisherReader {
  readRegistry(registryContractAddress: string): Promise<CredentialRegistryV1State>;
  readReferendum(referendumContractAddress: string): Promise<ReferendumV2State>;
}

export class MidnightCredentialRootPublisherReader implements CredentialRootPublisherReader {
  constructor(private readonly publicDataProvider: PublicDataProvider) {}

  async readRegistry(registryContractAddress: string): Promise<CredentialRegistryV1State> {
    const address = asContractAddress(registryContractAddress);
    const canonical = await this.publicDataProvider.queryContractState(address);
    if (!canonical) throw new Error('Canonical credential registry state is unavailable');
    return parseCredentialRegistryV1(canonical.data);
  }

  async readReferendum(referendumContractAddress: string): Promise<ReferendumV2State> {
    const address = asContractAddress(referendumContractAddress);
    const canonical = await this.publicDataProvider.queryContractState(address);
    if (!canonical) throw new Error('Canonical referendum state is unavailable');
    return parseReferendumV2(canonical.data);
  }
}

/** One open referendum this publisher is authorized to admit roots into. */
export interface CredentialRootPublisherReferendumTarget {
  readonly contractAddress: string;
  readonly executor: ReferendumV2Executor;
  /** Private root-publisher secret for this referendum; mirrors organizerSecret. */
  readonly rootPublisherSecret: Uint8Array;
}

export interface CredentialRootPublisherLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export interface CredentialRootPublisherOptions {
  readonly registryExecutor: CredentialRegistryV1Executor;
  readonly registryContractAddress: string;
  readonly reader: CredentialRootPublisherReader;
  readonly referenda: readonly CredentialRootPublisherReferendumTarget[];
  /** Minimum number of newly-enrolled credentials before publishing a root; default 16. */
  readonly minBatchSize?: number;
  /** Publish an under-sized batch anyway once it has waited this long; default 900_000 (15 min). */
  readonly maxWaitMs?: number;
  /** How often `start()` runs a publish cycle; default 60_000 (1 min). */
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly logger?: CredentialRootPublisherLogger;
  /**
   * Runs one transaction at a time across the whole service. The publisher
   * shares the issuer's wallet and its registry executor, so each of its
   * transactions goes through the queue that issuance uses. One transaction
   * per turn: a person getting a pass is not held behind a whole cycle.
   */
  readonly walletMutation?: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface CredentialRootPublisherReferendumOutcome {
  readonly contractAddress: string;
  /**
   * `already-admitted`: the consultation holds this root, so nothing was sent.
   * `enrollment-closed`: it admits no more passes, or its answers are over.
   * `gave-up`: publishing this root failed too often; a later root is tried again.
   */
  readonly status: 'published' | 'failed' | 'already-admitted' | 'enrollment-closed' | 'gave-up';
  readonly transactionId?: string;
  readonly error?: string;
}

export type CredentialRootPublishSkipReason =
  | 'no-referenda-configured'
  | 'unchanged'
  | 'no-new-credentials'
  /** Every configured consultation already holds this root, or takes no more. */
  | 'nothing-to-admit'
  | 'below-minimum-batch'
  | 'attestation-failed'
  /** The root was attested and no consultation took it this time; it is tried again. */
  | 'publish-failed';

export interface CredentialRootPublishSkipped {
  readonly published: false;
  readonly reason: CredentialRootPublishSkipReason;
  readonly batchSize?: number;
  readonly error?: string;
  readonly referenda?: readonly CredentialRootPublisherReferendumOutcome[];
}

export interface CredentialRootPublishSucceeded {
  readonly published: true;
  /** The registry root's field element, as a decimal string; roots are public data. */
  readonly rootField: string;
  readonly batchSize: number;
  /** Honest, explicit flag: this batch was smaller than minBatchSize (forced by wait/deadline). */
  readonly belowMinimum: boolean;
  readonly attestationTransactionId: string;
  readonly referenda: readonly CredentialRootPublisherReferendumOutcome[];
}

export type CredentialRootPublishResult =
  | CredentialRootPublishSkipped
  | CredentialRootPublishSucceeded;

/**
 * What the publisher can honestly say about the current batch.
 *
 * This exists so the UI can explain the wait between enrolling and being able
 * to vote. Every field is either observed or null -- never a placeholder zero,
 * because "we have not looked yet" and "nothing has happened" are different
 * facts and the second one is reassuring in a way the first has not earned.
 */
export interface CredentialRootPublisherStatus {
  /**
   * Credentials enrolled since the last published root, as of the last
   * completed cycle. Null before the first cycle has run.
   */
  readonly pendingCount: number | null;
  /** Publishing happens once the batch reaches this size... */
  readonly minBatchSize: number;
  /** ...or once an under-sized batch has waited this long, whichever is first. */
  readonly maxWaitMs: number;
  /** When the current pending root first appeared. Null when nothing is pending. */
  readonly pendingSinceMs: number | null;
  /**
   * The deadline the wait is bounded by: an under-sized batch publishes anyway
   * at this point. Null when nothing is pending.
   */
  readonly publishesNoLaterThanMs: number | null;
  /** When the last root was successfully published. Null before the first one. */
  readonly lastPublishedAtMs: number | null;
  /** When this snapshot was taken, so a caller can reason about staleness. */
  readonly observedAtMs: number;
}

const DEFAULT_MIN_BATCH_SIZE = 16;
const DEFAULT_MAX_WAIT_MS = 900_000;
const DEFAULT_INTERVAL_MS = 60_000;
/** How often one root is offered to one consultation before the publisher stops trying. */
const MAX_PUBLISH_ATTEMPTS = 5;

const noopLogger: CredentialRootPublisherLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Periodically admits the credential registry's current root into every
 * configured open referendum, so that people who enroll after a referendum
 * deploys can still vote.
 *
 * Every publish is preceded, in a separate transaction, by
 * `CredentialRegistryV1Executor.attestRegistryRoot`. That attestation is the
 * only on-chain proof that an admitted root really came from the registry
 * (Midnight has no cross-contract calls, so the referendum cannot check this
 * itself — see docs/ROOT-ATTESTATION-AUDIT.md). A failed attestation must
 * never be followed by a publish.
 *
 * Each consultation is read before anything is sent. One that already holds
 * the root, or that admits no more passes, gets no transaction, and when no
 * consultation needs the root there is no attestation either: a restart costs
 * nothing. One whose publish failed is offered the same root again in the
 * next cycle, a few times, without a second attestation. A person whose pass
 * is in that root waits on this, so a failure must not be forgotten.
 *
 * To protect voter anonymity, a root that admits very few new credentials is
 * withheld until either `minBatchSize` is reached, `maxWaitMs` has elapsed
 * since the root started pending, or an enrollment deadline is imminent for
 * one of the configured referenda. An under-sized batch that is published
 * anyway is flagged `belowMinimum: true` rather than hidden.
 */
export class CredentialRootPublisher {
  private readonly registryExecutor: CredentialRegistryV1Executor;
  private readonly registryContractAddress: string;
  private readonly reader: CredentialRootPublisherReader;
  private readonly referenda: readonly CredentialRootPublisherReferendumTarget[];
  private readonly minBatchSize: number;
  private readonly maxWaitMs: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly logger: CredentialRootPublisherLogger;
  private readonly walletMutation: <T>(operation: () => Promise<T>) => Promise<T>;

  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly joinedReferenda = new Set<string>();

  /** Root field of the last root this publisher successfully admitted; null before the first publish. */
  private lastPublishedRootField: bigint | null = null;
  /** Registry credentialCount as of the last successful publish. */
  private lastPublishedCredentialCount = 0n;
  /** Root field currently waiting to be published (may be below the batch minimum). */
  private pendingRootField: bigint | null = null;
  private pendingSinceMs: number | null = null;
  /** Batch size seen by the last completed cycle; null before the first one. */
  private lastObservedBatchSize: number | null = null;
  private lastPublishedAtMs: number | null = null;
  /** The pending root's attestation, kept so a retry does not attest twice. */
  private attested: { readonly rootField: bigint; readonly transactionId: string } | null = null;
  /** Consultations that took the pending root in an earlier cycle. */
  private readonly publishedTo = new Set<string>();
  /** Failed attempts to give the pending root to a consultation. */
  private readonly failedAttempts = new Map<string, number>();

  private lastResult: CredentialRootPublishResult | undefined;
  private lastError: unknown;

  constructor(options: CredentialRootPublisherOptions) {
    if (!options.registryContractAddress.trim()) {
      throw new TypeError('registryContractAddress must not be empty');
    }
    this.registryExecutor = options.registryExecutor;
    this.registryContractAddress = options.registryContractAddress;
    this.reader = options.reader;
    this.referenda = options.referenda;
    this.minBatchSize = requirePositiveInteger(
      options.minBatchSize ?? DEFAULT_MIN_BATCH_SIZE,
      'minBatchSize',
    );
    this.maxWaitMs = requirePositiveInteger(options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, 'maxWaitMs');
    this.intervalMs = requirePositiveInteger(
      options.intervalMs ?? DEFAULT_INTERVAL_MS,
      'intervalMs',
    );
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? noopLogger;
    this.walletMutation = options.walletMutation ?? ((operation) => operation());
    for (const target of this.referenda) {
      requireBytes32(target.rootPublisherSecret, 'rootPublisherSecret');
    }
  }

  /** Runs a single publish cycle now. Safe to call directly (e.g. from tests). */
  publishOnce(): Promise<CredentialRootPublishResult> {
    return this.exclusive(() => this.cycle());
  }

  /** Starts the periodic timer. A no-op if already started; never runs two cycles at once. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.trigger(), this.intervalMs);
    this.timer.unref?.();
  }

  /**
   * Runs a cycle now, without waiting for it. Called when a pass was just
   * issued: its holder is waiting for the root, so the next tick is too late.
   * A failure is logged and left to the next cycle.
   */
  trigger(): void {
    this.publishOnce().catch((error) => {
      this.lastError = error;
      this.logger.error('credential-root-publisher: publish cycle failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLastResult(): CredentialRootPublishResult | undefined {
    return this.lastResult;
  }

  getLastError(): unknown {
    return this.lastError;
  }

  /**
   * A snapshot of the current batch, for the enrollment wait in the UI.
   *
   * Read-only: this never triggers a cycle, so it reports what the last cycle
   * observed rather than what is true right now. `observedAtMs` is included so
   * a caller can see how fresh that is.
   */
  getStatus(): CredentialRootPublisherStatus {
    return {
      pendingCount: this.lastObservedBatchSize,
      minBatchSize: this.minBatchSize,
      maxWaitMs: this.maxWaitMs,
      pendingSinceMs: this.pendingSinceMs,
      publishesNoLaterThanMs:
        this.pendingSinceMs === null ? null : this.pendingSinceMs + this.maxWaitMs,
      lastPublishedAtMs: this.lastPublishedAtMs,
      observedAtMs: this.now(),
    };
  }

  private async cycle(): Promise<CredentialRootPublishResult> {
    try {
      const result = await this.runCycle();
      this.lastResult = result;
      return result;
    } catch (error) {
      this.lastError = error;
      throw error;
    }
  }

  private async runCycle(): Promise<CredentialRootPublishResult> {
    if (this.referenda.length === 0) {
      return { published: false, reason: 'no-referenda-configured' };
    }

    const registryState = await this.reader.readRegistry(this.registryContractAddress);
    const currentRootField = registryState.currentRoot.field;

    if (this.lastPublishedRootField !== null && this.lastPublishedRootField === currentRootField) {
      this.lastObservedBatchSize = 0;
      return { published: false, reason: 'unchanged' };
    }

    if (this.pendingRootField !== currentRootField) {
      this.pendingRootField = currentRootField;
      this.pendingSinceMs = this.now();
      this.publishedTo.clear();
      this.failedAttempts.clear();
    }

    const batchSize = registryState.credentialCount - this.lastPublishedCredentialCount;
    this.lastObservedBatchSize = Number(batchSize > 0n ? batchSize : 0n);
    if (batchSize <= 0n) {
      return { published: false, reason: 'no-new-credentials' };
    }

    const settled: CredentialRootPublisherReferendumOutcome[] = [];
    const due: CredentialRootPublisherReferendumTarget[] = [];
    for (const target of this.referenda) {
      const standing = await this.standingOf(target, currentRootField);
      if (standing === 'due') due.push(target);
      else settled.push({ contractAddress: target.contractAddress, status: standing });
    }
    if (due.length === 0) {
      this.settle(currentRootField, registryState.credentialCount);
      return { published: false, reason: 'nothing-to-admit', referenda: settled };
    }

    const meetsMinimum = batchSize >= BigInt(this.minBatchSize);
    const waitedMs = this.now() - (this.pendingSinceMs ?? this.now());
    const waitedLongEnough = waitedMs >= this.maxWaitMs;

    if (!meetsMinimum && !waitedLongEnough) {
      const deadlineImminent = await this.isEnrollmentDeadlineImminent();
      if (!deadlineImminent) {
        return {
          published: false,
          reason: 'below-minimum-batch',
          batchSize: Number(batchSize),
        };
      }
    }

    const belowMinimum = !meetsMinimum;

    if (this.attested?.rootField !== currentRootField) {
      try {
        const receipt = await this.attest(registryState.currentRoot);
        this.attested = { rootField: currentRootField, transactionId: receipt.transactionId };
      } catch (error) {
        this.logger.warn('credential-root-publisher: attestation failed, refusing to publish', {
          message: error instanceof Error ? error.message : String(error),
        });
        return { published: false, reason: 'attestation-failed' };
      }
    }
    const attestationTransactionId = this.attested.transactionId;

    const referendumOutcomes: CredentialRootPublisherReferendumOutcome[] = [...settled];
    let publishedNow = 0;
    let stillOwed = 0;
    for (const target of due) {
      try {
        const receipt = await this.publishToReferendum(target, registryState.currentRoot);
        this.publishedTo.add(target.contractAddress);
        publishedNow += 1;
        referendumOutcomes.push({
          contractAddress: target.contractAddress,
          status: 'published',
          transactionId: receipt.transactionId,
        });
      } catch (error) {
        const attempts = (this.failedAttempts.get(target.contractAddress) ?? 0) + 1;
        this.failedAttempts.set(target.contractAddress, attempts);
        const gaveUp = attempts >= MAX_PUBLISH_ATTEMPTS;
        if (!gaveUp) stillOwed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          gaveUp
            ? 'credential-root-publisher: gave up publishing this root to a referendum'
            : 'credential-root-publisher: publish to referendum failed, will retry',
          { contractAddress: target.contractAddress, attempts, message },
        );
        referendumOutcomes.push({
          contractAddress: target.contractAddress,
          status: gaveUp ? 'gave-up' : 'failed',
          error: message,
        });
      }
    }

    // While a consultation is still owed this root, the root stays pending and
    // the next cycle offers it again to that consultation only.
    if (stillOwed === 0) this.settle(currentRootField, registryState.credentialCount);

    if (publishedNow === 0) {
      return {
        published: false,
        reason: 'publish-failed',
        batchSize: Number(batchSize),
        referenda: referendumOutcomes,
      };
    }

    if (belowMinimum) {
      this.logger.warn('credential-root-publisher: published an under-sized batch', {
        batchSize: Number(batchSize),
        minBatchSize: this.minBatchSize,
      });
    }
    this.logger.info('credential-root-publisher: root published', {
      rootField: currentRootField.toString(),
      batchSize: Number(batchSize),
      published: publishedNow,
      stillOwed,
    });

    return {
      published: true,
      rootField: currentRootField.toString(),
      batchSize: Number(batchSize),
      belowMinimum,
      attestationTransactionId,
      referenda: referendumOutcomes,
    };
  }

  /** Nothing more is owed for this root: it is the last published one. */
  private settle(rootField: bigint, credentialCount: bigint): void {
    this.lastPublishedRootField = rootField;
    this.lastPublishedCredentialCount = credentialCount;
    this.pendingRootField = null;
    this.pendingSinceMs = null;
    this.lastObservedBatchSize = 0;
    this.lastPublishedAtMs = this.now();
    this.publishedTo.clear();
    this.failedAttempts.clear();
  }

  /**
   * Whether a consultation is still owed this root. Decided from its state on
   * chain. When that cannot be read, the root is offered: the contract refuses
   * what it should not take, and a person is not left waiting on a failed read.
   */
  private async standingOf(
    target: CredentialRootPublisherReferendumTarget,
    rootField: bigint,
  ): Promise<'due' | 'already-admitted' | 'enrollment-closed' | 'gave-up'> {
    if (this.publishedTo.has(target.contractAddress)) return 'already-admitted';
    if ((this.failedAttempts.get(target.contractAddress) ?? 0) >= MAX_PUBLISH_ATTEMPTS) {
      return 'gave-up';
    }
    let state: ReferendumV2State;
    try {
      state = await this.reader.readReferendum(target.contractAddress);
    } catch (error) {
      this.logger.warn('credential-root-publisher: could not read referendum, offering the root', {
        contractAddress: target.contractAddress,
        message: error instanceof Error ? error.message : String(error),
      });
      return 'due';
    }
    if (state.acceptedCredentialRoots.some((root) => root.field === rootField)) {
      return 'already-admitted';
    }
    const nowSeconds = BigInt(Math.floor(this.now() / 1000));
    if (
      state.enrollmentClosed ||
      state.closed ||
      state.phase !== 'COMMIT' ||
      nowSeconds >= state.enrollmentClosesAtUnix ||
      // The contract never takes back a root it revoked.
      state.revokedCredentialRoots.some((root) => root.field === rootField)
    ) {
      return 'enrollment-closed';
    }
    return 'due';
  }

  private async isEnrollmentDeadlineImminent(): Promise<boolean> {
    const nowSeconds = BigInt(Math.floor(this.now() / 1000));
    const thresholdSeconds = BigInt(Math.ceil(this.maxWaitMs / 1000));
    for (const target of this.referenda) {
      try {
        const state = await this.reader.readReferendum(target.contractAddress);
        if (state.enrollmentClosed) continue;
        const remaining = state.enrollmentClosesAtUnix - nowSeconds;
        if (remaining <= thresholdSeconds) return true;
      } catch (error) {
        this.logger.warn('credential-root-publisher: could not read referendum deadline', {
          contractAddress: target.contractAddress,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return false;
  }

  private attest(root: CredentialRegistryV1State['currentRoot']): Promise<CanonicalReceipt> {
    return this.walletMutation(async () => {
      // The issuer joins the registry with a person's claims before every
      // pass, so the publisher sets its own, empty state again each time.
      await this.registryExecutor.join(this.registryContractAddress, attestationPrivateState());
      return this.registryExecutor.attestRegistryRoot(root);
    });
  }

  private publishToReferendum(
    target: CredentialRootPublisherReferendumTarget,
    root: CredentialRegistryV1State['currentRoot'],
  ): Promise<CanonicalReceipt> {
    return this.walletMutation(async () => {
      if (!this.joinedReferenda.has(target.contractAddress)) {
        await target.executor.join(
          target.contractAddress,
          rootPublisherPrivateState(target.rootPublisherSecret),
        );
        this.joinedReferenda.add(target.contractAddress);
      }
      return target.executor.publishCredentialRoot(root);
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function attestationPrivateState(): CredentialRegistryV1PrivateState {
  const empty = () => new Uint8Array(32);
  return {
    issuerSecret: empty(),
    holderBinding: empty(),
    credentialBlind: empty(),
    credentialCountry: empty(),
    credentialAgeClass: 0n,
    credentialAssurance: 0n,
    credentialClaimEpoch: 0n,
    credentialValidUntil: 0n,
  };
}

function rootPublisherPrivateState(rootPublisherSecret: Uint8Array): ReferendumV2PrivateState {
  return {
    role: 'organizer',
    rootPublisherSecret: new Uint8Array(rootPublisherSecret),
  };
}

function requireBytes32(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }
  return value;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}
