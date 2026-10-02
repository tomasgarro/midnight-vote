import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sanitizeCanonicalReceipt } from 'midnight-referendum-api';
import type {
  NewV2ActionJob,
  V2ActionJob,
  V2ActionJobStatus,
  V2ActionStore,
  V2CapabilityReservation,
} from './v2-types.js';

export class V2StoreConflictError extends Error {
  readonly code = 'idempotency_conflict' as const;

  constructor(message: string) {
    super(message);
    this.name = 'V2StoreConflictError';
  }
}

const recoverableStatuses: readonly V2ActionJobStatus[] = [
  'authorized',
  'validated',
  'dust_reserved',
  'finalized',
  'submitted',
  'indexer_pending',
];

/** Deterministic adapter used by unit tests and a single-process local pilot. */
export class InMemoryV2ActionStore implements V2ActionStore {
  private readonly jobs = new Map<string, V2ActionJob>();
  private readonly capabilities = new Map<string, V2CapabilityReservation>();
  private tail: Promise<unknown> = Promise.resolve();

  async createOrGet(input: NewV2ActionJob): Promise<{ job: V2ActionJob; created: boolean }> {
    return this.mutate(() => {
      const existing =
        this.jobs.get(input.id) ??
        [...this.jobs.values()].find(
          (job) =>
            job.idempotencyKey === input.idempotencyKey || job.requestHash === input.requestHash,
        );
      if (existing) {
        if (existing.requestHash !== input.requestHash) {
          throw new V2StoreConflictError('Idempotency key was already used for another action');
        }
        return { job: cloneJob(existing), created: false };
      }
      const job: V2ActionJob = {
        id: requireId(input.id, 'id'),
        idempotencyKey: requireId(input.idempotencyKey, 'idempotencyKey'),
        capabilityDigest: requireDigest(input.capabilityDigest, 'capabilityDigest'),
        requestHash: requireDigest(input.requestHash, 'requestHash'),
        txDigest: requireDigest(input.txDigest, 'txDigest'),
        network: requireId(input.network, 'network'),
        contractAddress: requireId(input.contractAddress, 'contractAddress'),
        circuit: requireId(input.circuit, 'circuit'),
        action: input.action,
        status: 'authorized',
        transitions: ['authorized'],
        createdAt: input.now,
        updatedAt: input.now,
      };
      this.jobs.set(job.id, job);
      return { job: cloneJob(job), created: true };
    });
  }

  async get(id: string): Promise<V2ActionJob | null> {
    return this.mutate(() => {
      const job = this.jobs.get(id);
      return job ? cloneJob(job) : null;
    });
  }

  async getByIdempotencyKey(key: string): Promise<V2ActionJob | null> {
    return this.mutate(() => {
      const job = [...this.jobs.values()].find((candidate) => candidate.idempotencyKey === key);
      return job ? cloneJob(job) : null;
    });
  }

  async consumeCapability(reservation: V2CapabilityReservation): Promise<boolean> {
    return this.mutate(() => {
      const existing = this.capabilities.get(reservation.digest);
      if (existing) return false;
      this.capabilities.set(reservation.digest, { ...reservation });
      return true;
    });
  }

  async transition(
    id: string,
    expected: V2ActionJobStatus | readonly V2ActionJobStatus[],
    patch: Partial<
      Pick<V2ActionJob, 'status' | 'dustReservationId' | 'transactionId' | 'receipt' | 'errorCode'>
    >,
  ): Promise<V2ActionJob | null> {
    return this.mutate(() => {
      const job = this.jobs.get(id);
      if (!job || !(Array.isArray(expected) ? expected : [expected]).includes(job.status))
        return null;
      const next = {
        ...job,
        ...patch,
        transitions:
          patch.status && patch.status !== job.status
            ? [...job.transitions, patch.status]
            : job.transitions,
        updatedAt: new Date().toISOString(),
      };
      const receipt = next.receipt ? sanitizeCanonicalReceipt(next.receipt) : undefined;
      const persisted: V2ActionJob = { ...next, ...(receipt ? { receipt } : {}) };
      this.jobs.set(id, persisted);
      return cloneJob(persisted);
    });
  }

