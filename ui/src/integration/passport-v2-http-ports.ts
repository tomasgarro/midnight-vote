import {
  type CanonicalReceipt,
  CivicCredentialError,
  type CivicCredentialIssuanceRequest,
  type CivicCredentialIssuanceResult,
  type CivicCredentialIssuerPort,
  type RarimoVerificationGateway,
  type RarimoVerificationLink,
  type RarimoVerificationRequest,
  type RarimoVerificationStatus,
  type RarimoVerifiedEvidence,
} from 'midnight-referendum-api';

type Fetcher = typeof fetch;

export interface PassportV2HttpPortOptions {
  readonly baseUrl: string;
  readonly fetcher?: Fetcher;
}

abstract class PassportV2HttpBase {
  protected readonly baseUrl: string;
  protected readonly fetcher: Fetcher;

  constructor(options: PassportV2HttpPortOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
  }

  protected async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      const message =
        isRecord(problem) && typeof problem.message === 'string'
          ? problem.message
          : `Passport v2 backend returned HTTP ${response.status}`;
      // The one refusal a person can act on: the document belongs to another
      // device. Asking again would not change it.
      if (
        response.status === 409 &&
        isRecord(problem) &&
        problem.code === 'DOCUMENT_ALREADY_ENROLLED'
      ) {
        throw new CivicCredentialError('DOCUMENT_ALREADY_ENROLLED', message);
      }
      throw new CivicCredentialError(
        response.status >= 500 ? 'ADAPTER_UNAVAILABLE' : 'INVALID_CREDENTIAL_CLAIMS',
        message,
        response.status >= 500,
      );
    }
    if (response.status === 204) return null;
    const body = await response.json();
    assertNoRawEvidence(body);
    return body;
  }
}

/** Browser client for the trusted Rarimo gateway's proof-free boundary. */
export class HttpRarimoVerificationGateway
  extends PassportV2HttpBase
  implements RarimoVerificationGateway
{
  async createVerificationRequest(
    request: RarimoVerificationRequest,
  ): Promise<RarimoVerificationLink> {
    return parseVerificationLink(
      await this.request('/v1/rarimo/verification-requests', {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
  }

  async getVerificationStatus(requestId: string): Promise<RarimoVerificationStatus> {
    const body = await this.request(
      `/v1/rarimo/verification-requests/${encodeURIComponent(requestId)}/status`,
    );
    if (
      !isRecord(body) ||
      (body.status !== 'not_verified' &&
        body.status !== 'verified' &&
        body.status !== 'failed_verification' &&
        body.status !== 'uniqueness_check_failed')
    ) {
      throw invalidResponse('Invalid Rarimo verification status');
    }
    return body.status;
  }

  async getVerifiedEvidence(requestId: string): Promise<RarimoVerifiedEvidence | null> {
    const body = await this.request(
      `/v1/rarimo/verification-requests/${encodeURIComponent(requestId)}/evidence`,
    );
    return body === null ? null : parseVerifiedEvidence(body);
  }

  async deleteVerification(requestId: string): Promise<void> {
    await this.request(`/v1/rarimo/verification-requests/${encodeURIComponent(requestId)}`, {
      method: 'DELETE',
    });
  }
}

/**
 * Browser-to-issuer client. It sends the public holder binding, minimal claims,
 * and a single-use evidence authorization; never a holder opening or raw proof.
 */
export class HttpCivicCredentialIssuerPort
  extends PassportV2HttpBase
  implements CivicCredentialIssuerPort
{
  readonly adapterName = 'cico-passport-v2-http-issuer';

  async issueCredential(
    request: CivicCredentialIssuanceRequest,
  ): Promise<CivicCredentialIssuanceResult> {
    return parseIssuanceResult(
      await this.request('/v1/credentials/issuances', {
        method: 'POST',
        body: JSON.stringify({
          enrollmentId: request.enrollmentId,
          provider: request.provider,
          evidenceAuthorization: request.evidenceAuthorization,
          holderBindingHex: bytesToHex(request.holderBinding),
          claims: request.claims,
        }),
      }),
    );
  }
}

/**
 * What the service can honestly say about the batch a new enrolment is waiting
 * in. Mirrors GET /v1/enrollment/status.
 *
 * `pendingCount` is null when the service has not observed a batch yet. That is
 * deliberately not zero: the UI renders a dash for it, because an empty
 * progress bar would claim we saw no enrolments when in fact we saw nothing.
 */
export interface EnrollmentStatus {
  readonly pendingCount: number | null;
  readonly minBatchSize: number;
  readonly maxWaitMs: number;
  readonly pendingSinceUnixMs: number | null;
  readonly publishesNoLaterThanUnixMs: number | null;
  readonly lastPublishedAtUnixMs: number | null;
  readonly observedAtUnixMs: number;
}

/** Browser client for the enrollment wait. */
export class HttpEnrollmentStatusPort extends PassportV2HttpBase {
  async getStatus(): Promise<EnrollmentStatus> {
    return parseEnrollmentStatus(await this.request('/v1/enrollment/status'));
  }
}

function parseEnrollmentStatus(value: unknown): EnrollmentStatus {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.minBatchSize) ||
    !Number.isSafeInteger(value.maxWaitMs) ||
    !Number.isSafeInteger(value.observedAtUnixMs)
  ) {
    throw invalidResponse('Invalid enrollment status');
  }
  return {
    pendingCount: optionalInteger(value.pendingCount, 'pendingCount'),
    minBatchSize: value.minBatchSize as number,
    maxWaitMs: value.maxWaitMs as number,
    pendingSinceUnixMs: optionalInteger(value.pendingSinceUnixMs, 'pendingSinceUnixMs'),
    publishesNoLaterThanUnixMs: optionalInteger(
      value.publishesNoLaterThanUnixMs,
      'publishesNoLaterThanUnixMs',
    ),
    lastPublishedAtUnixMs: optionalInteger(value.lastPublishedAtUnixMs, 'lastPublishedAtUnixMs'),
    observedAtUnixMs: value.observedAtUnixMs as number,
  };
}

/** null passes through; anything that is neither null nor an integer is a fault. */
function optionalInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) throw invalidResponse(`Invalid ${label}`);
  return value as number;
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('VITE_PASSPORT_V2_API_URL must be an absolute URL');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new TypeError('Passport v2 backend requires HTTPS or localhost');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('Passport v2 backend URL must not contain credentials, query, or fragment');
  }
  return url.toString().replace(/\/+$/u, '');
}

