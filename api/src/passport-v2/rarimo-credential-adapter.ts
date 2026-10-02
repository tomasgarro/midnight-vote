import {
  deriveCredentialLeaf,
  deriveHolderBinding,
  deriveRarimoIssuanceEventData,
  HOLDER_MATERIAL_BYTES,
} from './crypto.js';
import type {
  CivicCredentialIssuanceResult,
  CivicCredentialIssuerPort,
  CivicCredentialPort,
  CivicCredentialPrivateMaterial,
  CivicCredentialPrivateStatePort,
  CivicCredentialVaultPort,
  StoredCivicCredential,
} from './ports.js';
import {
  RARIMO_IDENTITY_COUNTER_UPPER_BOUND,
  RARIMO_UNUSED_DATE_HEX,
  rarimoAdultBirthDateBound,
  rarimoAsciiDateHex,
  rarimoQuerySelector,
} from './rarimo-query.js';
import type {
  RarimoCountryMapper,
  RarimoDerivedClaims,
  RarimoVerificationGateway,
  RarimoVerificationRequest,
  RarimoVerificationStatus,
  RarimoVerifiedEvidence,
} from './rarimo-types.js';
import type {
  CivicActionAuthorization,
  CivicCredentialClaims,
  CredentialEnrollment,
  CredentialEnrollmentRequest,
  CredentialPolicy,
  CredentialSummary,
  EnrollmentStatus,
  EnrollmentStatusSnapshot,
} from './types.js';
import { CivicCredentialError, compareCredentialAssurance } from './types.js';

const EVENT_ID_BYTES = 31;
const REQUEST_ID_BYTES = 16;
const DEFAULT_ENROLLMENT_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_DATE_HEX = RARIMO_UNUSED_DATE_HEX;

const RARIMO_ASSURANCE = 'document-nfc' as const;

export interface RarimoCivicCredentialAdapterOptions {
  /** Injected transport boundary; this adapter never performs network I/O. */
  readonly gateway: RarimoVerificationGateway;
  /** CICO/Midnight issuer; provider evidence alone never marks a credential issued. */
  readonly issuer: CivicCredentialIssuerPort;
  /** Stable issuer namespace, independent from relayer and organizer keys. */
  readonly issuerId: string;
  readonly credentialEpoch: number;
  /** Complete alpha-3/numeric catalogue supplied by the issuer deployment. */
  readonly countryMapper: RarimoCountryMapper;
  /** Required for a sound uniqueness request; never guessed by this adapter. */
  readonly uniquenessTimestampUpperBoundUnixSeconds: number;
  readonly now?: () => Date;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly enrollmentTtlMs?: number;
  readonly credentialTtlMs?: number;
  /** Encrypted browser-local persistence; omitted only for ephemeral tests/SSR. */
  readonly vault?: CivicCredentialVaultPort;
  /**
   * Encrypted persistence for a verification in progress. Without it a page
   * reload during the scan loses the secret the scan is bound to, and the
   * person has to start again.
   */
  readonly pendingVault?: RarimoEnrollmentVaultPort;
  /**
   * The Rarimo event every verification is made under, from
   * `deriveRarimoEventId`. With it, a document shows the issuer the same
   * nullifier every time, and the issuer gives it one holder. Without it each
   * attempt draws its own event, and nothing ties two passes of one document
   * together.
   */
  readonly verificationEventId?: string;
  /**
   * Encrypted persistence for this device's holder secret. With it, every
   * pass this device is issued in this scope has the same holder: the issuer
   * recognises a renewal, and the contract's nullifier lets the device answer
   * a consultation once whichever pass it proves with. Without it each
   * attempt draws a new holder.
   */
  readonly holderKeyVault?: HolderKeyVaultPort;
}

/** The secret behind a device's passes, and the blind of its public binding. */
export interface StoredHolderKey {
  readonly holderSecret: Uint8Array;
  readonly holderBlind: Uint8Array;
}

export interface HolderKeyVaultPort {
  load(): Promise<StoredHolderKey | null>;
  save(key: StoredHolderKey): Promise<void>;
}

/**
 * A verification in progress, as it is kept across a reload.
 *
 * On a phone the person leaves the browser for the scanning app, which builds
 * a heavy proof. The browser may drop the page in the meantime. The scan is
 * bound to a holder secret drawn before it started, so that secret has to
 * outlive the page. It is the same secret the issued pass will hold, and it is
 * kept the same way: in the device's encrypted vault, never sent anywhere.
 */
export interface StoredRarimoEnrollment {
  readonly enrollmentId: string;
  readonly requestId: string;
  readonly userIdHash: string;
  readonly holderSecret: Uint8Array;
  readonly holderBlind: Uint8Array;
  readonly holderBinding: Uint8Array;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly request: RarimoVerificationRequest;
  readonly policy?: CredentialPolicy;
  /** The claims the issuer was first asked for; every retry asks for the same. */
  readonly issuanceClaims?: CivicCredentialClaims;
}

