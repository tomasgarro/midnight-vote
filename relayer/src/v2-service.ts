import { randomUUID } from 'node:crypto';
import type { CanonicalReceipt } from 'midnight-referendum-api';
import { verifyV2Capability } from './v2-capability.js';
import { actionForCircuit, digestTransaction, v2RequestHash } from './v2-hash.js';
import { V2StoreConflictError } from './v2-store.js';
import {
  type NewV2ActionJob,
  type PublicV2ActionJob,
  publicJob,
  V2ActionError,
  type V2ActionJob,
  type V2ActionRequest,
  type V2ActionStore,
  type V2IndexerReceiptResolver,
  type V2RelayerExecutor,
} from './v2-types.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_TRANSACTION_HEX_LENGTH = 2 * 1024 * 1024;
const forbiddenRequestKeys = new Set(
  [
    'proof',
    'witness',
    'choice',
    'ballot',
    'ballotChoice',
    'voteChoice',
    'secret',
    'seed',
    'seedPhrase',
    'voterSecret',
    'voteSalt',
    'passport',
    'profile',
    'name',
    'email',
    'passportNumber',
    'mrz',
    'mrzData',
    'nfc',
    'nfcPayload',
    'credentialBlind',
    'credentialLeaf',
  ].map((key) => key.toLowerCase()),
);

export interface V2ActionServiceOptions {
  readonly store: V2ActionStore;
  readonly executor: V2RelayerExecutor;
  readonly receiptResolver: V2IndexerReceiptResolver;
  readonly allowedNetworks: readonly string[];
  readonly allowedContracts: readonly string[];
  readonly allowedCircuits: readonly string[];
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly confirmationRetryMs?: number;
  /**
   * Upper bound of a random wait before an accepted action reaches the wallet.
   * The relay sees when a request arrives, and the chain shows when its
   * transaction lands. Submitting at once lets anyone who sees both match a
   * network address to a transaction by time alone. The wait weakens that
   * match when several people answer in the same minute. It does nothing for
   * a lone request. Zero, the default, submits at once.
   */
  readonly submitDelayMaxMs?: number;
  /** A number in [0, 1). Replaced in tests. */
  readonly random?: () => number;
  /** Decode the unbound transaction before it is accepted into the journal. */
  readonly validateTransaction?: (tx: string) => void;
  /** Shared secret used only to verify short-lived trusted action capabilities. */
  readonly capabilitySecret: string;
}

export interface V2RequestHeaders {
  readonly idempotencyKey?: string;
  readonly requestHash?: string;
  readonly capability?: string;
}

/**
 * Atomic walletless action state machine. A request is accepted once, wallet
 * work is serialized, submission is claimed with compare-and-set, and only a
 * confirmed indexer observation can write a receipt.
 */
