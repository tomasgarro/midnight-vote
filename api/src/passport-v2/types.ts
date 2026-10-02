/**
 * Provider-neutral domain types for the Passport-first CICO flow.
 *
 * These types deliberately do not expose Rarimo payloads, Compact witnesses,
 * private state, ballot openings, or proof-server types.
 */

export type PassportCapability =
  | 'session'
  | 'profile'
  | 'scoped-grant'
  | 'credential-enrollment'
  | 'private-witness'
  | 'transaction-authorization';

export type PassportSessionStatus = 'connected' | 'expired' | 'disconnected';
/** Passport account environments. Stagenet is the public Passport test surface. */
export type PassportNetwork = 'preview' | 'devnet' | 'stagenet' | 'mainnet';
/**
 * Contract runtimes remain separate from the Passport account environment.
 * This codebase does not yet execute ledger-9 Stagenet contracts.
 */
export type MidnightRuntimeNetwork = 'preview' | 'devnet' | 'mainnet' | 'undeployed';

/** Display/session data only; never a credential or nullifier input. */
export interface PassportProfile {
  readonly displayName?: string;
  readonly alias?: string;
  readonly avatarUrl?: string;
}

/** A Passport connection is authorization/session data, not a civic credential. */
export interface PassportSession {
  readonly sessionId: string;
  readonly origin: string;
  readonly network: PassportNetwork;
  readonly status: PassportSessionStatus;
  readonly profile?: PassportProfile;
  readonly accountAddress?: string;
  readonly capabilities: readonly PassportCapability[];
}

export interface PassportSessionRequest {
  readonly origin: string;
  readonly network: PassportNetwork;
  readonly requestedCapabilities: readonly PassportCapability[];
}

export interface PassportCapabilityGrant {
  readonly capability: PassportCapability;
  readonly scope: string;
  readonly grantedAt: string;
  readonly expiresAt?: string;
}

declare const isoNumericCountryBrand: unique symbol;

/**
 * ISO 3166-1 numeric country code as a three-digit string, preserving leading
 * zeroes (for example 032). The authoritative provider owns the full country
 * catalogue; this validator checks the safe wire shape and excludes 000.
 */
export type IsoNumericCountry = string & {
  readonly [isoNumericCountryBrand]: 'IsoNumericCountry';
};

export function isoNumericCountry(value: string | number): IsoNumericCountry {
  const normalized =
    typeof value === 'number'
      ? Number.isInteger(value) && value >= 1 && value <= 999
        ? String(value).padStart(3, '0')
        : ''
      : value;
  if (!/^[0-9]{3}$/.test(normalized) || normalized === '000') {
    throw new TypeError('ISO numeric country must be a non-zero three-digit code');
  }
  return normalized as IsoNumericCountry;
}

export function isIsoNumericCountry(value: unknown): value is IsoNumericCountry {
  return typeof value === 'string' && /^[0-9]{3}$/.test(value) && value !== '000';
}

export type CredentialProvider = 'fixture' | 'rarimo' | 'passport-native';

/** Assurance is attestation strength, not a user profile property. */
export type CredentialAssurance = 'self-asserted' | 'document' | 'document-nfc' | 'passport-native';

const assuranceRank: Readonly<Record<CredentialAssurance, number>> = {
  'self-asserted': 0,
  document: 1,
  'document-nfc': 2,
  'passport-native': 3,
};

export function isCredentialAssurance(value: unknown): value is CredentialAssurance {
  return (
    value === 'self-asserted' ||
    value === 'document' ||
    value === 'document-nfc' ||
    value === 'passport-native'
  );
}

export function compareCredentialAssurance(
  left: CredentialAssurance,
  right: CredentialAssurance,
): number {
  return assuranceRank[left] - assuranceRank[right];
}

export type CredentialAgeClass = 'unknown' | 'under-18' | '18-plus';
export type EnrollmentStatus = 'pending' | 'issued' | 'failed' | 'expired' | 'revoked';

export interface CredentialPolicy {
  readonly allowedCountries?: readonly IsoNumericCountry[];
  readonly minimumAssurance?: CredentialAssurance;
  readonly requireAdult?: boolean;
}

/**
 * Authoritative claims supplied by a verified credential adapter. No birth
 * date, MRZ, NFC payload, biometric material, or raw passport value crosses
 * this boundary.
 */