export interface RarimoEnrollmentVaultPort {
  load(): Promise<StoredRarimoEnrollment | null>;
  save(enrollment: StoredRarimoEnrollment): Promise<void>;
  clear(): Promise<void>;
}

interface RarimoEnrollmentRecord {
  readonly enrollmentId: string;
  readonly requestId: string;
  readonly userIdHash: string;
  readonly holderSecret: Uint8Array;
  readonly holderBlind: Uint8Array;
  readonly holderBinding: Uint8Array;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly request: RarimoVerificationRequest;
  readonly policy?: CredentialPolicy;
  status: EnrollmentStatus;
  updatedAt: string;
  /** Why the attempt failed, when the reason is one the person can act on. */
  failureCode?: EnrollmentStatusSnapshot['errorCode'];
  summary?: CredentialSummary;
  /**
   * The claims of the pass, fixed the first time the issuer is asked. The
   * issuer recognises a retry by them: asked again with later timestamps, it
   * refuses the retry as a different pass, although the first one may already
   * be on chain.
   */
  issuanceClaims?: CivicCredentialClaims;
  credentialBlind?: Uint8Array;
  credentialLeaf?: Uint8Array;
  actionAuthorizationHandle?: string;
  /** A one-way in-memory replay marker; the raw proof is never retained. */
  proofFingerprint?: string;
  cleanupRequested: boolean;
}

/**
 * Local CICO boundary for a Rarimo-backed credential.
 *
 * The gateway is intentionally injected. An HTTP gateway belongs in a
 * backend package and must translate its response into the DTOs in
 * `rarimo-types.ts`; the browser/domain layer never receives Rarimo payloads.
 */