export class V2ActionService {
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly confirmationRetryMs: number;
  private readonly submitDelayMaxMs: number;
  private readonly random: () => number;
  private readonly transient = new Map<string, { unbound: string; finalized?: string }>();
  private readonly running = new Map<string, Promise<void>>();
  /** Actions that are waiting for their turn at the wallet. */
  private readonly delayed = new Set<string>();
  private walletTail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: V2ActionServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.confirmationRetryMs = options.confirmationRetryMs ?? 2_000;
    this.submitDelayMaxMs = options.submitDelayMaxMs ?? 0;
    if (!Number.isSafeInteger(this.submitDelayMaxMs) || this.submitDelayMaxMs < 0) {
      throw new TypeError('submitDelayMaxMs must be a non-negative whole number');
    }
    this.random = options.random ?? Math.random;
  }

  /** Reconciles persisted jobs after a process restart without resubmitting. */
  async start(): Promise<void> {
    for (const job of await this.options.store.listRecoverable()) {
      if ((job.status === 'submitted' || job.status === 'indexer_pending') && job.transactionId) {
        this.scheduleReconcile(job.id, 0);
        continue;
      }
      // No transaction bytes are persisted. A job interrupted before submit
      // must be explicitly replayed only after operator/indexer reconciliation.
      await this.options.store.transition(
        job.id,
        ['authorized', 'validated', 'dust_reserved', 'finalized'],
        { status: 'recovery_required', errorCode: 'recovery_required' },
      );
    }
  }

  async accept(body: unknown, headers: V2RequestHeaders = {}): Promise<PublicV2ActionJob> {
    const request = parseV2ActionRequest(body, headers, this.options);
    const requestHash = v2RequestHash(request);
    if (request.requestHash && request.requestHash !== requestHash) {
      throw new V2ActionError('invalid_request', 'request hash does not match request', 400);
    }
    let capability: { readonly digest: string; readonly expiresAt: number };
    try {
      capability = verifyV2Capability(headers.capability ?? '', this.options.capabilitySecret, {
        actionId: request.actionId,
        action: request.action,
        contractAddress: request.contractAddress,
        circuit: request.circuit,
        idempotencyKey: request.idempotencyKey,
        network: request.network,
        requestHash,
      });
    } catch {
      throw new V2ActionError('capability_invalid', 'action capability is invalid or expired', 401);
    }
    const actionId = request.actionId;
    const jobInput: NewV2ActionJob = {
      id: actionId,
      actionId,
      idempotencyKey: request.idempotencyKey,
      capabilityDigest: capability.digest,
      requestHash,
      txDigest: digestTransaction(request.tx),
      network: request.network,
      contractAddress: request.contractAddress,
      circuit: request.circuit,
      action: request.action,
      now: this.now(),
    };

    let result: { job: V2ActionJob; created: boolean };
    try {
      result = await this.options.store.createOrGet(jobInput);
    } catch (error) {
      if (error instanceof V2StoreConflictError) {
        throw new V2ActionError('idempotency_conflict', error.message, 409);
      }
      throw error;
    }

    const existing = result.job;
    if (existing.requestHash !== requestHash) {
      throw new V2ActionError('idempotency_conflict', 'idempotency key was already used', 409);
    }
    const existingByKey = await this.options.store.getByIdempotencyKey(request.idempotencyKey);
    if (
      existingByKey &&
      (existingByKey.requestHash !== requestHash ||
        existingByKey.capabilityDigest !== capability.digest)
    ) {
      throw new V2ActionError('idempotency_conflict', 'idempotency key was already used', 409);
    }

    const capabilityReservation = {
      digest: capability.digest,
      actionId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      network: request.network,
      contractAddress: request.contractAddress,
      circuit: request.circuit,
      action: request.action,
      expiresAt: capability.expiresAt,
    };
    if (result.created) {
      // Consume after the idempotency row exists. This ordering closes the
      // crash window where a process could burn a capability and die before
      // creating its durable job. A consumed capability with no job now
      // remains replay-safe by returning the existing job on retry.
      const consumed = await this.options.store.consumeCapability(capabilityReservation);
      if (!consumed) {
        await this.options.store.transition(existing.id, 'authorized', {
          status: 'failed',
          errorCode: 'capability_replayed',
        });
        throw new V2ActionError(
          'capability_replayed',
          'action capability was already consumed',
          409,
        );
      }
    } else if (existing.capabilityDigest === capability.digest) {
      // An exact retry is idempotent. Trying the insert again is harmless if
      // the first process crashed between job creation and capability
      // consumption, and false is expected when it was already consumed.
      await this.options.store.consumeCapability(capabilityReservation);
    }
    // The transaction is memory-only. A duplicate retry can reattach the
    // exact bytes after a restart, but never changes the durable request hash.
    if (existing.status === 'authorized') this.transient.set(existing.id, { unbound: request.tx });
    if (result.created) this.transient.set(existing.id, { unbound: request.tx });

    if (existing.status === 'authorized' && !this.running.has(existing.id)) {
      // Only a new action waits. A retry of one already accepted must not
      // start a second wait, or a client could keep its own action pending.
      const delayMs = result.created ? this.nextSubmitDelay() : 0;
      if (delayMs > 0) this.scheduleRun(existing.id, delayMs);
      else if (!this.delayed.has(existing.id)) this.run(existing.id);
    } else if (
      (existing.status === 'submitted' || existing.status === 'indexer_pending') &&
      existing.transactionId
    ) {
      this.scheduleReconcile(existing.id, 0);
    }
    return publicJob(existing);
  }

  async get(id: string): Promise<PublicV2ActionJob | null> {
    const job = await this.options.store.get(id);
    if (!job) return null;
    if ((job.status === 'submitted' || job.status === 'indexer_pending') && job.transactionId) {
      await this.reconcile(id);
    }
    const latest = await this.options.store.get(id);
    return latest ? publicJob(latest) : null;
  }

  /** Returns a canonical receipt, or null while the indexer is still lagging. */
  async getReceipt(id: string): Promise<CanonicalReceipt | null> {
    const job = await this.options.store.get(id);
    if (!job) return null;
    if (job.status !== 'confirmed' && job.transactionId) await this.reconcile(id);
    const latest = await this.options.store.get(id);
    return latest?.status === 'confirmed' && latest.receipt ? { ...latest.receipt } : null;
  }

  /** Exposed for deterministic tests and operator reconciliation loops. */
  async reconcile(id: string): Promise<PublicV2ActionJob | null> {
    const job = await this.options.store.get(id);
    if (!job) return null;
    if (job.status === 'confirmed' || job.status === 'failed' || !job.transactionId) {
      return publicJob(job);
    }
    try {
      const receipt = await this.options.receiptResolver.resolve({
        transactionId: job.transactionId,
        network: job.network,
        contractAddress: job.contractAddress,
        circuit: job.circuit,
        action: job.action,
      });
      if (!receipt) {
        this.scheduleReconcile(id, this.confirmationRetryMs);
        return publicJob((await this.options.store.get(id)) ?? job);
      }
      await this.options.store.transition(id, ['submitted', 'indexer_pending'], {
        status: 'confirmed',
        receipt,
      });
    } catch (error) {
      const code = error instanceof V2ActionError ? error.code : undefined;
      if (code === 'indexer_contract_mismatch' || code === 'indexer_rejected') {
        await this.options.store.transition(id, ['submitted', 'indexer_pending'], {
          status: 'failed',
          errorCode: code,
        });
      } else {
        this.scheduleReconcile(id, this.confirmationRetryMs);
      }
    }
    const latest = await this.options.store.get(id);
    return latest ? publicJob(latest) : null;
  }

  async waitForIdle(id: string): Promise<void> {
    await this.running.get(id);
  }

  private run(id: string): void {
    const task = this.runWalletStage(id)
      .catch((error: unknown) => this.abandon(id, error))
      .finally(() => {
        this.running.delete(id);
      });
    this.running.set(id, task);
  }

  /**
   * One action that fails unexpectedly must not stop the relay for everyone
   * else. The rejection used to go unhandled, which ends the process: a single
   * failed write to the action store took the relayer down in the middle of
   * a rehearsal.
   *
   * The action is left exactly where a restart would leave it. Before
   * submission it is marked for recovery, and the person's device asks again
   * with a new capability. After submission it is reconciled against the
   * indexer and never submitted a second time.
   */
  private async abandon(id: string, error: unknown): Promise<void> {
    this.transient.delete(id);
    console.error(
      `[relayer] action ${id} stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    );
    try {
      await this.options.store.transition(
        id,
        ['authorized', 'validated', 'dust_reserved', 'finalized'],
        { status: 'recovery_required', errorCode: 'recovery_required' },
      );
    } catch {
      // The store is what failed. A restart marks the action the same way.
    }
    this.scheduleReconcile(id, this.confirmationRetryMs);
  }

  private async runWalletStage(id: string): Promise<void> {
    await this.enqueueWallet(async () => {
      const job = await this.options.store.get(id);
      const pending = this.transient.get(id);
      if (job?.status !== 'authorized' || !pending) return;
      const validated = await this.options.store.transition(id, 'authorized', {
        status: 'validated',
      });
      if (!validated) return;
      const reserved = await this.options.store.reserveDust(id, `${id}:${this.idFactory()}`);
      if (!reserved) {
        this.scheduleRun(id, this.confirmationRetryMs);
        return;
      }

      let finalized: string;
      try {
        finalized = await this.options.executor.balanceAndFinalize(pending.unbound);
      } catch {
        this.transient.delete(id);
        await this.options.store.transition(id, 'dust_reserved', {
          status: 'failed',
          errorCode: 'transaction_rejected',
        });
        return;
      }
      this.transient.set(id, { ...pending, finalized });
      const derivedId = this.options.executor.transactionId?.(finalized);
      await this.options.store.transition(id, 'dust_reserved', {
        status: 'finalized',
        ...(derivedId ? { transactionId: derivedId } : {}),
      });
      const submittedIntent = await this.options.store.transition(id, 'finalized', {
        // Durable submission intent is written before the network call. If a
        // process dies after this point, restart reconciles instead of retrying.
        status: 'submitted',
      });
      if (!submittedIntent) return;

      let transactionId: string;
      try {
        transactionId = requireTransactionId(await this.options.executor.submit(finalized));
      } catch {
        // If the node response was lost, the already-created transaction must
        // be reconciled, never blindly submitted a second time.
        this.transient.delete(id);
        if (derivedId) {
          await this.options.store.transition(id, 'submitted', {
            status: 'indexer_pending',
            transactionId: derivedId,
          });
          this.scheduleReconcile(id, this.confirmationRetryMs);
        } else {
          await this.options.store.transition(id, 'submitted', {
            status: 'recovery_required',
            errorCode: 'submission_unknown',
          });
        }
        return;
      }
      if (derivedId && transactionId !== derivedId) {
        // The SDK normally derives the identifier from the finalized bytes.
        // A different node response means the submission boundary is
        // ambiguous; never attach an indexer receipt to the wrong request.
        this.transient.delete(id);
        await this.options.store.transition(id, 'submitted', {
          status: 'failed',
          errorCode: 'submission_id_mismatch',
        });
        return;
      }
      this.transient.delete(id);
      await this.options.store.transition(id, 'submitted', {
        status: 'indexer_pending',
        transactionId,
      });
      this.scheduleReconcile(id, 0);
    });
  }

  private scheduleReconcile(id: string, delayMs: number): void {
    const timer = setTimeout(() => {
      // A reconciliation that cannot reach the store is tried again later. It
      // must not end the process either.
      this.reconcile(id).catch((error: unknown) => {
        console.error(
          `[relayer] reconciling ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.scheduleReconcile(id, Math.max(this.confirmationRetryMs, 1_000));
      });
    }, delayMs);
    timer.unref?.();
  }

  private scheduleRun(id: string, delayMs: number): void {
    this.delayed.add(id);
    const timer = setTimeout(() => {
      this.delayed.delete(id);
      if (!this.running.has(id)) this.run(id);
    }, delayMs);
    timer.unref?.();
  }

  private nextSubmitDelay(): number {
    if (this.submitDelayMaxMs === 0) return 0;
    const sample = this.random();
    const bounded = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0;
    return Math.min(Math.floor(bounded * (this.submitDelayMaxMs + 1)), this.submitDelayMaxMs);
  }

  private async enqueueWallet<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.walletTail.then(operation, operation);
    this.walletTail = run.catch(() => undefined);
    return run;
  }
}

