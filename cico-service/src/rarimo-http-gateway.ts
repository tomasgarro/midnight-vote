import { createHash } from 'node:crypto';
import type {
  CivicCredentialIssuanceRequest,
  RarimoCountryMapper,
  RarimoVerificationGateway,
  RarimoVerificationLink,
  RarimoVerificationRequest,
  RarimoVerificationStatus,
  RarimoVerifiedEvidence,
} from 'midnight-referendum-api';
import {
  deriveRarimoIssuanceEventData,
  rarimoVerificationRequestProblem,
} from 'midnight-referendum-api';

/**
 * HTTP adapter for a self-hosted Rarimo verificator-svc.
 *
 * The default routes and JSON:API codecs are taken from the official
 * verificator-svc API:
 * https://rarimo.github.io/verificator-svc/
 * https://github.com/rarimo/verificator-svc
 *
 * This class intentionally exposes only the provider-neutral gateway. A raw
 * proof is validated and projected to request-bound evidence in memory; it is
 * never returned, logged, or retained in the adapter context.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_PROOF_REQUEST_BASE_URL = 'https://app.rarime.com/external';
const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';
const RARIMO_GLOBAL_PUBLIC_SIGNAL_COUNT = 23;

const SIGNAL_INDEX = {
  /** The document's nullifier for this event: stable for one document and one event. */
  nullifier: 0,
  citizenship: 6,
  eventId: 9,
  eventData: 10,
  selector: 12,
  timestampUpperBound: 15,
  identityCounterUpperBound: 17,
  birthDateUpperBound: 19,
  expirationDateLowerBound: 20,
} as const;

export interface RarimoHttpGatewayEndpoints {
  readonly verificationLink?: string;
  readonly verificationStatus?: (requestId: string) => string;
  readonly proof?: (requestId: string) => string;
  readonly deleteUser?: (requestId: string) => string;
}

export interface RarimoProofProjection {
  readonly userIdHash: string;
  readonly publicSignals: readonly string[];
}

/**
 * Override only when a pinned self-hosted deployment intentionally differs
 * from the documented JSON:API response. Custom codecs must not return raw
 * proof material.
 */
export interface RarimoHttpGatewayCodec {
  readonly encodeVerificationRequest?: (request: RarimoVerificationRequest) => unknown;
  readonly decodeVerificationLink?: (
    value: unknown,
    request: RarimoVerificationRequest,
  ) => { readonly userIdHash: string; readonly proofParamsUrl: string };
  readonly decodeVerificationStatus?: (
    value: unknown,
    requestId: string,
  ) => RarimoVerificationStatus;
  readonly decodeProof?: (value: unknown, requestId: string) => RarimoProofProjection;
}

export interface RarimoHttpGatewayOptions {
  /** Required. No public/default URL is selected implicitly. */
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
  /** Static or lazily supplied private-service headers (for example auth). */
  readonly privateHeaders?:
    | Readonly<Record<string, string>>
    | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>);
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Defaults to the media type documented by verificator-svc. */
  readonly responseContentTypes?: readonly string[];
  readonly endpoints?: RarimoHttpGatewayEndpoints;
  readonly codec?: RarimoHttpGatewayCodec;
  /**
   * Exact HTTPS origins allowed for the public proof-params URL. When omitted,
   * only the configured verifier origin is accepted; a split private/public
   * deployment must explicitly list its public callback origin.
   */
  readonly proofParamsAllowedOrigins?: readonly string[];
  /** Rarimo App URL used to turn proof-params into a QR interaction URI. */
  readonly proofRequestBaseUrl?: string;
  /** Accept an already-deleted user as a successful idempotent cleanup. */
  readonly ignoreNotFoundOnDelete?: boolean;
  readonly now?: () => Date;
}

export interface RarimoCredentialIssuancePolicy {
  readonly issuerId: string;
  readonly credentialEpoch: number;
  readonly credentialTtlMs: number;
  readonly countryMapper: RarimoCountryMapper;
  readonly maximumIssuanceDelayMs?: number;
  readonly clockSkewMs?: number;
}

