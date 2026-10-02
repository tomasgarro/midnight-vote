import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CanonicalReceipt } from 'midnight-referendum-api';
import type { EvidenceAuthorizationStore } from './credential-issuer-service.js';

/** Options shared by the local durable JSON stores. */
export interface DurableFileStoreOptions {
  /** Main state file. Its parent directory is created when the first operation runs. */
  readonly filePath?: string;
  /** Alias for filePath, useful when wiring from a config object. */
  readonly path?: string;
  /** Optional lock-file location; defaults to `${filePath}.lock`. */
  readonly lockPath?: string;
  /** Maximum time to wait for another process to release the lock. */
  readonly lockTimeoutMs?: number;
  /** Age after which a lock owned by a dead process may be recovered. */
  readonly staleLockMs?: number;
}

export type DurableFileStoreInput = string | DurableFileStoreOptions;

export interface CanonicalReceiptStore {
  /** Stores a confirmed public receipt; the same transaction is idempotent. */
  put(receipt: CanonicalReceipt): Promise<void>;
  /** Alias for put, retained for callers that use save terminology. */
  save(receipt: CanonicalReceipt): Promise<void>;
  /** Looks up a receipt after a process restart. */
  get(transactionId: string): Promise<CanonicalReceipt | null>;
  /** Resolver-shaped alias for get. */
  resolve(transactionId: string): Promise<CanonicalReceipt | null>;
  /** CivicActionPort-compatible method name. */
  getCanonicalReceipt(transactionId: string): Promise<CanonicalReceipt | null>;
}

export type CanonicalReceiptResolver = (transactionId: string) => Promise<CanonicalReceipt | null>;

export interface CredentialIssuanceRecord {
  /** SHA-256 digest of the issuer's complete request material. */
  readonly fingerprintHash: string;
  readonly result: import('midnight-referendum-api').CivicCredentialIssuanceResult;
}

export interface CredentialIssuanceStore {
  get(enrollmentId: string): Promise<CredentialIssuanceRecord | null>;
  put(
    enrollmentId: string,
    fingerprintHash: string,
    result: import('midnight-referendum-api').CivicCredentialIssuanceResult,
  ): Promise<void>;
  /** Public opaque issuance handle lookup used to authorize a short-lived action capability. */
  hasIssuanceId?(issuanceId: string): Promise<boolean>;
}

/** Thrown when an immutable local record is reused with different material. */
export class DurableStoreConflictError extends Error {
  readonly code = 'CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DurableStoreConflictError';
  }
}

/**
 * File-backed, inter-process-safe implementation of the issuer's one-time
 * evidence authorization boundary.
 *
 * Only SHA-256 digests of the opaque authorization, enrollment, and optional
 * issuance material are persisted. In particular, the raw token and any
 * provider proof/MRZ/passport value never enter the state file.
 */
export class FileEvidenceAuthorizationStore implements EvidenceAuthorizationStore {
  private readonly store: AtomicJsonStore<EvidenceState>;

  constructor(input: DurableFileStoreInput) {
    this.store = new AtomicJsonStore(input, emptyEvidenceState, parseEvidenceState);
  }

  /**
   * Claims an authorization atomically. Repeating the same authorization for
   * the same enrollment is accepted; a different enrollment or known
   * issuance material is rejected. The third argument is intentionally
   * optional for compatibility with the original two-argument port.
   */
  async claim(
    evidenceAuthorization: string,
    enrollmentId: string,
    issuanceMaterial?: string,
  ): Promise<boolean> {
    requireNonEmpty(evidenceAuthorization, 'evidenceAuthorization');
    requireNonEmpty(enrollmentId, 'enrollmentId');
    if (issuanceMaterial !== undefined) {
      requireNonEmpty(issuanceMaterial, 'issuanceMaterial');
    }

    const authorizationKey = digest('evidence', evidenceAuthorization);
    const enrollmentKey = digest('enrollment', enrollmentId);
    const materialKey =
      issuanceMaterial === undefined ? undefined : digest('material', issuanceMaterial);

    return this.store.update(async (state) => {
      const existing = state.authorizations[authorizationKey];
      if (!existing) {
        state.authorizations[authorizationKey] = {
          enrollmentKey,
          ...(materialKey ? { materialKey } : {}),
        };
        return true;
      }
      if (existing.enrollmentKey !== enrollmentKey) return false;
      if (existing.materialKey && materialKey && existing.materialKey !== materialKey) {
        return false;
      }
      // A caller that learns the issuance material after an earlier
      // two-argument claim may safely strengthen the record.
      if (!existing.materialKey && materialKey) {
        existing.materialKey = materialKey;
      }
      return true;
    });
  }
}