export class RarimoCivicCredentialAdapter
  implements CivicCredentialPort, CivicCredentialPrivateStatePort
{
  readonly adapterName = 'rarimo-civic-credential';

  private readonly gateway: RarimoVerificationGateway;
  private readonly issuer: CivicCredentialIssuerPort;
  private readonly issuerId: string;
  private readonly credentialEpoch: number;
  private readonly countryMapper: RarimoCountryMapper;
  private readonly uniquenessTimestampUpperBoundUnixSeconds: number;
  private readonly now: () => Date;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly enrollmentTtlMs: number;
  private readonly credentialTtlMs: number;
  private readonly vault?: CivicCredentialVaultPort;
  private readonly pendingVault?: RarimoEnrollmentVaultPort;
  private readonly verificationEventId?: string;
  private readonly holderKeyVault?: HolderKeyVaultPort;
  private readonly enrollments = new Map<string, RarimoEnrollmentRecord>();
  private readonly statusChecks = new Map<string, Promise<EnrollmentStatusSnapshot>>();
  private activeEnrollmentId: string | null = null;
  private restoredCredential: StoredCivicCredential | null | undefined;

  constructor(options: RarimoCivicCredentialAdapterOptions) {
    if (!options.issuerId.trim()) throw new TypeError('issuerId must not be empty');
    if (!Number.isSafeInteger(options.credentialEpoch) || options.credentialEpoch < 0) {
      throw new TypeError('credentialEpoch must be a non-negative safe integer');
    }
    if (
      !Number.isSafeInteger(options.uniquenessTimestampUpperBoundUnixSeconds) ||
      options.uniquenessTimestampUpperBoundUnixSeconds < 0
    ) {
      throw new TypeError('uniqueness timestamp upper bound must be a non-negative safe integer');
    }
    if (options.enrollmentTtlMs !== undefined && options.enrollmentTtlMs <= 0) {
      throw new TypeError('enrollmentTtlMs must be positive');
    }
    if (options.credentialTtlMs !== undefined && options.credentialTtlMs <= 0) {
      throw new TypeError('credentialTtlMs must be positive');
    }

    this.gateway = options.gateway;
    this.issuer = options.issuer;
    this.issuerId = options.issuerId;
    this.credentialEpoch = options.credentialEpoch;
    this.countryMapper = options.countryMapper;
    this.uniquenessTimestampUpperBoundUnixSeconds =
      options.uniquenessTimestampUpperBoundUnixSeconds;
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? secureRandomBytes;
    this.enrollmentTtlMs = options.enrollmentTtlMs ?? DEFAULT_ENROLLMENT_TTL_MS;
    this.credentialTtlMs = options.credentialTtlMs ?? DEFAULT_CREDENTIAL_TTL_MS;
    this.vault = options.vault;
    this.pendingVault = options.pendingVault;
    if (
      options.verificationEventId !== undefined &&
      !/^[1-9][0-9]{0,76}$/u.test(options.verificationEventId)
    ) {
      throw new TypeError('verificationEventId must be a positive decimal field element');
    }
    this.verificationEventId = options.verificationEventId;
    this.holderKeyVault = options.holderKeyVault;
  }

  async beginEnrollment(request: CredentialEnrollmentRequest): Promise<CredentialEnrollment> {
    assertConnectedPassportSession(request);
    this.assertPolicyCanBeRequested(request.policy);

    // A new attempt invalidates every old attempt, so an old QR code cannot
    // later become the active credential by racing the new one.
    if (this.enrollments.size > 0 || (await this.loadRestoredCredential())) {
      await this.clearCredential();
    }
    // An attempt left behind by a page that was dropped is replaced as well.
    await this.forgetPending();

    const created = this.now();
    const expires = new Date(created.getTime() + this.enrollmentTtlMs);
    if (expires <= created) {
      throw new CivicCredentialError(
        'ENROLLMENT_EXPIRED',
        'The Rarimo enrollment window is already expired',
      );
    }

    const enrollmentId = bytesToHex(this.randomBytes(REQUEST_ID_BYTES));
    const requestId = bytesToHex(this.randomBytes(REQUEST_ID_BYTES));
    const { holderSecret, holderBlind } = await this.holderKey();
    const holderBinding = deriveHolderBinding(holderSecret, holderBlind);
    const verificationRequest = this.buildVerificationRequest(
      requestId,
      enrollmentId,
      holderBinding,
      request.policy,
    );

    try {
      const link = await this.gateway.createVerificationRequest(verificationRequest);
      validateVerificationLink(link, requestId);

      const createdAt = created.toISOString();
      const expiresAt = expires.toISOString();
      const record: RarimoEnrollmentRecord = {
        enrollmentId,
        requestId,
        userIdHash: link.userIdHash,
        holderSecret,
        holderBlind,
        holderBinding,
        createdAt,
        expiresAt,
        request: verificationRequest,
        policy: request.policy,
        status: 'pending',
        updatedAt: createdAt,
        cleanupRequested: false,
      };

      this.enrollments.set(enrollmentId, record);
      this.activeEnrollmentId = enrollmentId;
      await this.rememberPending(record);

      return {
        enrollmentId,
        status: 'pending',
        holderBinding: new Uint8Array(holderBinding),
        createdAt,
        expiresAt,
        interaction: {
          kind: 'cross-device-qr',
          uri: link.proofRequestUrl,
          expiresAt,
        },
      };
    } catch (error) {
      zeroize(holderSecret, holderBlind, holderBinding);
      if (error instanceof CivicCredentialError) throw error;
      throw new CivicCredentialError(
        'ADAPTER_UNAVAILABLE',
        'The Rarimo verification request could not be created',
        true,
      );
    }
  }

  async getEnrollmentStatus(enrollmentId: string): Promise<EnrollmentStatusSnapshot> {
    const existing = this.statusChecks.get(enrollmentId);
    if (existing) return existing;
    const operation = this.pollEnrollmentStatus(enrollmentId);
    this.statusChecks.set(enrollmentId, operation);
    try {
      return await operation;
    } finally {
      if (this.statusChecks.get(enrollmentId) === operation) {
        this.statusChecks.delete(enrollmentId);
      }
    }
  }

  private async pollEnrollmentStatus(enrollmentId: string): Promise<EnrollmentStatusSnapshot> {
    const record = await this.resolveRecord(enrollmentId);
    if (isTerminal(record.status)) return toStatusSnapshot(record);

    if (this.now().getTime() >= Date.parse(record.expiresAt)) {
      await this.expireRecord(record);
      return toStatusSnapshot(record, 'ENROLLMENT_EXPIRED');
    }

    let providerStatus: RarimoVerificationStatus;
    try {
      providerStatus = await this.gateway.getVerificationStatus(record.requestId);
    } catch {
      throw new CivicCredentialError(
        'ADAPTER_UNAVAILABLE',
        'The Rarimo verification status could not be fetched',
        true,
      );
    }

    if (providerStatus === 'not_verified') {
      record.updatedAt = this.now().toISOString();
      return toStatusSnapshot(record);
    }

    if (providerStatus === 'failed_verification' || providerStatus === 'uniqueness_check_failed') {
      await this.failAndCleanup(record);
      return toStatusSnapshot(record, 'INVALID_CREDENTIAL_CLAIMS');
    }

    // Exact verified gate: only minimal evidence returned by CICO's trusted
    // backend may advance the browser-held credential state.
    let verifiedEvidence: RarimoVerifiedEvidence | null;
    try {
      verifiedEvidence = await this.gateway.getVerifiedEvidence(record.requestId);
    } catch {
      throw new CivicCredentialError(
        'ADAPTER_UNAVAILABLE',
        'The verified Rarimo evidence could not be fetched',
        true,
      );
    }
    if (!verifiedEvidence) {
      await this.failAndCleanup(record);
      return toStatusSnapshot(record, 'INVALID_CREDENTIAL_CLAIMS');
    }

    try {
      validateEvidenceBinding(record, verifiedEvidence);
      const derivedClaims = deriveClaims(verifiedEvidence, this.countryMapper, record);
      const now = new Date(Math.floor(this.now().getTime() / 1_000) * 1_000);
      if (!record.issuanceClaims) {
        const validUntil = new Date(now.getTime() + this.credentialTtlMs);
        record.issuanceClaims = {
          issuerId: this.issuerId,
          country: derivedClaims.country,
          ageClass: derivedClaims.ageClass,
          assurance: derivedClaims.assurance,
          credentialEpoch: this.credentialEpoch,
          validFrom: now.toISOString(),
          validUntil: validUntil.toISOString(),
        };
        // Kept before the issuer is asked, so a page that is dropped while the
        // pass is being issued asks for the same pass when it comes back.
        await this.rememberPending(record);
      }
      const claims = record.issuanceClaims;
      const proofFingerprint = verifiedEvidence.evidenceFingerprint;
      let issuance: CivicCredentialIssuanceResult;
      try {
        issuance = await this.issuer.issueCredential({
          enrollmentId: record.enrollmentId,
          provider: 'rarimo',
          evidenceAuthorization: verifiedEvidence.evidenceAuthorization,
          holderBinding: new Uint8Array(record.holderBinding),
          claims,
        });
      } catch (error) {
        // The issuer knows this document under another holder. Asking again
        // cannot change that, so the attempt ends here and says why.
        if (error instanceof CivicCredentialError && error.code === 'DOCUMENT_ALREADY_ENROLLED') {
          record.failureCode = 'DOCUMENT_ALREADY_ENROLLED';
          await this.failAndCleanup(record);
          return toStatusSnapshot(record);
        }
        throw new CivicCredentialError(
          'ISSUANCE_FAILED',
          'The verified evidence has not yet been issued on Midnight',
          true,
        );
      }
      validateIssuance(issuance, record.holderBinding, claims);
      record.credentialBlind = new Uint8Array(issuance.credentialBlind);
      record.credentialLeaf = new Uint8Array(issuance.credentialLeaf);
      record.actionAuthorizationHandle = issuance.issuanceId;
      record.summary = {
        provider: 'rarimo',
        status: 'issued',
        ...claims,
      };
      record.proofFingerprint = proofFingerprint;
      await this.persistIssuedRecord(record);
      record.status = 'issued';
      record.updatedAt = now.toISOString();
      // The pass is in its own vault now. The attempt has done its work.
      await this.forgetPending();
      await this.cleanupProviderRecord(record).catch(() => {
        // Issuance is canonical. Provider deletion is retried by backend retention work.
      });
      return toStatusSnapshot(record);
    } catch (error) {
      if (
        error instanceof CivicCredentialError &&
        (error.code === 'ADAPTER_UNAVAILABLE' || error.code === 'ISSUANCE_FAILED')
      ) {
        throw error;
      }
      await this.failAndCleanup(record);
      return toStatusSnapshot(record, 'INVALID_CREDENTIAL_CLAIMS');
    }
  }

  async getCredentialSummary(): Promise<CredentialSummary | null> {
    if (!this.activeEnrollmentId) {
      const restored = await this.loadRestoredCredential();
      if (!restored) return null;
      if (this.now().getTime() >= Date.parse(restored.summary.validUntil)) {
        await this.expireRestoredCredential();
        return { ...restored.summary, status: 'expired' };
      }
      return { ...restored.summary };
    }
    const record = this.enrollments.get(this.activeEnrollmentId);
    if (!record?.summary) return null;
    if (
      record.status === 'issued' &&
      this.now().getTime() >= Date.parse(record.summary.validUntil)
    ) {
      record.status = 'expired';
      record.summary = { ...record.summary, status: 'expired' };
      record.updatedAt = this.now().toISOString();
    }
    return { ...record.summary };
  }

  async getActionAuthorization(): Promise<CivicActionAuthorization | null> {
    if (!this.activeEnrollmentId) {
      const restored = await this.loadRestoredCredential();
      if (!restored) return null;
      if (this.now().getTime() >= Date.parse(restored.summary.validUntil)) {
        await this.expireRestoredCredential();
        return null;
      }
      return { ...restored.authorization };
    }
    const record = this.enrollments.get(this.activeEnrollmentId);
    if (record?.status !== 'issued' || !record.actionAuthorizationHandle) return null;
    if (record.summary && this.now().getTime() >= Date.parse(record.summary.validUntil)) {
      record.status = 'expired';
      record.summary = { ...record.summary, status: 'expired' };
      record.updatedAt = this.now().toISOString();
      return null;
    }
    return {
      kind: 'civic-credential',
      handle: record.actionAuthorizationHandle,
    };
  }

  async getPrivateCredentialMaterial(): Promise<CivicCredentialPrivateMaterial | null> {
    if (!this.activeEnrollmentId) {
      const restored = await this.loadRestoredCredential();
      if (!restored) return null;
      if (this.now().getTime() >= Date.parse(restored.summary.validUntil)) {
        await this.expireRestoredCredential();
        return null;
      }
      return copyPrivateMaterial(restored.material);
    }
    const record = this.enrollments.get(this.activeEnrollmentId);
    if (
      record?.status !== 'issued' ||
      !record.summary ||
      !record.credentialBlind ||
      !record.credentialLeaf
    ) {
      return null;
    }
    if (this.now().getTime() >= Date.parse(record.summary.validUntil)) {
      record.status = 'expired';
      record.summary = { ...record.summary, status: 'expired' };
      record.updatedAt = this.now().toISOString();
      return null;
    }
    const { provider: _provider, status: _status, ...claims } = record.summary;
    return {
      voterSecret: new Uint8Array(record.holderSecret),
      holderBlind: new Uint8Array(record.holderBlind),
      holderBinding: new Uint8Array(record.holderBinding),
      credentialBlind: new Uint8Array(record.credentialBlind),
      credentialLeaf: new Uint8Array(record.credentialLeaf),
      claims,
    };
  }

  async clearCredential(): Promise<void> {
    const records = [...this.enrollments.values()];
    const cleanupResults = await Promise.allSettled(
      records.map((record) => this.cleanupProviderRecord(record)),
    );

    // Always zeroize and forget local material, even if provider cleanup is
    // temporarily unavailable. The caller can retry provider cleanup through
    // its backend retention job without retaining holder secrets in this
    // process.
    for (const record of records) {
      zeroize(record.holderSecret, record.holderBlind, record.holderBinding);
      if (record.credentialBlind) record.credentialBlind.fill(0);
      if (record.credentialLeaf) record.credentialLeaf.fill(0);
    }
    this.enrollments.clear();
    this.activeEnrollmentId = null;
    if (this.restoredCredential) zeroizeStoredCredential(this.restoredCredential);
    this.restoredCredential = null;
    await this.vault?.clear();
    await this.forgetPending();

    const failedCleanup = cleanupResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedCleanup) {
      throw new CivicCredentialError(
        'ADAPTER_UNAVAILABLE',
        'The Rarimo verification record could not be cleaned up',
        true,
      );
    }
  }

  private async loadRestoredCredential(): Promise<StoredCivicCredential | null> {
    if (this.restoredCredential !== undefined) return this.restoredCredential;
    const stored = await this.vault?.load();
    this.restoredCredential = stored ? copyStoredCredential(stored) : null;
    return this.restoredCredential;
  }

  private async persistIssuedRecord(record: RarimoEnrollmentRecord): Promise<void> {
    if (
      !record.summary ||
      !record.actionAuthorizationHandle ||
      !record.credentialBlind ||
      !record.credentialLeaf
    ) {
      throw new CivicCredentialError(
        'ISSUANCE_FAILED',
        'Issued credential material is incomplete',
        true,
      );
    }
    const { provider: _provider, status: _status, ...claims } = record.summary;
    const stored: StoredCivicCredential = {
      summary: { ...record.summary },
      authorization: { kind: 'civic-credential', handle: record.actionAuthorizationHandle },
      material: {
        voterSecret: new Uint8Array(record.holderSecret),
        holderBlind: new Uint8Array(record.holderBlind),
        holderBinding: new Uint8Array(record.holderBinding),
        credentialBlind: new Uint8Array(record.credentialBlind),
        credentialLeaf: new Uint8Array(record.credentialLeaf),
        claims,
      },
    };
    try {
      await this.vault?.save(stored);
      if (this.restoredCredential) zeroizeStoredCredential(this.restoredCredential);
      this.restoredCredential = copyStoredCredential(stored);
    } finally {
      zeroizeStoredCredential(stored);
    }
  }

  private async expireRestoredCredential(): Promise<void> {
    if (this.restoredCredential) zeroizeStoredCredential(this.restoredCredential);
    this.restoredCredential = null;
    await this.vault?.clear();
  }

  private assertPolicyCanBeRequested(policy: CredentialPolicy | undefined): void {
    if (
      policy?.minimumAssurance &&
      compareCredentialAssurance(RARIMO_ASSURANCE, policy.minimumAssurance) < 0
    ) {
      throw new CivicCredentialError(
        'POLICY_NOT_SATISFIED',
        'Rarimo evidence does not satisfy the requested assurance policy',
      );
    }
    if (policy?.allowedCountries && policy.allowedCountries.length === 0) {
      throw new CivicCredentialError(
        'POLICY_NOT_SATISFIED',
        'The credential policy contains no allowed countries',
      );
    }
  }

  private buildVerificationRequest(
    requestId: string,
    enrollmentId: string,
    holderBinding: Uint8Array,
    policy: CredentialPolicy | undefined,
  ): RarimoVerificationRequest {
    const now = this.now();
    const eventDataBytes = deriveRarimoIssuanceEventData(enrollmentId, holderBinding);
    const eventData = `0x${bytesToHex(eventDataBytes)}` as `0x${string}`;
    const eventDataDecimal = bytesToBigInt(eventDataBytes).toString(10);
    const eventId =
      this.verificationEventId ?? bytesToPositiveFieldDecimal(this.randomBytes(EVENT_ID_BYTES));
    const requireAdult = policy?.requireAdult === true;
    // The shape of the query is fixed in rarimo-query.ts, where the credential
    // service reads it too: it refuses a request of any other shape.
    const selector = rarimoQuerySelector(requireAdult);

    let citizenshipMask: string | undefined;
    if (policy?.allowedCountries?.length === 1) {
      citizenshipMask = this.countryMapper.toAlpha3(policy.allowedCountries[0]);
    }

    return {
      requestId,
      eventId,
      eventData,
      eventDataDecimal,
      selector: String(selector),
      citizenshipMask,
      birthDateLowerBound: DEFAULT_DATE_HEX,
      birthDateUpperBound: requireAdult ? rarimoAdultBirthDateBound(now) : DEFAULT_DATE_HEX,
      identityCounterLowerBound: '0',
      identityCounterUpperBound: RARIMO_IDENTITY_COUNTER_UPPER_BOUND,
      expirationDateLowerBound: rarimoAsciiDateHex(now),
      expirationDateUpperBound: DEFAULT_DATE_HEX,
      timestampLowerBound: '0',
      timestampUpperBound: String(this.uniquenessTimestampUpperBoundUnixSeconds),
    };
  }

  /**
   * The attempt this page holds, or the one a dropped page left in the vault.
   * A kept attempt is taken only if it is the one asked for and its holder
   * binding still follows from its secret; anything else is forgotten.
   */
  private async resolveRecord(enrollmentId: string): Promise<RarimoEnrollmentRecord> {
    const held = this.enrollments.get(enrollmentId);
    if (held) return held;
    let kept: StoredRarimoEnrollment | null = null;
    try {
      kept = (await this.pendingVault?.load()) ?? null;
    } catch {
      kept = null;
    }
    if (kept?.enrollmentId === enrollmentId && isSoundPendingEnrollment(kept)) {
      const record: RarimoEnrollmentRecord = {
        enrollmentId: kept.enrollmentId,
        requestId: kept.requestId,
        userIdHash: kept.userIdHash,
        holderSecret: new Uint8Array(kept.holderSecret),
        holderBlind: new Uint8Array(kept.holderBlind),
        holderBinding: new Uint8Array(kept.holderBinding),
        createdAt: kept.createdAt,
        expiresAt: kept.expiresAt,
        request: { ...kept.request },
        ...(kept.policy ? { policy: kept.policy } : {}),
        ...(kept.issuanceClaims ? { issuanceClaims: { ...kept.issuanceClaims } } : {}),
        status: 'pending',
        updatedAt: this.now().toISOString(),
        cleanupRequested: false,
      };
      this.enrollments.set(enrollmentId, record);
      this.activeEnrollmentId = enrollmentId;
      return record;
    }
    if (kept) await this.forgetPending();
    throw new CivicCredentialError('ENROLLMENT_NOT_FOUND', 'The Rarimo enrollment was not found');
  }

  /**
   * This device's holder secret: the one it already has, or a new one that is
   * kept before it is used. A pass whose holder cannot be kept would leave its
   * document tied to a secret nobody holds, so a vault that refuses the new
   * key stops the attempt.
   */
  private async holderKey(): Promise<StoredHolderKey> {
    if (!this.holderKeyVault) {
      return {
        holderSecret: this.randomBytes(HOLDER_MATERIAL_BYTES),
        holderBlind: this.randomBytes(HOLDER_MATERIAL_BYTES),
      };
    }
    let kept: StoredHolderKey | null;
    try {
      kept = await this.holderKeyVault.load();
    } catch {
      throw new CivicCredentialError(
        'ADAPTER_UNAVAILABLE',
        'This browser could not read the key its pass depends on',
        true,
      );
    }
    if (
      kept &&
      kept.holderSecret instanceof Uint8Array &&
      kept.holderSecret.length === HOLDER_MATERIAL_BYTES &&
      kept.holderBlind instanceof Uint8Array &&
      kept.holderBlind.length === HOLDER_MATERIAL_BYTES
    ) {
      return {
        holderSecret: new Uint8Array(kept.holderSecret),
        holderBlind: new Uint8Array(kept.holderBlind),
      };
    }
    const created = {
      holderSecret: this.randomBytes(HOLDER_MATERIAL_BYTES),
      holderBlind: this.randomBytes(HOLDER_MATERIAL_BYTES),
    };
    try {
      await this.holderKeyVault.save({
        holderSecret: new Uint8Array(created.holderSecret),
        holderBlind: new Uint8Array(created.holderBlind),
      });
    } catch {
      zeroize(created.holderSecret, created.holderBlind);
      throw new CivicCredentialError(
        'ADAPTER_UNAVAILABLE',
        'This browser could not keep the key its pass depends on',
      );
    }
    return created;
  }

  /** Keeping the attempt is a convenience: a vault that fails must not stop the scan. */
  private async rememberPending(record: RarimoEnrollmentRecord): Promise<void> {
    if (!this.pendingVault) return;
    try {
      await this.pendingVault.save({
        enrollmentId: record.enrollmentId,
        requestId: record.requestId,
        userIdHash: record.userIdHash,
        holderSecret: new Uint8Array(record.holderSecret),
        holderBlind: new Uint8Array(record.holderBlind),
        holderBinding: new Uint8Array(record.holderBinding),
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        request: { ...record.request },
        ...(record.policy ? { policy: record.policy } : {}),
        ...(record.issuanceClaims ? { issuanceClaims: { ...record.issuanceClaims } } : {}),
      });
    } catch {
      // Without it, a reload loses the attempt, as before.
    }
  }

  private async forgetPending(): Promise<void> {
    try {
      await this.pendingVault?.clear();
    } catch {
      // A record that outlives its attempt is refused when it is next read.
    }
  }

  private async expireRecord(record: RarimoEnrollmentRecord): Promise<void> {
    record.status = 'expired';
    record.updatedAt = this.now().toISOString();
    await this.forgetPending();
    try {
      await this.cleanupProviderRecord(record);
    } finally {
      zeroize(record.holderSecret, record.holderBlind, record.holderBinding);
    }
  }

  private async failAndCleanup(record: RarimoEnrollmentRecord): Promise<void> {
    failRecord(record, this.now());
    await this.forgetPending();
    try {
      await this.cleanupProviderRecord(record);
    } catch {
      // The local record is terminal and its holder material is already
      // zeroized. Provider cleanup can be retried by a backend retention job.
    }
  }

  private async cleanupProviderRecord(record: RarimoEnrollmentRecord): Promise<void> {
    if (record.cleanupRequested) return;
    await this.gateway.deleteVerification(record.requestId);
    record.cleanupRequested = true;
  }
}