export type RarimoHttpGatewayErrorCode =
  | 'INVALID_CONFIGURATION'
  /** The browser asked for a verification this product does not make. */
  | 'REQUEST_NOT_ALLOWED'
  | 'TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_HTTP_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'NOT_FOUND';

export class RarimoHttpGatewayError extends Error {
  constructor(
    readonly code: RarimoHttpGatewayErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RarimoHttpGatewayError';
  }
}

interface VerificationContext {
  readonly request: RarimoVerificationRequest;
  readonly userIdHash: string;
}

interface IssuanceAuthorizationContext {
  readonly context: VerificationContext;
  readonly evidence: RarimoVerifiedEvidence;
  readonly verifiedAt: Date;
  /** See `documentTagFor`. Null when the proof showed no nullifier. */
  readonly documentTag: string | null;
}

interface HttpResponseBody {
  readonly status: number;
  readonly body: unknown;
}

export class RarimoHttpVerificationGateway implements RarimoVerificationGateway {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly privateHeaders?: RarimoHttpGatewayOptions['privateHeaders'];
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly responseContentTypes: ReadonlySet<string>;
  private readonly endpoints: Required<RarimoHttpGatewayEndpoints>;
  private readonly codec: Required<RarimoHttpGatewayCodec>;
  private readonly proofRequestBaseUrl: string;
  private readonly proofParamsAllowedOrigins: ReadonlySet<string>;
  private readonly ignoreNotFoundOnDelete: boolean;
  private readonly now: () => Date;
  private readonly contexts = new Map<string, VerificationContext>();
  private readonly issuanceAuthorizations = new Map<string, IssuanceAuthorizationContext>();