/**
 * Which holder a document belongs to, for one registry epoch.
 *
 * A document may be verified more than once: a pass expires and is renewed.
 * It may not move to another holder, because each holder can answer a
 * consultation once, and two holders would be two answers for one document.
 */
export interface DocumentBindingStore {
  /**
   * Ties the document to the holder if it has none.
   *
   * | Result | Meaning |
   * | --- | --- |
   * | `bound` | The document had no holder. It has this one now |
   * | `same` | It already had this holder: a renewal or a retry |
   * | `other` | It has another holder. Nothing was changed |
   */
  bind(documentTag: string, holderBinding: string): Promise<'bound' | 'same' | 'other'>;
}

/**
 * File-backed document bindings. Only SHA-256 digests are persisted: of the
 * document tag, which is itself a hash of a proof's nullifier, and of the
 * holder's public binding. Neither says who anybody is.
 */
export class FileDocumentBindingStore implements DocumentBindingStore {
  private readonly store: AtomicJsonStore<DocumentBindingState>;

  constructor(input: DurableFileStoreInput) {
    this.store = new AtomicJsonStore(input, emptyDocumentBindingState, parseDocumentBindingState);
  }

  async bind(documentTag: string, holderBinding: string): Promise<'bound' | 'same' | 'other'> {
    requireNonEmpty(documentTag, 'documentTag');
    requireNonEmpty(holderBinding, 'holderBinding');
    const documentKey = digest('document', documentTag);
    const holderKey = digest('holder', holderBinding);
    return this.store.update(async (state) => {
      const existing = state.documents[documentKey];
      if (!existing) {
        state.documents[documentKey] = holderKey;
        return 'bound';
      }
      return existing === holderKey ? 'same' : 'other';
    });
  }
}

/** Durable public transaction receipt index for restart/recovery lookups. */
export class FileCanonicalReceiptStore implements CanonicalReceiptStore {
  private readonly store: AtomicJsonStore<ReceiptState>;

  constructor(input: DurableFileStoreInput) {
    this.store = new AtomicJsonStore(input, emptyReceiptState, parseReceiptState);
  }

  async put(receipt: CanonicalReceipt): Promise<void> {
    const canonical = canonicalReceipt(receipt);
    return this.store.update(async (state) => {
      const existing = state.receipts[canonical.transactionId];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(canonical)) {
          throw new DurableStoreConflictError(
            'Transaction receipt already exists with different public data',
          );
        }
        return;
      }
      state.receipts[canonical.transactionId] = canonical;
    });
  }

  save(receipt: CanonicalReceipt): Promise<void> {
    return this.put(receipt);
  }

  async get(transactionId: string): Promise<CanonicalReceipt | null> {
    requireNonEmpty(transactionId, 'transactionId');
    const state = await this.store.read();
    const receipt = state.receipts[transactionId];
    return receipt ? { ...receipt } : null;
  }

  resolve(transactionId: string): Promise<CanonicalReceipt | null> {
    return this.get(transactionId);
  }

  getCanonicalReceipt(transactionId: string): Promise<CanonicalReceipt | null> {
    return this.get(transactionId);
  }
}

/**
 * Durable idempotency record for credential issuance. The credential blind is
 * issuer-generated private material required to replay the exact response;
 * it is stored only in the permission-restricted local state file. Provider
 * proof, MRZ/NFC/passport data, voter secrets, holder blinds, and ballot data
 * are not accepted by this record shape.
 */
