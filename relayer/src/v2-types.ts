import type { CanonicalReceipt, CivicActionKind } from 'midnight-referendum-api';

export const V2_ACTION_VERSION = 1 as const;

/**
 * The only circuits the public relay carries. A citizen seals an answer with
 * `castVote` and counts it with `revealVote`; the count succeeds only for the
 * device that holds the answer's opening (ADR-009). Organizer and issuer
 * circuits never cross this boundary.
 */
export const V2_CITIZEN_CIRCUITS = ['castVote', 'revealVote'] as const;

export function isCitizenCircuit(circuit: unknown): boolean {
  return (V2_CITIZEN_CIRCUITS as readonly unknown[]).includes(circuit);
}

/** Only the already-proven, unbound transaction crosses this HTTP boundary. */
export interface V2ActionRequest {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestHash?: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  readonly tx: string;
}

export interface V2CapabilityReservation {
  readonly digest: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  readonly expiresAt: number;
}

export type V2ActionJobStatus =
  | 'authorized'
  | 'validated'
  | 'dust_reserved'
  | 'finalized'
  | 'submitted'
  | 'indexer_pending'
  | 'confirmed'
  | 'failed'
  | 'recovery_required';

/**
 * Durable record. Raw proven/finalized transaction bytes are intentionally
 * absent: only hashes, status, and the eventual public receipt survive a
 * restart. This keeps the idempotency journal privacy-minimised.
 */
export interface V2ActionJob {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly capabilityDigest: string;
  readonly requestHash: string;
  readonly txDigest: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  readonly status: V2ActionJobStatus;
  /** Append-only, digest-free lifecycle evidence persisted with the job. */
  readonly transitions: readonly V2ActionJobStatus[];
  readonly dustReservationId?: string;
  readonly transactionId?: string;
  readonly receipt?: CanonicalReceipt;
  readonly errorCode?: V2ActionErrorCode;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type V2ActionErrorCode =
  | 'idempotency_conflict'
  | 'capability_invalid'
  | 'capability_replayed'
  | 'invalid_request'
  | 'not_allowlisted'
  | 'transaction_rejected'
  | 'submission_unknown'
  | 'submission_id_mismatch'
  | 'indexer_contract_mismatch'
  | 'indexer_rejected'
  | 'recovery_required'
  | 'internal_error';

export interface NewV2ActionJob {
  readonly id: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly capabilityDigest: string;
  readonly requestHash: string;
  readonly txDigest: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  readonly now: string;
}

export interface V2ActionStore {
  /** Must be a single transaction with a unique idempotency-key constraint. */
  createOrGet(input: NewV2ActionJob): Promise<{ job: V2ActionJob; created: boolean }>;
  get(id: string): Promise<V2ActionJob | null>;
  getByIdempotencyKey(key: string): Promise<V2ActionJob | null>;
  /** Digest-only, atomically consumed capability; raw tokens never persist. */
  consumeCapability(reservation: V2CapabilityReservation): Promise<boolean>;
  /** Atomic compare-and-set transition; null means the expected state lost a race. */
  transition(
    id: string,
    expected: V2ActionJobStatus | readonly V2ActionJobStatus[],
    patch: Partial<
      Pick<V2ActionJob, 'status' | 'dustReservationId' | 'transactionId' | 'receipt' | 'errorCode'>
    >,
  ): Promise<V2ActionJob | null>;
  /** Atomically reserves the single relayer DUST lease for this job. */
  reserveDust(id: string, reservationId: string): Promise<V2ActionJob | null>;
  /** Records that can be reconciled or safely surfaced as recovery-required. */
  listRecoverable(): Promise<readonly V2ActionJob[]>;
}

export interface V2RelayerExecutor {
  balanceAndFinalize(unboundTransaction: string): Promise<string>;
  submit(finalizedTransaction: string): Promise<string>;
  /** Derive the deterministic transaction identifier before submit, when possible. */
  transactionId?(finalizedTransaction: string): string | undefined;
}

export interface V2IndexerReceiptResolver {
  resolve(input: {
    readonly transactionId: string;
    readonly network: string;
    readonly contractAddress: string;
    readonly circuit: string;
    readonly action: CivicActionKind;
  }): Promise<CanonicalReceipt | null>;
}

export interface PublicV2ActionJob {
  readonly actionId: string;
  readonly status: 'pending' | 'confirmed' | 'failed' | 'recovery_required';
  readonly requestHash: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly transitions: readonly V2ActionJobStatus[];
  readonly transactionId?: string;
  readonly receipt?: CanonicalReceipt;
  readonly errorCode?: V2ActionErrorCode;
}

export class V2ActionError extends Error {
  constructor(
    readonly code: V2ActionErrorCode,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'V2ActionError';
  }
}

export function publicJob(job: V2ActionJob): PublicV2ActionJob {
  const status =
    job.status === 'confirmed'
      ? 'confirmed'
      : job.status === 'failed'
        ? 'failed'
        : job.status === 'recovery_required'
          ? 'recovery_required'
          : 'pending';
  return {
    actionId: job.id,
    status,
    requestHash: job.requestHash,
    network: job.network,
    contractAddress: job.contractAddress,
    circuit: job.circuit,
    transitions: [...job.transitions],
    ...(job.transactionId ? { transactionId: job.transactionId } : {}),
    ...(job.receipt ? { receipt: job.receipt } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
  };
}