  constructor(options: RarimoHttpGatewayOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
    this.privateHeaders = options.privateHeaders;
    this.timeoutMs = positiveSafeInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.maxResponseBytes = positiveSafeInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    );
    const responseContentTypes = options.responseContentTypes ?? [JSON_API_MEDIA_TYPE];
    if (responseContentTypes.length === 0) {
      throw invalidConfiguration('responseContentTypes must not be empty');
    }
    this.responseContentTypes = new Set(responseContentTypes.map(normalizeMediaType));
    this.endpoints = {
      verificationLink:
        options.endpoints?.verificationLink ??
        '/integrations/verificator-svc/v2/private/verification-link',
      verificationStatus:
        options.endpoints?.verificationStatus ??
        ((requestId: string) =>
          `/integrations/verificator-svc/private/verification-status/${encodeURIComponent(requestId)}`),
      proof:
        options.endpoints?.proof ??
        ((requestId: string) =>
          `/integrations/verificator-svc/private/proof/${encodeURIComponent(requestId)}`),
      deleteUser:
        options.endpoints?.deleteUser ??
        ((requestId: string) =>
          `/integrations/verificator-svc/private/user/${encodeURIComponent(requestId)}`),
    };
    this.codec = {
      encodeVerificationRequest:
        options.codec?.encodeVerificationRequest ?? encodeVerificationRequest,
      decodeVerificationLink: options.codec?.decodeVerificationLink ?? decodeVerificationLink,
      decodeVerificationStatus: options.codec?.decodeVerificationStatus ?? decodeVerificationStatus,
      decodeProof: options.codec?.decodeProof ?? decodeProof,
    };
    this.proofRequestBaseUrl = validateProofRequestBaseUrl(
      options.proofRequestBaseUrl ?? DEFAULT_PROOF_REQUEST_BASE_URL,
    );
    const proofParamsAllowedOrigins = options.proofParamsAllowedOrigins ?? [
      new URL(this.baseUrl).origin,
    ];
    if (proofParamsAllowedOrigins.length === 0) {
      throw invalidConfiguration('proofParamsAllowedOrigins must not be empty');
    }
    this.proofParamsAllowedOrigins = new Set(
      proofParamsAllowedOrigins.map((origin) => validateHttpsOrigin(origin)),
    );
    this.ignoreNotFoundOnDelete = options.ignoreNotFoundOnDelete ?? true;
    this.now = options.now ?? (() => new Date());
  }

  async createVerificationRequest(
    request: RarimoVerificationRequest,
  ): Promise<RarimoVerificationLink> {
    validateGatewayRequest(request);
    // The browser chooses the bounds of its request. Only a request of the
    // shape the app makes may lead to a pass: every pass this gateway later
    // authorizes comes from a request that was kept here, after this check.
    const problem = rarimoVerificationRequestProblem(request, this.now());
    if (problem) throw new RarimoHttpGatewayError('REQUEST_NOT_ALLOWED', problem, 400);
    const response = await this.request('POST', this.endpoints.verificationLink, {
      expectedStatuses: [200],
      body: this.codec.encodeVerificationRequest(request),
    });
    let decoded: { readonly userIdHash: string; readonly proofParamsUrl: string };
    try {
      decoded = this.codec.decodeVerificationLink(response.body, request);
      validateUserIdHash(decoded.userIdHash);
      validateHttpsUrl(decoded.proofParamsUrl, 'proof parameters URL');
      const proofParamsOrigin = new URL(decoded.proofParamsUrl).origin;
      if (!this.proofParamsAllowedOrigins.has(proofParamsOrigin)) {
        throw new Error('Proof parameters URL origin is not explicitly allowed');
      }
    } catch (error) {
      throw malformedResponse(error);
    }
    const proofRequestUrl = buildProofRequestUrl(this.proofRequestBaseUrl, decoded.proofParamsUrl);
    const link: RarimoVerificationLink = {
      requestId: request.requestId,
      userIdHash: decoded.userIdHash,
      proofParamsUrl: decoded.proofParamsUrl,
      proofRequestUrl,
    };
    this.contexts.set(request.requestId, { request, userIdHash: decoded.userIdHash });
    return link;
  }

  async getVerificationStatus(requestId: string): Promise<RarimoVerificationStatus> {
    const context = this.contexts.get(requestId);
    const response = await this.request('GET', this.endpoints.verificationStatus(requestId), {
      expectedStatuses: [200],
    });
    try {
      return this.codec.decodeVerificationStatus(
        response.body,
        context?.request.requestId ?? requestId,
      );
    } catch (error) {
      throw malformedResponse(error);
    }
  }

  async getVerifiedEvidence(requestId: string): Promise<RarimoVerifiedEvidence | null> {
    const context = this.contexts.get(requestId);
    if (!context) {
      throw new RarimoHttpGatewayError(
        'MALFORMED_RESPONSE',
        'A verification request must be created before evidence is fetched',
      );
    }
    // The trusted verificator performs the cryptographic Groth16 verification.
    // This adapter only checks the returned proof envelope and request-bound
    // public signals. Never fetch or project evidence for a non-verified user.
    const status = await this.getVerificationStatus(requestId);
    if (status !== 'verified') return null;
    let response: HttpResponseBody;
    try {
      response = await this.request('GET', this.endpoints.proof(requestId), {
        expectedStatuses: [200],
        notFoundIsNull: true,
      });
    } catch (error) {
      if (error instanceof RarimoHttpGatewayError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
    try {
      const proof = this.codec.decodeProof(response.body, requestId);
      validateProofProjection(proof, context);
      const evidence = evidenceFromProof(proof, context, fingerprint(response.body));
      const existing = this.issuanceAuthorizations.get(evidence.evidenceAuthorization);
      if (!existing) {
        this.issuanceAuthorizations.set(evidence.evidenceAuthorization, {
          context,
          evidence,
          verifiedAt: this.now(),
          documentTag: documentTagFromProof(proof, evidence.eventId),
        });
      } else if (
        existing.context.request.requestId !== context.request.requestId ||
        existing.evidence.evidenceFingerprint !== evidence.evidenceFingerprint
      ) {
        throw new Error('Rarimo evidence authorization collision');
      }
      return evidence;
    } catch (error) {
      throw malformedResponse(error);
    }
  }

  async deleteVerification(requestId: string): Promise<void> {
    try {
      await this.request('DELETE', this.endpoints.deleteUser(requestId), {
        expectedStatuses: [204],
        allowNotFound: this.ignoreNotFoundOnDelete,
      });
    } finally {
      // Context contains only request binding metadata, never the raw proof.
      this.contexts.delete(requestId);
      for (const [authorization, record] of this.issuanceAuthorizations) {
        if (record.context.request.requestId === requestId) {
          this.issuanceAuthorizations.delete(authorization);
        }
      }
    }
  }

  /**
   * An opaque tag of the document behind a verified proof, for telling that a
   * document already has a pass. It is a hash of the proof's nullifier and its
   * event. The nullifier is what the document shows under that event and
   * nothing else, so the tag names no person and no document number; it only
   * comes out the same when the same document is verified under the same
   * event again. It stays inside this service: the evidence handed to the
   * browser does not carry it.
   *
   * Null when the proof showed no nullifier. Undefined when the authorization
   * is not one this gateway verified.
   */
  documentTagFor(evidenceAuthorization: string): string | null | undefined {
    return this.issuanceAuthorizations.get(evidenceAuthorization)?.documentTag;
  }

  /**
   * Re-derives the only credential material a verified proof may authorize.
   * This is called by the Midnight issuer before it claims the one-time token.
   */
  async validateCredentialIssuance(
    request: CivicCredentialIssuanceRequest,
    policy: RarimoCredentialIssuancePolicy,
  ): Promise<boolean> {
    const authorization = this.issuanceAuthorizations.get(request.evidenceAuthorization);
    if (!authorization || request.provider !== 'rarimo') return false;
    const { context, evidence, verifiedAt } = authorization;
    let expectedEventData: Uint8Array;
    try {
      expectedEventData = deriveRarimoIssuanceEventData(
        request.enrollmentId,
        request.holderBinding,
      );
    } catch {
      return false;
    }
    const eventDataHex = `0x${bytesToHex(expectedEventData)}`;
    if (
      context.request.eventData.toLowerCase() !== eventDataHex ||
      context.request.eventDataDecimal !== bytesToBigInt(expectedEventData).toString(10) ||
      evidence.eventDataDecimal !== context.request.eventDataDecimal
    ) {
      return false;
    }
    const country = policy.countryMapper.fromAlpha3(evidence.citizenshipAlpha3);
    if (!country || request.claims.country !== country) return false;
    if (
      context.request.citizenshipMask &&
      context.request.citizenshipMask.trim().toUpperCase() !==
        evidence.citizenshipAlpha3.trim().toUpperCase()
    ) {
      return false;
    }
    const adultRequested = context.request.birthDateUpperBound !== '0x303030303030';
    const expectedAgeClass = adultRequested ? '18-plus' : 'unknown';
    if (adultRequested && !evidence.adultPredicateSatisfied) return false;
    if (
      request.claims.issuerId !== policy.issuerId ||
      request.claims.ageClass !== expectedAgeClass ||
      request.claims.assurance !== 'document-nfc' ||
      request.claims.credentialEpoch !== policy.credentialEpoch
    ) {
      return false;
    }
    const validFrom = Date.parse(request.claims.validFrom);
    const validUntil = Date.parse(request.claims.validUntil);
    const now = this.now().getTime();
    const maximumDelay = policy.maximumIssuanceDelayMs ?? 10 * 60 * 1_000;
    const clockSkew = policy.clockSkewMs ?? 60_000;
    return (
      Number.isFinite(validFrom) &&
      Number.isFinite(validUntil) &&
      validFrom % 1_000 === 0 &&
      validUntil % 1_000 === 0 &&
      validUntil - validFrom === policy.credentialTtlMs &&
      now - verifiedAt.getTime() <= maximumDelay &&
      validFrom >= verifiedAt.getTime() - clockSkew &&
      validFrom <= now + clockSkew &&
      validUntil > now
    );
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: {
      readonly expectedStatuses: readonly number[];
      readonly body?: unknown;
      readonly notFoundIsNull?: boolean;
      readonly allowNotFound?: boolean;
    },
  ): Promise<HttpResponseBody> {
    const url = joinUrl(this.baseUrl, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method,
          signal: controller.signal,
          headers: {
            ...(await resolvePrivateHeaders(this.privateHeaders)),
            accept: JSON_API_MEDIA_TYPE,
            ...(options.body === undefined
              ? {}
              : {
                  'content-type': JSON_API_MEDIA_TYPE,
                }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
      } catch (_error) {
        if (controller.signal.aborted) {
          throw new RarimoHttpGatewayError('TIMEOUT', 'The Rarimo verificator request timed out');
        }
        throw new RarimoHttpGatewayError(
          'UPSTREAM_UNAVAILABLE',
          'The Rarimo verificator could not be reached',
        );
      }
      if (response.status === 404 && options.notFoundIsNull) {
        throw new RarimoHttpGatewayError(
          'NOT_FOUND',
          'The Rarimo verification proof was not found',
          404,
        );
      }
      if (response.status === 404 && options.allowNotFound) {
        return { status: 404, body: null };
      }
      if (!options.expectedStatuses.includes(response.status)) {
        throw new RarimoHttpGatewayError(
          'UPSTREAM_HTTP_ERROR',
          `The Rarimo verificator returned HTTP ${response.status}`,
          response.status,
        );
      }
      if (response.status === 204) return { status: response.status, body: null };
      validateContentType(response.headers.get('content-type'), this.responseContentTypes);
      let bodyText: string;
      try {
        bodyText = await readBoundedText(response, this.maxResponseBytes);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new RarimoHttpGatewayError('TIMEOUT', 'The Rarimo verificator request timed out');
        }
        throw error;
      }
      try {
        return { status: response.status, body: JSON.parse(bodyText) as unknown };
      } catch {
        throw new RarimoHttpGatewayError(
          'MALFORMED_RESPONSE',
          'The Rarimo verificator returned invalid JSON',
          response.status,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createRarimoHttpVerificationGateway(
  options: RarimoHttpGatewayOptions,
): RarimoVerificationGateway {
  return new RarimoHttpVerificationGateway(options);
}

function encodeVerificationRequest(request: RarimoVerificationRequest): unknown {
  return {
    data: {
      id: request.requestId,
      type: 'advanced_verification',
      attributes: {
        event_id: request.eventId,
        selector: request.selector,
        ...(request.citizenshipMask === undefined
          ? {}
          : { citizenship_mask: request.citizenshipMask }),
        identity_counter_lower_bound: decimalInteger(request.identityCounterLowerBound),
        identity_counter_upper_bound: decimalInteger(request.identityCounterUpperBound),
        birth_date_lower_bound: request.birthDateLowerBound,
        birth_date_upper_bound: request.birthDateUpperBound,
        event_data: request.eventData,
        expiration_date_lower_bound: request.expirationDateLowerBound,
        expiration_date_upper_bound: request.expirationDateUpperBound,
        timestamp_lower_bound: decimalInteger(request.timestampLowerBound),
        timestamp_upper_bound: decimalInteger(request.timestampUpperBound),
      },
    },
  };
}

async function resolvePrivateHeaders(
  provider: RarimoHttpGatewayOptions['privateHeaders'],
): Promise<Readonly<Record<string, string>>> {
  if (!provider) return {};
  const headers = typeof provider === 'function' ? await provider() : provider;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key || !value || hasControlCharacter(key) || hasControlCharacter(value)) {
      throw invalidConfiguration('privateHeaders contains invalid data');
    }
    result[key] = value;
  }
  return result;
}

function decodeVerificationLink(
  value: unknown,
  request: RarimoVerificationRequest,
): { readonly userIdHash: string; readonly proofParamsUrl: string } {
  const data = readData(value, ['id', 'type', 'attributes']);
  if (data.id !== request.requestId || data.type !== 'verification_link') {
    throw new Error('Verification link identity is not bound to the request');
  }
  const attributes = readRecord(data.attributes, ['get_proof_params']);
  const proofParamsUrl = readString(attributes.get_proof_params, 'get_proof_params');
  const userIdHash = deriveUserIdHash(proofParamsUrl);
  return { userIdHash, proofParamsUrl };
}

function decodeVerificationStatus(value: unknown, requestId: string): RarimoVerificationStatus {
  const data = readData(value, ['id', 'type', 'attributes']);
  if (data.id !== requestId || data.type !== 'user_status') {
    throw new Error('Verification status identity is not bound to the request');
  }
  const attributes = readRecord(data.attributes, ['status']);
  const status = attributes.status;
  if (
    status !== 'not_verified' &&
    status !== 'verified' &&
    status !== 'failed_verification' &&
    status !== 'uniqueness_check_failed'
  ) {
    throw new Error('Unknown Rarimo verification status');
  }
  return status;
}

function decodeProof(value: unknown, requestId: string): RarimoProofProjection {
  const data = readData(value, ['id', 'type', 'attributes']);
  if (data.type !== 'get_proof' || typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid Rarimo proof identity');
  }
  const attributes = readRecord(data.attributes, ['proof']);
  const proofEnvelope = readRecord(attributes.proof, ['proof', 'pub_signals']);
  const proof = readRecord(proofEnvelope.proof, ['pi_a', 'pi_b', 'pi_c', 'protocol']);
  if (proof.protocol !== 'groth16') throw new Error('Unexpected Rarimo proof protocol');
  const publicSignals = readStringArray(proofEnvelope.pub_signals, 'pub_signals');
  if (publicSignals.length !== RARIMO_GLOBAL_PUBLIC_SIGNAL_COUNT) {
    throw new Error('Unexpected Rarimo public signal count');
  }
  const piA = readStringArray(proof.pi_a, 'pi_a');
  const piB = readStringMatrix(proof.pi_b, 'pi_b');
  const piC = readStringArray(proof.pi_c, 'pi_c');
  if (
    piA.length !== 3 ||
    piB.length !== 3 ||
    piB.some((row) => row.length !== 2) ||
    piC.length !== 3
  ) {
    throw new Error('Unexpected Rarimo Groth16 proof shape');
  }
  // Validate field encodings while the proof is still transient, then drop it.
  for (const signal of publicSignals) decimalField(signal, 'public signal');
  for (const element of [...piA, ...piC, ...piB.flat()]) decimalField(element, 'proof element');
  void requestId;
  return { userIdHash: data.id, publicSignals };
}

function evidenceFromProof(
  proof: RarimoProofProjection,
  context: VerificationContext,
  evidenceFingerprint: string,
): RarimoVerifiedEvidence {
  const signals = proof.publicSignals;
  const request = context.request;
  const expected = [
    [SIGNAL_INDEX.eventId, request.eventId],
    [SIGNAL_INDEX.eventData, request.eventDataDecimal],
    [SIGNAL_INDEX.selector, request.selector],
    [SIGNAL_INDEX.timestampUpperBound, request.timestampUpperBound],
    [SIGNAL_INDEX.identityCounterUpperBound, request.identityCounterUpperBound],
    [SIGNAL_INDEX.birthDateUpperBound, hexToDecimal(request.birthDateUpperBound)],
    [SIGNAL_INDEX.expirationDateLowerBound, hexToDecimal(request.expirationDateLowerBound)],
  ] as const;
  for (const [index, expectedValue] of expected) {
    if (signalAt(signals, index) !== expectedValue) {
      throw new Error('Rarimo proof public signal is not bound to the request');
    }
  }
  const citizenshipAlpha3 = decodeCitizenship(signalAt(signals, SIGNAL_INDEX.citizenship));
  return {
    requestId: request.requestId,
    userIdHash: proof.userIdHash,
    evidenceAuthorization: `rarimo-evidence-v1:${evidenceFingerprint}`,
    evidenceFingerprint,
    eventId: signalAt(signals, SIGNAL_INDEX.eventId),
    eventDataDecimal: signalAt(signals, SIGNAL_INDEX.eventData),
    selector: signalAt(signals, SIGNAL_INDEX.selector),
    timestampUpperBound: signalAt(signals, SIGNAL_INDEX.timestampUpperBound),
    identityCounterUpperBound: signalAt(signals, SIGNAL_INDEX.identityCounterUpperBound),
    birthDateUpperBound: signalAt(signals, SIGNAL_INDEX.birthDateUpperBound),
    expirationDateLowerBound: signalAt(signals, SIGNAL_INDEX.expirationDateLowerBound),
    citizenshipAlpha3,
    // The upstream verificator accepted the request-bound birth-date range;
    // no birth date itself is exposed here.
    adultPredicateSatisfied: true,
  };
}

function signalAt(signals: readonly string[], index: number): string {
  const signal = signals[index];
  if (signal === undefined) throw new Error('Missing Rarimo public signal');
  return signal;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBigInt(value: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(value)}`);
}

function validateProofProjection(proof: RarimoProofProjection, context: VerificationContext): void {
  if (proof.userIdHash !== context.userIdHash) {
    throw new Error('Rarimo proof identity is not bound to the verification link');
  }
  if (proof.publicSignals.length !== RARIMO_GLOBAL_PUBLIC_SIGNAL_COUNT) {
    throw new Error('Unexpected Rarimo public signal count');
  }
}

function validateGatewayRequest(request: RarimoVerificationRequest): void {
  const strings: readonly [string, string][] = [
    ['requestId', request.requestId],
    ['eventId', request.eventId],
    ['eventDataDecimal', request.eventDataDecimal],
    ['selector', request.selector],
    ['birthDateLowerBound', request.birthDateLowerBound],
    ['birthDateUpperBound', request.birthDateUpperBound],
    ['identityCounterLowerBound', request.identityCounterLowerBound],
    ['identityCounterUpperBound', request.identityCounterUpperBound],
    ['expirationDateLowerBound', request.expirationDateLowerBound],
    ['expirationDateUpperBound', request.expirationDateUpperBound],
    ['timestampLowerBound', request.timestampLowerBound],
    ['timestampUpperBound', request.timestampUpperBound],
  ];
  for (const [label, value] of strings) {
    if (typeof value !== 'string' || value.length === 0 || hasControlCharacter(value)) {
      throw invalidConfiguration(`Invalid Rarimo request ${label}`);
    }
  }
  if (!/^0x[0-9a-f]+$/iu.test(request.eventData)) {
    throw invalidConfiguration('eventData must be hexadecimal');
  }
  decimalInteger(request.eventDataDecimal);
  decimalInteger(request.selector);
  decimalInteger(request.eventId);
  decimalInteger(request.identityCounterLowerBound);
  decimalInteger(request.identityCounterUpperBound);
  decimalInteger(request.timestampLowerBound);
  decimalInteger(request.timestampUpperBound);
}

function readData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected a JSON:API envelope');
  for (const key of Object.keys(value)) {
    if (key !== 'data' && key !== 'included') throw new Error(`Unexpected response field ${key}`);
  }
  if (!('data' in value)) throw new Error('Missing response field data');
  const root = value;
  if (root.included !== undefined && root.included !== null) {
    if (!Array.isArray(root.included) || root.included.length !== 0) {
      throw new Error('Unexpected JSON:API included data');
    }
  }
  return readRecord(root.data, keys);
}

function readRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected a JSON object');
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unexpected response field ${key}`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`Missing response field ${key}`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || hasControlCharacter(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value.map((item) => readString(item, label));
}

function readStringMatrix(value: unknown, label: string): string[][] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value.map((row) => readStringArray(row, label));
}

function decimalInteger(value: string): number | string {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value))
    throw new Error('Expected a non-negative decimal integer');
  const parsed = BigInt(value);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : value;
}

function decimalField(value: string, label: string): void {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error(`Invalid ${label}`);
  if (BigInt(value) >= 1n << 254n) throw new Error(`Out-of-range ${label}`);
}

function hexToDecimal(value: string): string {
  if (!/^0x[0-9a-f]+$/iu.test(value)) throw new Error('Invalid hexadecimal bound');
  return BigInt(value).toString(10);
}

function decodeCitizenship(value: string): string {
  const hex = BigInt(value).toString(16).padStart(6, '0');
  if (hex.length !== 6) throw new Error('Invalid citizenship signal');
  let decoded = '';
  for (let index = 0; index < 6; index += 2) {
    decoded += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  if (!/^[A-Z<]{3}$/u.test(decoded)) throw new Error('Invalid citizenship code');
  return decoded === 'D<<' ? 'DEU' : decoded;
}

function deriveUserIdHash(proofParamsUrl: string): string {
  const url = new URL(proofParamsUrl);
  const segment = url.pathname.split('/').filter(Boolean).pop();
  if (!segment) throw new Error('Proof parameters URL has no user hash');
  return decodeURIComponent(segment);
}

function buildProofRequestUrl(baseUrl: string, proofParamsUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('type', 'proof-request');
  url.searchParams.set('proof_params_url', proofParamsUrl);
  return url.href;
}

function documentTagFromProof(proof: RarimoProofProjection, eventId: string): string | null {
  const nullifier = proof.publicSignals[SIGNAL_INDEX.nullifier];
  // A proof that does not disclose its nullifier carries zero there.
  if (typeof nullifier !== 'string' || !/^[1-9][0-9]*$/u.test(nullifier)) return null;
  return createHash('sha256')
    .update('cico:document:v1:', 'utf8')
    .update(`${eventId}:${nullifier}`, 'utf8')
    .digest('hex');
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) {
    const body = await response.text();
    if (byteLength(body) > maximumBytes) {
      throw new RarimoHttpGatewayError('MALFORMED_RESPONSE', 'Rarimo response is too large');
    }
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new RarimoHttpGatewayError('MALFORMED_RESPONSE', 'Rarimo response is too large');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validateContentType(value: string | null, allowed: ReadonlySet<string>): void {
  if (!value || !allowed.has(normalizeMediaType(value))) {
    throw new RarimoHttpGatewayError(
      'MALFORMED_RESPONSE',
      'The Rarimo verificator returned an unsupported content type',
    );
  }
}

function validateBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
      throw new Error('baseUrl must use HTTPS (or HTTP loopback for local development)');
    }
    if (url.username || url.password || url.search || url.hash)
      throw new Error('baseUrl must not contain credentials or query data');
    return url.href.replace(/\/$/u, '');
  } catch (error) {
    throw invalidConfiguration(error instanceof Error ? error.message : 'Invalid baseUrl');
  }
}

function validateProofRequestBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('proofRequestBaseUrl must use HTTPS');
    return url.href;
  } catch (error) {
    throw invalidConfiguration(
      error instanceof Error ? error.message : 'Invalid proofRequestBaseUrl',
    );
  }
}

function validateHttpsOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('proofParamsAllowedOrigins must contain HTTPS origins only');
    }
    return url.origin;
  } catch (error) {
    throw invalidConfiguration(
      error instanceof Error ? error.message : 'Invalid proofParamsAllowedOrigins entry',
    );
  }
}

function validateHttpsUrl(value: string, label: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function validateUserIdHash(value: string): void {
  if (!value || hasControlCharacter(value) || value.includes('/') || value.includes('\\')) {
    throw new Error('Invalid Rarimo user hash');
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw invalidConfiguration(`${label} must be a positive safe integer`);
  return value;
}

function normalizeMediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function joinUrl(baseUrl: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw invalidConfiguration('Rarimo endpoint paths must be absolute paths');
  return `${baseUrl}${path}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function malformedResponse(error: unknown): RarimoHttpGatewayError {
  if (error instanceof RarimoHttpGatewayError && error.code === 'MALFORMED_RESPONSE') return error;
  return new RarimoHttpGatewayError(
    'MALFORMED_RESPONSE',
    error instanceof Error ? error.message : 'The Rarimo verificator response was malformed',
  );
}

function invalidConfiguration(message: string): RarimoHttpGatewayError {
  return new RarimoHttpGatewayError('INVALID_CONFIGURATION', message);
}