function isSoundPendingEnrollment(kept: StoredRarimoEnrollment): boolean {
  const bytes32 = (value: unknown): value is Uint8Array =>
    value instanceof Uint8Array && value.length === HOLDER_MATERIAL_BYTES;
  if (
    !bytes32(kept.holderSecret) ||
    !bytes32(kept.holderBlind) ||
    !bytes32(kept.holderBinding) ||
    typeof kept.requestId !== 'string' ||
    !kept.requestId ||
    typeof kept.userIdHash !== 'string' ||
    !Number.isFinite(Date.parse(kept.expiresAt)) ||
    typeof kept.request?.eventDataDecimal !== 'string' ||
    kept.request.requestId !== kept.requestId
  ) {
    return false;
  }
  // The scan was bound to this binding. A record whose secret does not lead
  // to it could not be issued anyway.
  return equalBytes(deriveHolderBinding(kept.holderSecret, kept.holderBlind), kept.holderBinding);
}

function validateIssuance(
  issuance: Awaited<ReturnType<CivicCredentialIssuerPort['issueCredential']>>,
  holderBinding: Uint8Array,
  claims: CivicCredentialClaims,
): void {
  if (!issuance.issuanceId.trim()) {
    throw new CivicCredentialError('ISSUANCE_FAILED', 'Issuer returned no issuance ID', true);
  }
  if (
    issuance.credentialBlind.length !== 32 ||
    issuance.credentialLeaf.length !== 32 ||
    issuance.receipt.status !== 'confirmed' ||
    issuance.receipt.action !== 'credential' ||
    issuance.receipt.circuit !== 'addCredential' ||
    issuance.receipt.network !== 'preview'
  ) {
    throw new CivicCredentialError(
      'ISSUANCE_FAILED',
      'Issuer did not return a canonical credential issuance',
      true,
    );
  }
  const expectedLeaf = deriveCredentialLeaf({
    holderBinding,
    claims,
    credentialBlind: issuance.credentialBlind,
  });
  if (!equalBytes(expectedLeaf, issuance.credentialLeaf)) {
    throw new CivicCredentialError(
      'ISSUANCE_FAILED',
      'Issuer credential leaf does not match the verified claims',
      true,
    );
  }
}