  async reserveDust(id: string, reservationId: string): Promise<V2ActionJob | null> {
    return this.mutate(() => {
      const job = this.jobs.get(id);
      const active = [...this.jobs.values()].some(
        (candidate) =>
          candidate.id !== id &&
          (candidate.status === 'dust_reserved' ||
            candidate.status === 'finalized' ||
            candidate.status === 'submitted' ||
            candidate.status === 'indexer_pending'),
      );
      if (!job || job.status !== 'validated' || active) return null;
      const next: V2ActionJob = {
        ...job,
        status: 'dust_reserved',
        transitions: [...job.transitions, 'dust_reserved'],
        dustReservationId: reservationId,
        updatedAt: new Date().toISOString(),
      };
      this.jobs.set(id, next);
      return cloneJob(next);
    });
  }

  async listRecoverable(): Promise<readonly V2ActionJob[]> {
    return this.mutate(() =>
      [...this.jobs.values()]
        .filter((job) => recoverableStatuses.includes(job.status))
        .map(cloneJob),
    );
  }

  private async mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

interface V2FileState {
  readonly version: 1;
  readonly jobs: Record<string, V2ActionJob>;
  readonly capabilities: Record<string, V2CapabilityReservation>;
}

export interface V2FileStoreOptions {
  readonly filePath: string;
  readonly lockPath?: string;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
}

/**
 * Atomic JSON adapter for local recovery tests and a loopback pilot. The
 * interface is intentionally transaction-shaped so PostgreSQL can replace it
 * with `INSERT ... ON CONFLICT`, row locks, and compare-and-set updates.
 */
export class FileV2ActionStore implements V2ActionStore {
  private readonly options: Required<V2FileStoreOptions>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(input: string | V2FileStoreOptions) {
    const options = typeof input === 'string' ? { filePath: input } : input;
    if (!options.filePath) throw new TypeError('V2 action store filePath is required');
    this.options = {
      filePath: options.filePath,
      lockPath: options.lockPath ?? `${options.filePath}.lock`,
      lockTimeoutMs: options.lockTimeoutMs ?? 10_000,
      staleLockMs: options.staleLockMs ?? 30_000,
    };
  }

  async createOrGet(input: NewV2ActionJob): Promise<{ job: V2ActionJob; created: boolean }> {
    return this.update((state) => {
      const existing =
        state.jobs[input.id] ??
        Object.values(state.jobs).find(
          (job) =>
            job.idempotencyKey === input.idempotencyKey || job.requestHash === input.requestHash,
        );
      if (existing) {
        if (existing.requestHash !== input.requestHash) {
          throw new V2StoreConflictError('Idempotency key was already used for another action');
        }
        return { job: cloneJob(existing), created: false };
      }
      const job: V2ActionJob = {
        id: requireId(input.id, 'id'),
        idempotencyKey: requireId(input.idempotencyKey, 'idempotencyKey'),
        capabilityDigest: requireDigest(input.capabilityDigest, 'capabilityDigest'),
        requestHash: requireDigest(input.requestHash, 'requestHash'),
        txDigest: requireDigest(input.txDigest, 'txDigest'),
        network: requireId(input.network, 'network'),
        contractAddress: requireId(input.contractAddress, 'contractAddress'),
        circuit: requireId(input.circuit, 'circuit'),
        action: input.action,
        status: 'authorized',
        transitions: ['authorized'],
        createdAt: input.now,
        updatedAt: input.now,
      };
      state.jobs[job.id] = job;
      return { job: cloneJob(job), created: true };
    });
  }

  async get(id: string): Promise<V2ActionJob | null> {
    const state = await this.read();
    const job = state.jobs[id];
    return job ? cloneJob(job) : null;
  }

  async getByIdempotencyKey(key: string): Promise<V2ActionJob | null> {
    const state = await this.read();
    const job = Object.values(state.jobs).find((candidate) => candidate.idempotencyKey === key);
    return job ? cloneJob(job) : null;
  }

  async consumeCapability(reservation: V2CapabilityReservation): Promise<boolean> {
    return this.update((state) => {
      if (state.capabilities[reservation.digest]) return false;
      state.capabilities[reservation.digest] = { ...reservation };
      return true;
    });
  }

  async transition(
    id: string,
    expected: V2ActionJobStatus | readonly V2ActionJobStatus[],
    patch: Partial<
      Pick<V2ActionJob, 'status' | 'dustReservationId' | 'transactionId' | 'receipt' | 'errorCode'>
    >,
  ): Promise<V2ActionJob | null> {
    return this.update((state) => {
      const job = state.jobs[id];
      if (!job || !(Array.isArray(expected) ? expected : [expected]).includes(job.status))
        return null;
      const next = {
        ...job,
        ...patch,
        transitions:
          patch.status && patch.status !== job.status
            ? [...job.transitions, patch.status]
            : job.transitions,
        updatedAt: new Date().toISOString(),
      };
      const receipt = next.receipt ? sanitizeCanonicalReceipt(next.receipt) : undefined;
      const persisted: V2ActionJob = { ...next, ...(receipt ? { receipt } : {}) };
      state.jobs[id] = persisted;
      return cloneJob(persisted);
    });
  }