export class FileCredentialIssuanceStore implements CredentialIssuanceStore {
  private readonly store: AtomicJsonStore<IssuanceState>;

  constructor(input: DurableFileStoreInput) {
    this.store = new AtomicJsonStore(input, emptyIssuanceState, parseIssuanceState);
  }

  async get(enrollmentId: string): Promise<CredentialIssuanceRecord | null> {
    requireNonEmpty(enrollmentId, 'enrollmentId');
    const state = await this.store.read();
    const record = state.issuances[digest('enrollment', enrollmentId)];
    return record ? decodeIssuanceRecord(record) : null;
  }

  async put(
    enrollmentId: string,
    fingerprintHash: string,
    result: import('midnight-referendum-api').CivicCredentialIssuanceResult,
  ): Promise<void> {
    requireNonEmpty(enrollmentId, 'enrollmentId');
    requireDigest(fingerprintHash, 'fingerprintHash');
    const canonical = serializeIssuanceResult(result);
    const enrollmentKey = digest('enrollment', enrollmentId);
    return this.store.update(async (state) => {
      const existing = state.issuances[enrollmentKey];
      if (existing) {
        if (existing.fingerprintHash !== fingerprintHash) {
          throw new DurableStoreConflictError(
            'Enrollment already has a credential with different issuance material',
          );
        }
        if (JSON.stringify(existing.result) !== JSON.stringify(canonical)) {
          throw new DurableStoreConflictError(
            'Enrollment already has a credential with different issuance result',
          );
        }
        return;
      }
      state.issuances[enrollmentKey] = { fingerprintHash, result: canonical };
    });
  }

  async hasIssuanceId(issuanceId: string): Promise<boolean> {
    requireNonEmpty(issuanceId, 'issuanceId');
    const state = await this.store.read();
    return Object.values(state.issuances).some((record) => record.result.issuanceId === issuanceId);
  }
}

/** Names that make the storage choice explicit at call sites. */
export const DurableEvidenceAuthorizationStore = FileEvidenceAuthorizationStore;
export const DurableCanonicalReceiptStore = FileCanonicalReceiptStore;
export const DurableCredentialIssuanceStore = FileCredentialIssuanceStore;

export function createFileEvidenceAuthorizationStore(
  input: DurableFileStoreInput,
): FileEvidenceAuthorizationStore {
  return new FileEvidenceAuthorizationStore(input);
}

export function createFileCanonicalReceiptStore(
  input: DurableFileStoreInput,
): FileCanonicalReceiptStore {
  return new FileCanonicalReceiptStore(input);
}

export function createFileCredentialIssuanceStore(
  input: DurableFileStoreInput,
): FileCredentialIssuanceStore {
  return new FileCredentialIssuanceStore(input);
}

/** Hashes the complete in-memory issuer request before persistence. */
export function issuanceFingerprint(material: string): string {
  requireNonEmpty(material, 'issuance material');
  return digest('issuance', material);
}

interface EvidenceAuthorizationRecord {
  readonly enrollmentKey: string;
  materialKey?: string;
}

interface EvidenceState {
  readonly version: 1;
  readonly authorizations: Record<string, EvidenceAuthorizationRecord>;
}

interface DocumentBindingState {
  readonly version: 1;
  readonly documents: Record<string, string>;
}

function emptyDocumentBindingState(): DocumentBindingState {
  return { version: 1, documents: {} };
}

function parseDocumentBindingState(value: unknown): DocumentBindingState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.documents)) {
    throw new Error('Document binding state is corrupt or unsupported');
  }
  const documents: Record<string, string> = {};
  for (const [key, holder] of Object.entries(value.documents)) {
    if (
      !/^[a-f0-9]{64}$/u.test(key) ||
      typeof holder !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(holder)
    ) {
      throw new Error('Document binding state is corrupt or unsupported');
    }
    documents[key] = holder;
  }
  return { version: 1, documents };
}