function parseV2ActionRequest(
  value: unknown,
  headers: V2RequestHeaders,
  options: V2ActionServiceOptions,
): V2ActionRequest {
  if (!isRecord(value)) throw new V2ActionError('invalid_request', 'request must be a JSON object');
  assertNoForbiddenKeys(value);
  const idempotencyKey = field(value.idempotencyKey ?? headers.idempotencyKey, 'idempotency key');
  if (
    headers.idempotencyKey &&
    value.idempotencyKey &&
    headers.idempotencyKey !== value.idempotencyKey
  ) {
    throw new V2ActionError('invalid_request', 'idempotency key header does not match body', 400);
  }
  const requestHash = optionalDigest(value.requestHash ?? headers.requestHash, 'request hash');
  if (headers.requestHash && value.requestHash && headers.requestHash !== value.requestHash) {
    throw new V2ActionError('invalid_request', 'request hash header does not match body', 400);
  }
  const network = field(value.network, 'network');
  const contractAddress = field(value.contractAddress, 'contract address');
  const circuit = field(value.circuit, 'circuit');
  const tx = value.tx ?? value.transaction;
  if (
    typeof tx !== 'string' ||
    tx.length === 0 ||
    tx.length > MAX_TRANSACTION_HEX_LENGTH ||
    !/^[0-9a-f]+$/iu.test(tx) ||
    tx.length % 2 !== 0
  ) {
    throw new V2ActionError('invalid_request', 'tx must be an even-length hexadecimal transaction');
  }
  const action = value.action === undefined ? actionForCircuit(circuit) : value.action;
  if (action !== 'credential' && action !== 'vote' && action !== 'cohort') {
    throw new V2ActionError('invalid_request', 'action is not supported');
  }
  if (value.action !== undefined && value.action !== actionForCircuit(circuit)) {
    throw new V2ActionError('invalid_request', 'action does not match circuit');
  }
  if (!options.allowedNetworks.includes(network)) {
    throw new V2ActionError('not_allowlisted', 'network is not allowlisted', 403);
  }
  if (!options.allowedContracts.includes(contractAddress)) {
    throw new V2ActionError('not_allowlisted', 'contract is not allowlisted', 403);
  }
  if (!options.allowedCircuits.includes(circuit)) {
    throw new V2ActionError('not_allowlisted', 'circuit is not allowlisted', 403);
  }
  options.validateTransaction?.(tx);
  const actionId = field(value.actionId, 'action id');
  return {
    actionId,
    idempotencyKey,
    requestHash,
    network,
    contractAddress,
    circuit,
    action,
    tx: tx.toLowerCase(),
  };
}

function field(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new V2ActionError('invalid_request', `${label} is invalid`);
  }
  return value;
}

function optionalDigest(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value)) {
    throw new V2ActionError('invalid_request', `${label} is invalid`);
  }
  return value.toLowerCase();
}

function requireTransactionId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new Error('submit did not return a transaction id');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keep private identity, credential, ballot, and witness material out of the
 * relay boundary even when a caller tries to hide it in a nested metadata
 * object. The transaction itself remains an opaque hex string and is decoded
 * only by the configured transaction validator.
 */
function assertNoForbiddenKeys(value: Record<string, unknown>): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
      continue;
    }
    if (!isRecord(candidate)) continue;
    for (const [key, child] of Object.entries(candidate)) {
      if (forbiddenRequestKeys.has(key.toLowerCase())) {
        throw new V2ActionError('invalid_request', 'private witness fields are not accepted');
      }
      if (typeof child === 'object' && child !== null) pending.push(child);
    }
  }
}