function assertConnectedPassportSession(request: CredentialEnrollmentRequest): void {
  if (!request.session) {
    throw new CivicCredentialError(
      'PASSPORT_SESSION_REQUIRED',
      'Connect Midnight Passport before enrolling a Rarimo credential',
    );
  }
  if (request.session.status === 'expired') {
    throw new CivicCredentialError(
      'PASSPORT_SESSION_EXPIRED',
      'The Midnight Passport session has expired',
      true,
    );
  }
  if (request.session.status !== 'connected') {
    throw new CivicCredentialError(
      'PASSPORT_SESSION_REQUIRED',
      'A connected Midnight Passport session is required',
    );
  }
}

function validateVerificationLink(
  link: {
    readonly requestId: string;
    readonly userIdHash: string;
    readonly proofRequestUrl: string;
  },
  expectedRequestId: string,
): void {
  let proofRequestUrl: URL;
  try {
    proofRequestUrl = new URL(link.proofRequestUrl);
  } catch {
    throw new CivicCredentialError(
      'INVALID_CREDENTIAL_CLAIMS',
      'The Rarimo verification link is invalid',
    );
  }
  if (
    link.requestId !== expectedRequestId ||
    !link.userIdHash.trim() ||
    proofRequestUrl.protocol !== 'https:'
  ) {
    throw new CivicCredentialError(
      'INVALID_CREDENTIAL_CLAIMS',
      'The Rarimo verification link was not bound to the enrollment request',
    );
  }
}