interface ReceiptState {
  readonly version: 1;
  readonly receipts: Record<string, CanonicalReceipt>;
}

interface IssuanceState {
  readonly version: 1;
  readonly issuances: Record<string, PersistedCredentialIssuanceRecord>;
}

interface PersistedCredentialIssuanceRecord {
  readonly fingerprintHash: string;
  readonly result: PersistedCredentialIssuanceResult;
}

interface PersistedCredentialIssuanceResult {
  readonly issuanceId: string;
  readonly credentialBlindHex: string;
  readonly credentialLeafHex: string;
  readonly receipt: CanonicalReceipt;
}

const emptyEvidenceState = (): EvidenceState => ({ version: 1, authorizations: {} });
const emptyReceiptState = (): ReceiptState => ({ version: 1, receipts: {} });
const emptyIssuanceState = (): IssuanceState => ({ version: 1, issuances: {} });

function parseEvidenceState(value: unknown): EvidenceState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.authorizations)) {
    throw new Error('Evidence authorization state is corrupt or unsupported');
  }
  const authorizations: Record<string, EvidenceAuthorizationRecord> = {};
  for (const [key, item] of Object.entries(value.authorizations)) {
    if (
      !/^[a-f0-9]{64}$/u.test(key) ||
      !isRecord(item) ||
      typeof item.enrollmentKey !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(item.enrollmentKey) ||
      (item.materialKey !== undefined &&
        (typeof item.materialKey !== 'string' || !/^[a-f0-9]{64}$/u.test(item.materialKey)))
    ) {
      throw new Error('Evidence authorization state is corrupt or unsupported');
    }
    authorizations[key] = {
      enrollmentKey: item.enrollmentKey,
      ...(item.materialKey ? { materialKey: item.materialKey } : {}),
    };
  }
  return { version: 1, authorizations };
}

function parseReceiptState(value: unknown): ReceiptState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.receipts)) {
    throw new Error('Canonical receipt state is corrupt or unsupported');
  }
  const receipts: Record<string, CanonicalReceipt> = {};
  for (const [key, valueForKey] of Object.entries(value.receipts)) {
    const receipt = canonicalReceipt(valueForKey);
    if (key !== receipt.transactionId) {
      throw new Error('Canonical receipt state has a mismatched transaction key');
    }
    receipts[key] = receipt;
  }
  return { version: 1, receipts };
}

function parseIssuanceState(value: unknown): IssuanceState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.issuances)) {
    throw new Error('Credential issuance state is corrupt or unsupported');
  }
  const issuances: Record<string, PersistedCredentialIssuanceRecord> = {};
  for (const [key, item] of Object.entries(value.issuances)) {
    if (!/^[a-f0-9]{64}$/u.test(key) || !isRecord(item)) {
      throw new Error('Credential issuance state is corrupt or unsupported');
    }
    const fingerprintHash = item.fingerprintHash;
    if (typeof fingerprintHash !== 'string' || !/^[a-f0-9]{64}$/u.test(fingerprintHash)) {
      throw new Error('Credential issuance state is corrupt or unsupported');
    }
    issuances[key] = {
      fingerprintHash,
      result: parsePersistedIssuanceResult(item.result),
    };
  }
  return { version: 1, issuances };
}