  async reserveDust(id: string, reservationId: string): Promise<V2ActionJob | null> {
    return this.update((state) => {
      const job = state.jobs[id];
      const active = Object.values(state.jobs).some(
        (candidate) =>
          candidate.id !== id &&
          (candidate.status === 'dust_reserved' ||
            candidate.status === 'finalized' ||
            candidate.status === 'submitted' ||
            candidate.status === 'indexer_pending'),
      );
      if (!job || job.status !== 'validated' || active) return null;
      const next: V2ActionJob = {
        ...job,
        status: 'dust_reserved',
        transitions: [...job.transitions, 'dust_reserved'],
        dustReservationId: reservationId,
        updatedAt: new Date().toISOString(),
      };
      state.jobs[id] = next;
      return cloneJob(next);
    });
  }

  async listRecoverable(): Promise<readonly V2ActionJob[]> {
    const state = await this.read();
    return Object.values(state.jobs)
      .filter((job) => recoverableStatuses.includes(job.status))
      .map(cloneJob);
  }

  private async read(): Promise<V2FileState> {
    await mkdir(dirname(this.options.filePath), { recursive: true, mode: 0o700 });
    try {
      return parseState(JSON.parse(await readFile(this.options.filePath, 'utf8')));
    } catch (error) {
      if (isMissing(error)) return emptyState();
      throw error;
    }
  }

  private async update<T>(operation: (state: V2FileState) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(
      () => this.withLock(operation),
      () => this.withLock(operation),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async withLock<T>(operation: (state: V2FileState) => T | Promise<T>): Promise<T> {
    await mkdir(dirname(this.options.filePath), { recursive: true, mode: 0o700 });
    const lock = await acquireLock(this.options);
    try {
      const state = await this.read();
      const result = await operation(state);
      await writeAtomic(this.options.filePath, state);
      return result;
    } finally {
      await lock.release();
    }
  }
}

function emptyState(): V2FileState {
  return { version: 1, jobs: {}, capabilities: {} };
}

function parseState(value: unknown): V2FileState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.jobs)) {
    throw new Error('V2 action state is corrupt or unsupported');
  }
  const jobs: Record<string, V2ActionJob> = {};
  for (const [id, valueForId] of Object.entries(value.jobs)) {
    const job = parseJob(valueForId);
    if (job.id !== id) throw new Error('V2 action state has a mismatched job key');
    jobs[id] = job;
  }
  const capabilities: Record<string, V2CapabilityReservation> = {};
  if (value.capabilities !== undefined) {
    if (!isRecord(value.capabilities)) throw new Error('V2 action capability state is corrupt');
    for (const [digest, item] of Object.entries(value.capabilities)) {
      const capability = parseCapability(item);
      if (digest !== capability.digest) throw new Error('V2 capability state has a mismatched key');
      capabilities[digest] = capability;
    }
  }
  return { version: 1, jobs, capabilities };
}