function validateEvidenceBinding(
  record: RarimoEnrollmentRecord,
  evidence: RarimoVerifiedEvidence,
): void {
  if (
    evidence.requestId !== record.requestId ||
    evidence.userIdHash !== record.userIdHash ||
    evidence.eventId !== record.request.eventId ||
    evidence.eventDataDecimal !== record.request.eventDataDecimal ||
    evidence.selector !== record.request.selector ||
    evidence.timestampUpperBound !== record.request.timestampUpperBound ||
    evidence.identityCounterUpperBound !== record.request.identityCounterUpperBound ||
    evidence.birthDateUpperBound !== hexToDecimal(record.request.birthDateUpperBound) ||
    evidence.expirationDateLowerBound !== hexToDecimal(record.request.expirationDateLowerBound) ||
    !evidence.evidenceAuthorization.trim() ||
    !/^[0-9a-f]{64}$/u.test(evidence.evidenceFingerprint)
  ) {
    throw new CivicCredentialError(
      'INVALID_CREDENTIAL_CLAIMS',
      'The verified Rarimo evidence was not bound to this enrollment request',
    );
  }
  if (
    record.request.birthDateUpperBound !== DEFAULT_DATE_HEX &&
    !evidence.adultPredicateSatisfied
  ) {
    throw new CivicCredentialError(
      'INVALID_CREDENTIAL_CLAIMS',
      'The verified evidence did not satisfy the requested adult predicate',
    );
  }
}