function canonicalReceipt(value: unknown): CanonicalReceipt {
  if (!isRecord(value)) throw new TypeError('receipt must be an object');
  const action = value.action;
  const network = value.network;
  if (
    value.status !== 'confirmed' ||
    (action !== 'credential' && action !== 'vote' && action !== 'cohort') ||
    network !== 'preview' ||
    typeof value.transactionId !== 'string' ||
    typeof value.transactionHash !== 'string' ||
    typeof value.contractAddress !== 'string' ||
    typeof value.circuit !== 'string' ||
    !Number.isSafeInteger(value.blockHeight) ||
    (value.blockHeight as number) < 0 ||
    typeof value.blockHash !== 'string' ||
    typeof value.blockTimestamp !== 'string' ||
    !value.transactionId ||
    !value.transactionHash ||
    !value.contractAddress ||
    !value.circuit ||
    !value.blockHash ||
    !value.blockTimestamp ||
    (value.explorerUrl !== undefined && typeof value.explorerUrl !== 'string')
  ) {
    throw new TypeError('receipt is not a canonical confirmed public receipt');
  }
  return {
    status: 'confirmed',
    action,
    network,
    transactionId: value.transactionId,
    transactionHash: value.transactionHash,
    contractAddress: value.contractAddress,
    circuit: value.circuit,
    blockHeight: value.blockHeight as number,
    blockHash: value.blockHash,
    blockTimestamp: value.blockTimestamp,
    ...(value.explorerUrl !== undefined ? { explorerUrl: value.explorerUrl } : {}),
  };
}

function parsePersistedIssuanceResult(value: unknown): PersistedCredentialIssuanceResult {
  if (!isRecord(value)) throw new TypeError('issuance result must be an object');
  const issuanceId = value.issuanceId;
  const credentialBlindHex = value.credentialBlindHex;
  const credentialLeafHex = value.credentialLeafHex;
  if (
    typeof issuanceId !== 'string' ||
    issuanceId.length === 0 ||
    typeof credentialBlindHex !== 'string' ||
    typeof credentialLeafHex !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(credentialBlindHex) ||
    !/^[a-f0-9]{64}$/u.test(credentialLeafHex)
  ) {
    throw new TypeError('issuance result has invalid private/public material');
  }
  return {
    issuanceId,
    credentialBlindHex,
    credentialLeafHex,
    receipt: canonicalReceipt(value.receipt),
  };
}

function serializeIssuanceResult(
  value: import('midnight-referendum-api').CivicCredentialIssuanceResult,
): PersistedCredentialIssuanceResult {
  const credentialBlindHex = bytes32Hex(value.credentialBlind, 'credentialBlind');
  const credentialLeafHex = bytes32Hex(value.credentialLeaf, 'credentialLeaf');
  return {
    issuanceId: value.issuanceId,
    credentialBlindHex,
    credentialLeafHex,
    receipt: canonicalReceipt(value.receipt),
  };
}

function decodeIssuanceRecord(record: PersistedCredentialIssuanceRecord): CredentialIssuanceRecord {
  return {
    fingerprintHash: record.fingerprintHash,
    result: {
      issuanceId: record.result.issuanceId,
      credentialBlind: bytesFromHex(record.result.credentialBlindHex),
      credentialLeaf: bytesFromHex(record.result.credentialLeafHex),
      receipt: { ...record.result.receipt },
    },
  };
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytes32Hex(value: Uint8Array, label: string): string {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }
  return bytesToHex(value);
}

function requireDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${label} must be a SHA-256 digest`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

function digest(domain: string, value: string): string {
  return createHash('sha256').update(`cico:${domain}:v1:`).update(value, 'utf8').digest('hex');
}

interface ResolvedStoreOptions {
  readonly filePath: string;
  readonly lockPath: string;
  readonly lockTimeoutMs: number;
  readonly staleLockMs: number;
}

function resolveStoreOptions(input: DurableFileStoreInput): ResolvedStoreOptions {
  const options = typeof input === 'string' ? { filePath: input } : input;
  const filePath = options.filePath ?? options.path;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('A durable store filePath is required');
  }
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  const staleLockMs = options.staleLockMs ?? 30_000;
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
    throw new TypeError('lockTimeoutMs must be a positive safe integer');
  }
  if (!Number.isSafeInteger(staleLockMs) || staleLockMs <= 0) {
    throw new TypeError('staleLockMs must be a positive safe integer');
  }
  return {
    filePath,
    lockPath: options.lockPath ?? `${filePath}.lock`,
    lockTimeoutMs,
    staleLockMs,
  };
}

type StateFactory<T> = () => T;
type StateParser<T> = (value: unknown) => T;

/** Small atomic JSON engine shared by both stores. */
class AtomicJsonStore<T extends object> {
  private readonly options: ResolvedStoreOptions;
  private readonly initial: StateFactory<T>;
  private readonly parse: StateParser<T>;

  constructor(input: DurableFileStoreInput, initial: StateFactory<T>, parse: StateParser<T>) {
    this.options = resolveStoreOptions(input);
    this.initial = initial;
    this.parse = parse;
  }

  async read(): Promise<T> {
    await ensurePrivateDirectory(dirname(this.options.filePath));
    try {
      return this.parse(JSON.parse(await readFile(this.options.filePath, 'utf8')));
    } catch (error) {
      if (isMissingFile(error)) return this.initial();
      throw error;
    }
  }

  async update<R>(mutator: (state: T) => Promise<R>): Promise<R> {
    await ensurePrivateDirectory(dirname(this.options.filePath));
    const lock = await acquireLock(this.options);
    try {
      await removeStaleTemps(this.options.filePath);
      let state: T;
      try {
        state = this.parse(JSON.parse(await readFile(this.options.filePath, 'utf8')));
      } catch (error) {
        if (!isMissingFile(error)) throw error;
        state = this.initial();
      }
      const result = await mutator(state);
      await writeAtomic(this.options.filePath, state);
      return result;
    } finally {
      await lock.release();
    }
  }
}

interface LockHandle {
  release(): Promise<void>;
}

async function acquireLock(options: ResolvedStoreOptions): Promise<LockHandle> {
  const deadline = Date.now() + options.lockTimeoutMs;
  await ensurePrivateDirectory(dirname(options.lockPath));
  for (;;) {
    try {
      const handle = await open(options.lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
          'utf8',
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await restrictPermissions(options.lockPath, 0o600);
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          await rm(options.lockPath, { force: true });
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error) && !(await isWindowsLockContention(error, options.lockPath))) {
        throw error;
      }
      if (await recoverDeadLock(options)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for durable store lock ${options.lockPath}`);
      }
      await delay(10);
    }
  }
}

async function isWindowsLockContention(error: unknown, lockPath: string): Promise<boolean> {
  if (!error || typeof error !== 'object') return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'EPERM' && code !== 'EACCES') return false;
  // Windows may report EPERM while another task is closing or unlinking the
  // lock, even after the directory permissions have already been validated.
  if (process.platform === 'win32') return true;
  try {
    await stat(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function recoverDeadLock(options: ResolvedStoreOptions): Promise<boolean> {
  let lockStat: Awaited<ReturnType<typeof stat>>;
  try {
    lockStat = await stat(options.lockPath);
  } catch (error) {
    return isMissingFile(error);
  }
  if (Date.now() - lockStat.mtimeMs < options.staleLockMs) return false;
  let ownerPid: number | undefined;
  try {
    const metadata = JSON.parse(await readFile(options.lockPath, 'utf8')) as unknown;
    if (isRecord(metadata) && Number.isSafeInteger(metadata.pid)) {
      ownerPid = metadata.pid as number;
    }
  } catch {
    // A partially written lock is only recoverable once its mtime is stale.
  }
  if (ownerPid !== undefined && isProcessAlive(ownerPid)) return false;
  try {
    await unlink(options.lockPath);
    return true;
  } catch (error) {
    return isMissingFile(error);
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function writeAtomic(filePath: string, value: object): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await restrictPermissions(tempPath, 0o600);
    await rename(tempPath, filePath);
    await restrictPermissions(filePath, 0o600);
    await syncDirectory(dirname(filePath));
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function removeStaleTemps(filePath: string): Promise<void> {
  const directory = dirname(filePath);
  const prefix = `${filePath.split(/[\\/]/u).pop() ?? 'state'}.tmp-`;
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => rm(join(directory, entry), { force: true })),
  );
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await restrictPermissions(directory, 0o700);
}

async function restrictPermissions(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOSYS' && code !== 'ENOTSUP' && code !== 'EPERM') throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM') throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