function parseJob(value: unknown): V2ActionJob {
  if (!isRecord(value)) throw new Error('V2 action state contains an invalid job');
  const status = value.status;
  if (
    typeof value.id !== 'string' ||
    typeof value.idempotencyKey !== 'string' ||
    !isDigest(value.requestHash) ||
    !isDigest(value.capabilityDigest) ||
    !isDigest(value.txDigest) ||
    typeof value.network !== 'string' ||
    typeof value.contractAddress !== 'string' ||
    typeof value.circuit !== 'string' ||
    !isAction(value.action) ||
    !isStatus(status) ||
    (value.transitions !== undefined &&
      (!Array.isArray(value.transitions) || !value.transitions.every(isStatus))) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.transactionId !== undefined && typeof value.transactionId !== 'string') ||
    (value.dustReservationId !== undefined && typeof value.dustReservationId !== 'string') ||
    (value.errorCode !== undefined && typeof value.errorCode !== 'string')
  ) {
    throw new Error('V2 action state contains an invalid job');
  }
  return {
    id: value.id,
    idempotencyKey: value.idempotencyKey,
    capabilityDigest: value.capabilityDigest,
    requestHash: value.requestHash,
    txDigest: value.txDigest,
    network: value.network,
    contractAddress: value.contractAddress,
    circuit: value.circuit,
    action: value.action,
    status,
    transitions:
      value.transitions === undefined
        ? [status]
        : (value.transitions as readonly V2ActionJobStatus[]),
    ...(value.dustReservationId ? { dustReservationId: value.dustReservationId } : {}),
    ...(value.transactionId ? { transactionId: value.transactionId } : {}),
    ...(value.receipt ? { receipt: sanitizeCanonicalReceipt(value.receipt) } : {}),
    ...(value.errorCode ? { errorCode: value.errorCode as V2ActionJob['errorCode'] } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function cloneJob(job: V2ActionJob): V2ActionJob {
  return {
    ...job,
    transitions: [...job.transitions],
    ...(job.receipt ? { receipt: { ...job.receipt } } : {}),
  };
}

function requireId(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new TypeError(`${label} must be a non-empty value of at most 256 characters`);
  }
  return value;
}

function requireDigest(value: string, label: string): string {
  if (!isDigest(value)) throw new TypeError(`${label} must be a SHA-256 digest`);
  return value;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isAction(value: unknown): value is V2ActionJob['action'] {
  return value === 'credential' || value === 'vote' || value === 'cohort';
}

function parseCapability(value: unknown): V2CapabilityReservation {
  if (
    !isRecord(value) ||
    !isDigest(value.digest) ||
    typeof value.actionId !== 'string' ||
    typeof value.idempotencyKey !== 'string' ||
    !isDigest(value.requestHash) ||
    typeof value.network !== 'string' ||
    typeof value.contractAddress !== 'string' ||
    typeof value.circuit !== 'string' ||
    !isAction(value.action) ||
    !Number.isSafeInteger(value.expiresAt)
  ) {
    throw new Error('V2 action capability state is corrupt');
  }
  return {
    digest: value.digest,
    actionId: value.actionId,
    idempotencyKey: value.idempotencyKey,
    requestHash: value.requestHash,
    network: value.network,
    contractAddress: value.contractAddress,
    circuit: value.circuit,
    action: value.action,
    expiresAt: value.expiresAt as number,
  };
}

function isStatus(value: unknown): value is V2ActionJobStatus {
  return (
    value === 'authorized' ||
    value === 'validated' ||
    value === 'dust_reserved' ||
    value === 'finalized' ||
    value === 'submitted' ||
    value === 'indexer_pending' ||
    value === 'confirmed' ||
    value === 'failed' ||
    value === 'recovery_required'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface LockOptions {
  readonly lockPath: string;
  readonly lockTimeoutMs: number;
  readonly staleLockMs: number;
}

interface LockHandle {
  release(): Promise<void>;
}

async function acquireLock(options: LockOptions): Promise<LockHandle> {
  const deadline = Date.now() + options.lockTimeoutMs;
  await mkdir(dirname(options.lockPath), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      const file = await open(options.lockPath, 'wx', 0o600);
      try {
        await file.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      return {
        async release() {
          await rm(options.lockPath, { force: true });
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await recoverStaleLock(options)) continue;
      if (Date.now() >= deadline) throw new Error('Timed out waiting for v2 action store lock');
      await delay(10);
    }
  }
}

async function recoverStaleLock(options: LockOptions): Promise<boolean> {
  try {
    const lockStat = await stat(options.lockPath);
    if (Date.now() - lockStat.mtimeMs < options.staleLockMs) return false;
    let ownerPid: number | undefined;
    try {
      const metadata = JSON.parse(await readFile(options.lockPath, 'utf8')) as unknown;
      if (isRecord(metadata) && Number.isSafeInteger(metadata.pid))
        ownerPid = metadata.pid as number;
    } catch {
      // A stale, partially-written lock is recoverable.
    }
    if (ownerPid !== undefined && ownerPid !== process.pid && isProcessAlive(ownerPid))
      return false;
    await unlink(options.lockPath);
    return true;
  } catch (error) {
    return isMissing(error);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function writeAtomic(filePath: string, state: V2FileState): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const file = await open(tempPath, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await renameOver(tempPath, filePath);
    await chmod(filePath, 0o600).catch((error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'ENOTSUP') throw error;
    });
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Replaces `filePath` with `tempPath`. On Windows a rename over a file that
 * anything else has open, a virus scanner included, fails with EPERM, EBUSY
 * or EACCES for a moment. It is retried briefly. On Linux, where the relayer
 * is deployed, the first attempt succeeds.
 */
async function renameOver(tempPath: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tempPath, filePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 9 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