function deriveClaims(
  evidence: RarimoVerifiedEvidence,
  mapper: RarimoCountryMapper,
  record: RarimoEnrollmentRecord,
): RarimoDerivedClaims {
  const country = mapper.fromAlpha3(evidence.citizenshipAlpha3);
  if (!country) {
    throw new CivicCredentialError(
      'INVALID_CREDENTIAL_CLAIMS',
      'The Rarimo citizenship code is not in the configured country catalogue',
    );
  }

  // Country policy is checked against the verified proof, never against the
  // Passport profile or the requester's UI selection.
  const policyCountryCodes = record.request.citizenshipMask;
  if (policyCountryCodes) {
    const requested = mapper.fromAlpha3(policyCountryCodes);
    if (requested && requested !== country) {
      throw new CivicCredentialError(
        'INVALID_CREDENTIAL_CLAIMS',
        'The verified citizenship does not satisfy the enrollment policy',
      );
    }
  }

  const allowedCountries = record.policy?.allowedCountries;
  if (allowedCountries && !allowedCountries.includes(country)) {
    throw new CivicCredentialError(
      'INVALID_CREDENTIAL_CLAIMS',
      'The verified citizenship does not satisfy the enrollment policy',
    );
  }

  return {
    country,
    ageClass: record.request.birthDateUpperBound === DEFAULT_DATE_HEX ? 'unknown' : '18-plus',
    assurance: RARIMO_ASSURANCE,
  };
}