export interface CivicCredentialClaims {
  readonly issuerId: string;
  readonly country: IsoNumericCountry;
  readonly ageClass: CredentialAgeClass;
  readonly assurance: CredentialAssurance;
  readonly credentialEpoch: number;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface CredentialEnrollmentRequest {
  readonly session: PassportSession;
  readonly policy?: CredentialPolicy;
}

export interface CredentialEnrollmentInteraction {
  readonly kind: 'cross-device-qr';
  readonly uri: string;
  readonly expiresAt: string;
}

/** Only the holder binding may leave the local holder boundary. */
export interface CredentialEnrollment {
  readonly enrollmentId: string;
  readonly status: EnrollmentStatus;
  readonly holderBinding: Uint8Array;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly interaction?: CredentialEnrollmentInteraction;
}

/** Safe display summary; no stable holder ID or private cryptographic material. */
export interface CredentialSummary {
  readonly provider: CredentialProvider;
  readonly status: Extract<EnrollmentStatus, 'issued' | 'expired' | 'revoked'>;
  readonly issuerId: string;
  readonly country: IsoNumericCountry;
  readonly ageClass: CredentialAgeClass;
  readonly assurance: CredentialAssurance;
  readonly credentialEpoch: number;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface EnrollmentStatusSnapshot {
  readonly enrollmentId: string;
  readonly status: EnrollmentStatus;
  readonly updatedAt: string;
  readonly errorCode?: CivicCredentialErrorCode;
}

export type CivicCredentialErrorCode =
  | 'PASSPORT_SESSION_REQUIRED'
  | 'PASSPORT_SESSION_EXPIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'ENROLLMENT_NOT_FOUND'
  | 'ENROLLMENT_EXPIRED'
  | 'CREDENTIAL_NOT_FOUND'
  | 'POLICY_NOT_SATISFIED'
  /**
   * The pass is in the registry, and the consultation has not admitted a root
   * that holds it yet. It passes by itself; retry shortly.
   */
  | 'CREDENTIAL_NOT_ADMITTED'
  /**
   * The pass was added after the consultation stopped admitting passes. No
   * later root will be admitted, so waiting does not help.
   */
  | 'CREDENTIAL_ADMISSION_CLOSED'
  | 'INVALID_CREDENTIAL_CLAIMS'
  | 'ISSUANCE_FAILED'
  | 'ADAPTER_UNAVAILABLE'
  | 'CONFLICT'
  /**
   * This device already sealed an answer for this referendum. A consultation
   * takes one answer per pass, so there is nothing to seal again.
   */
  | 'ANSWER_ALREADY_SEALED'
  /** This device holds no opening for a sealed answer on this referendum. */
  | 'BALLOT_OPENING_NOT_FOUND'
  /** The referendum is not in its counting phase, or the count has closed. */
  | 'REVEAL_NOT_OPEN';

export class CivicCredentialError extends Error {
  readonly code: CivicCredentialErrorCode;
  readonly retryable: boolean;

  constructor(code: CivicCredentialErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'CivicCredentialError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function isCivicCredentialError(value: unknown): value is CivicCredentialError {
  return value instanceof CivicCredentialError;
}

export type VoteChoice = 'YES' | 'NO' | 'ABSTAIN';
export type CivicActionKind = 'credential' | 'vote' | 'cohort';

/** Opaque action handle; never a Compact witness. */
export interface CivicActionAuthorization {
  readonly kind: 'civic-credential';
  readonly handle: string;
}

export interface CastVoteRequest {
  readonly referendumId: string;
  readonly choice: VoteChoice;
  readonly authorization: CivicActionAuthorization;
}

/**
 * Asks this device to have its own sealed answer counted. The request carries
 * no choice and no salt: the opening never leaves the device's vault.
 */
export interface RevealVoteRequest {
  readonly referendumId: string;
  /**
   * The current pass authorization. Omitted when the pass has expired; the
   * count is then sponsored with the handle kept beside the sealed answer.
   */
  readonly authorization?: CivicActionAuthorization;
}

/**
 * Cohort reporting is separate from voting and explicitly public/opt-in in
 * development mode. UI thresholding is not cryptographic privacy.
 */
export interface PublicCohortRequest {
  readonly referendumId: string;
  readonly country: IsoNumericCountry;
  readonly authorization: CivicActionAuthorization;
  readonly explicitPublicOptIn: true;
}

export type CanonicalReceiptStatus = 'confirmed';

/** Created only after canonical indexer confirmation. */
export interface CanonicalReceipt {
  readonly status: CanonicalReceiptStatus;
  readonly action: CivicActionKind;
  readonly network: MidnightRuntimeNetwork;
  readonly transactionId: string;
  readonly transactionHash: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly explorerUrl?: string;
}
