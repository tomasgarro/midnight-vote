import type {
  CanonicalReceipt,
  CastVoteRequest,
  CivicActionAuthorization,
  CivicCredentialClaims,
  CredentialEnrollment,
  CredentialEnrollmentRequest,
  CredentialSummary,
  EnrollmentStatusSnapshot,
  PassportCapability,
  PassportCapabilityGrant,
  PassportNetwork,
  PassportSession,
  PassportSessionRequest,
  PublicCohortRequest,
  RevealVoteRequest,
  VoteChoice,
} from './types.js';

/**
 * Result of asking Passport for a holder binding. This is deliberately a
 * discriminated result rather than an optional byte array: the application
 * must be able to tell a verified native binding from a capability that is
 * not exposed by the current Passport build.
 */
export type PassportHolderBindingResult =
  | {
      readonly status: 'verified';
      /** Public commitment only; never a voter secret or credential opening. */
      readonly holderBinding: Uint8Array;
      readonly network: Extract<PassportNetwork, 'preview' | 'devnet' | 'stagenet'>;
      readonly sessionId: string;
    }
  | {
      readonly status: 'unsupported';
      readonly reason: string;
    };

export interface PassportHolderBindingRequest {
  readonly session: PassportSession;
  readonly network: Extract<PassportNetwork, 'preview' | 'devnet' | 'stagenet'>;
}

/**
 * Optional Passport-native holder-binding seam. Session/profile remains a
 * separate capability; unsupported is an honest first-class result while the
 * official native credential capability is still unavailable.
 */
export interface PassportHolderBindingPort {
  readonly adapterName: string;
  getHolderBinding(request: PassportHolderBindingRequest): Promise<PassportHolderBindingResult>;
}

export interface CivicCredentialIssuanceRequest {
  readonly enrollmentId: string;
  readonly provider: 'rarimo' | 'passport-native';
  /** Opaque, single-use backend authorization; never a raw proof or passport value. */
  readonly evidenceAuthorization: string;
  readonly holderBinding: Uint8Array;
  readonly claims: CivicCredentialClaims;
}

export interface CivicCredentialIssuanceResult {
  readonly issuanceId: string;
  readonly credentialBlind: Uint8Array;
  readonly credentialLeaf: Uint8Array;
  readonly receipt: CanonicalReceipt;
}

/** Restricted CICO issuer boundary; implementations submit CredentialRegistryV1.addCredential. */
export interface CivicCredentialIssuerPort {
  readonly adapterName: string;
  issueCredential(request: CivicCredentialIssuanceRequest): Promise<CivicCredentialIssuanceResult>;
}

/**
 * Browser-owned opening of an issued civic credential. Implementations must
 * return defensive copies and must never serialize this material to an HTTP
 * action service, telemetry, logs, or a public receipt.
 */
export interface CivicCredentialPrivateMaterial {
  readonly voterSecret: Uint8Array;
  readonly holderBlind: Uint8Array;
  readonly holderBinding: Uint8Array;
  readonly credentialBlind: Uint8Array;
  readonly credentialLeaf: Uint8Array;
  readonly claims: CivicCredentialClaims;
}

/** Private browser bridge between credential enrollment and Compact witnesses. */
export interface CivicCredentialPrivateStatePort {
  getPrivateCredentialMaterial(): Promise<CivicCredentialPrivateMaterial | null>;
}

/**
 * Encrypted browser-vault record for one active issued credential. The vault
 * is a local persistence boundary; implementations must never send this value
 * over HTTP or include it in logs, telemetry, or receipts.
 */
export interface StoredCivicCredential {
  readonly summary: CredentialSummary;
  readonly authorization: CivicActionAuthorization;
  readonly material: CivicCredentialPrivateMaterial;
}

/** Durable, encrypted local storage used to survive refresh and browser restart. */
export interface CivicCredentialVaultPort {
  load(): Promise<StoredCivicCredential | null>;
  save(credential: StoredCivicCredential): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Durable boundary for Midnight Passport connection, consent, and scoped
 * capabilities. This port does not attest nationality, age, uniqueness, or
 * eligibility.
 */
export interface PassportSessionPort {
  readonly adapterName: string;
  readonly supportedCapabilities: readonly PassportCapability[];
  connect(request: PassportSessionRequest): Promise<PassportSession>;
  getSession(): Promise<PassportSession | null>;
  requestCapability(capability: PassportCapability): Promise<PassportCapabilityGrant>;
  disconnect(): Promise<void>;
}

/**
 * Durable boundary for credential enrollment. Implementations may be a
 * synthetic fixture, Rarimo-backed issuer bridge, or future Passport-native
 * verifier. The UI only consumes these provider-neutral values.
 */
export interface CivicCredentialPort {
  readonly adapterName: string;
  beginEnrollment(request: CredentialEnrollmentRequest): Promise<CredentialEnrollment>;
  getEnrollmentStatus(enrollmentId: string): Promise<EnrollmentStatusSnapshot>;
  getCredentialSummary(): Promise<CredentialSummary | null>;
  /** Opaque issued-credential handle; never Compact private state or provider proof data. */
  getActionAuthorization(): Promise<CivicActionAuthorization | null>;
  clearCredential(): Promise<void>;
}

/**
 * What a device must keep to have its sealed answer counted later. The
 * referendum stores only `persistentCommit(choice, salt)`, so a lost opening is
 * an answer that can never be counted. Whoever holds an opening can prove how
 * that answer was cast: it never leaves the device, and it is deleted once the
 * count is confirmed.
 */
export interface BallotOpening {
  readonly referendumId: string;
  readonly contractAddress: string;
  readonly choice: VoteChoice;
  readonly voteSalt: Uint8Array;
  /** Public value the cast inserts into the ballot tree; used to find this opening on-chain. */
  readonly ballotCommitment: Uint8Array;
  /** `sealing` from just before the cast is submitted; `sealed` once the indexer confirmed it. */
  readonly status: 'sealing' | 'sealed';
  /** Block time of the confirmed cast. */
  readonly sealedAt?: string;
}

/**
 * Encrypted, device-local storage for ballot openings. A referendum may hold
 * several: a cast whose outcome was uncertain must not be overwritten by a
 * retry, because only the chain can say which one landed. Implementations must
 * never send an opening over HTTP or write it to logs, telemetry or receipts.
 */
export interface BallotOpeningVaultPort {
  list(referendumId: string): Promise<readonly BallotOpening[]>;
  /** Adds the opening, or replaces the stored one with the same commitment. */
  save(opening: BallotOpening): Promise<void>;
  /** Removes every opening held for the referendum. */
  clear(referendumId: string): Promise<void>;
}

/**
 * Durable boundary for citizen actions. Providers return a canonical receipt
 * only after the Midnight indexer confirms the transaction.
 */
export interface CivicActionPort {
  readonly adapterName: string;
  castVote(request: CastVoteRequest): Promise<CanonicalReceipt>;
  /**
   * Counts this device's own sealed answer. The organizer holds no openings,
   * so an answer is counted only when the device that sealed it returns.
   */
  revealVote(request: RevealVoteRequest): Promise<CanonicalReceipt>;
  recordPublicCohort(request: PublicCohortRequest): Promise<CanonicalReceipt>;
  getCanonicalReceipt(transactionId: string): Promise<CanonicalReceipt | null>;
}