function failRecord(record: RarimoEnrollmentRecord, now: Date): void {
  record.status = 'failed';
  record.updatedAt = now.toISOString();
  zeroize(record.holderSecret, record.holderBlind, record.holderBinding);
}

function isTerminal(status: EnrollmentStatus): boolean {
  return status === 'issued' || status === 'failed' || status === 'expired' || status === 'revoked';
}

function toStatusSnapshot(
  record: RarimoEnrollmentRecord,
  errorCode?: EnrollmentStatusSnapshot['errorCode'],
): EnrollmentStatusSnapshot {
  const code = errorCode ?? record.failureCode;
  return {
    enrollmentId: record.enrollmentId,
    status: record.status,
    updatedAt: record.updatedAt,
    ...(code ? { errorCode: code } : {}),
  };
}

function hexToDecimal(value: string): string {
  return BigInt(value).toString(10);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return BigInt(`0x${hex}`);
}

function bytesToPositiveFieldDecimal(bytes: Uint8Array): string {
  const masked = new Uint8Array(bytes);
  masked[0] &= 0x3f;
  const value = bytesToBigInt(masked);
  return (value === 0n ? 1n : value).toString(10);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function secureRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function zeroize(...values: Uint8Array[]): void {
  for (const value of values) value.fill(0);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function copyPrivateMaterial(
  material: CivicCredentialPrivateMaterial,
): CivicCredentialPrivateMaterial {
  return {
    voterSecret: new Uint8Array(material.voterSecret),
    holderBlind: new Uint8Array(material.holderBlind),
    holderBinding: new Uint8Array(material.holderBinding),
    credentialBlind: new Uint8Array(material.credentialBlind),
    credentialLeaf: new Uint8Array(material.credentialLeaf),
    claims: { ...material.claims },
  };
}

function copyStoredCredential(credential: StoredCivicCredential): StoredCivicCredential {
  return {
    summary: { ...credential.summary },
    authorization: { ...credential.authorization },
    material: copyPrivateMaterial(credential.material),
  };
}

function zeroizeStoredCredential(credential: StoredCivicCredential): void {
  zeroize(
    credential.material.voterSecret,
    credential.material.holderBlind,
    credential.material.holderBinding,
    credential.material.credentialBlind,
    credential.material.credentialLeaf,
  );
}