function parseVerificationLink(value: unknown): RarimoVerificationLink {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    typeof value.userIdHash !== 'string' ||
    typeof value.proofParamsUrl !== 'string' ||
    typeof value.proofRequestUrl !== 'string'
  ) {
    throw invalidResponse('Invalid Rarimo verification link');
  }
  return {
    requestId: value.requestId,
    userIdHash: value.userIdHash,
    proofParamsUrl: requireHttpsUrl(value.proofParamsUrl, 'proof parameters'),
    proofRequestUrl: requireHttpsUrl(value.proofRequestUrl, 'proof request'),
  };
}

function parseVerifiedEvidence(value: unknown): RarimoVerifiedEvidence {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    typeof value.userIdHash !== 'string' ||
    typeof value.evidenceAuthorization !== 'string' ||
    typeof value.evidenceFingerprint !== 'string' ||
    typeof value.eventId !== 'string' ||
    typeof value.eventDataDecimal !== 'string' ||
    typeof value.selector !== 'string' ||
    typeof value.timestampUpperBound !== 'string' ||
    typeof value.identityCounterUpperBound !== 'string' ||
    typeof value.birthDateUpperBound !== 'string' ||
    typeof value.expirationDateLowerBound !== 'string' ||
    typeof value.citizenshipAlpha3 !== 'string' ||
    typeof value.adultPredicateSatisfied !== 'boolean'
  ) {
    throw invalidResponse('Invalid verified Rarimo evidence');
  }
  return value as unknown as RarimoVerifiedEvidence;
}

function parseIssuanceResult(value: unknown): CivicCredentialIssuanceResult {
  if (!isRecord(value) || typeof value.issuanceId !== 'string' || !value.issuanceId) {
    throw invalidResponse('Invalid credential issuance result');
  }
  return {
    issuanceId: value.issuanceId,
    credentialBlind: parseBytes32(value.credentialBlindHex, 'credentialBlindHex'),
    credentialLeaf: parseBytes32(value.credentialLeafHex, 'credentialLeafHex'),
    receipt: parseCanonicalReceipt(value.receipt),
  };
}

function parseCanonicalReceipt(value: unknown): CanonicalReceipt {
  if (
    !isRecord(value) ||
    value.status !== 'confirmed' ||
    value.action !== 'credential' ||
    (value.network !== 'preview' && value.network !== 'devnet') ||
    typeof value.transactionId !== 'string' ||
    typeof value.transactionHash !== 'string' ||
    typeof value.contractAddress !== 'string' ||
    value.circuit !== 'addCredential' ||
    !Number.isSafeInteger(value.blockHeight) ||
    typeof value.blockHash !== 'string' ||
    typeof value.blockTimestamp !== 'string' ||
    (value.explorerUrl !== undefined && typeof value.explorerUrl !== 'string')
  ) {
    throw invalidResponse('Invalid canonical issuance receipt');
  }
  return value as unknown as CanonicalReceipt;
}

function parseBytes32(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/iu.test(value)) {
    throw invalidResponse(`${label} must be 32-byte hexadecimal data`);
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytesToHex(value: Uint8Array): string {
  if (value.length !== 32) throw new TypeError('holderBinding must be exactly 32 bytes');
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireHttpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidResponse(`Invalid ${label} URL`);
  }
  if (url.protocol !== 'https:') throw invalidResponse(`${label} URL must use HTTPS`);
  return url.toString();
}

const forbiddenEvidenceKeys = new Set([
  'proof',
  'proofdata',
  'proofenvelope',
  'pubsignals',
  'mrz',
  'birthdate',
  'passportnumber',
  'nfc',
  'dg1',
  'dg2',
]);

function assertNoRawEvidence(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoRawEvidence(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenEvidenceKeys.has(key.toLowerCase().replace(/[^a-z0-9]/gu, ''))) {
      throw invalidResponse('Backend response crossed the raw passport evidence boundary');
    }
    assertNoRawEvidence(item);
  }
}

function invalidResponse(message: string): CivicCredentialError {
  return new CivicCredentialError('ADAPTER_UNAVAILABLE', message, true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
