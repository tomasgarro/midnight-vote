import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  type CivicCredentialClaims,
  type CivicCredentialIssuanceRequest,
  type CivicCredentialIssuerPort,
  isoNumericCountry,
  type RarimoVerificationGateway,
  type RarimoVerificationRequest,
} from 'midnight-referendum-api';
import {
  ActionCapabilityError,
  type ActionCapabilityIssuanceRequest,
  type ActionCapabilityIssuer,
} from './action-capability-issuer.js';
import type { CredentialRootPublisherStatus } from './credential-root-publisher.js';

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * The publisher, narrowed to the one read the enrollment wait needs. Taking a
 * function rather than the class keeps the HTTP layer from depending on the
 * publisher's construction, which needs contract executors and secrets.
 */
export type EnrollmentStatusReader = () => CredentialRootPublisherStatus;

/**
 * What this service is configured for, in public terms: the contracts it acts
 * on, a fingerprint of the secret it shares with the relay, and whether its
 * wallet can pay. An operator reads it from outside before a person tries.
 */
export interface CicoServiceStatus {
  readonly registryContractAddress: string;
  /** Consultations the root publisher admits new passes to. */
  readonly consultations: readonly string[];
  /** Null when this service issues no capabilities: walletless answers are off. */
  readonly actionCapabilities: {
    readonly keyId: string;
    readonly networks: readonly string[];
    readonly contracts: readonly string[];
    readonly circuits: readonly string[];
  } | null;
  /** Null fields mean the wallet could not be asked just now. */
  readonly issuerWallet: {
    readonly address: string | null;
    readonly dustAvailable: boolean | null;
  };
}

export interface CicoHttpServiceOptions {
  readonly gateway: RarimoVerificationGateway;
  readonly issuer: CivicCredentialIssuerPort;
  readonly allowedOrigins: readonly string[];
  readonly maxBodyBytes?: number;
  readonly actionCapabilityIssuer?: ActionCapabilityIssuer;
  /** Absent when no referenda are configured; the route then reports unavailable. */
  readonly enrollmentStatus?: EnrollmentStatusReader;
  readonly serviceStatus?: () => Promise<CicoServiceStatus>;
}

/** Local/hosted HTTP façade. Real Rarimo and Midnight implementations are injected. */
export function createCicoHttpService(options: CicoHttpServiceOptions): Server {
  if (options.allowedOrigins.length === 0) {
    throw new TypeError('At least one exact browser origin must be allowed');
  }
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new TypeError('maxBodyBytes must be a positive safe integer');
  }

  return createServer(async (request, response) => {
    try {
      setSecurityHeaders(response);
      const origin = request.headers.origin;
      if (!origin && requiresTrustedBrowserOrigin(request.method, request.url)) {
        sendJson(response, 403, { message: 'A trusted browser Origin is required' });
        return;
      }
      if (origin) {
        const normalizedOrigin = tryNormalizeOrigin(origin);
        if (!normalizedOrigin) {
          sendJson(response, 403, { message: 'Origin is not allowed' });
          return;
        }
        if (!allowedOrigins.has(normalizedOrigin)) {
          sendJson(response, 403, { message: 'Origin is not allowed' });
          return;
        }
        response.setHeader('access-control-allow-origin', normalizedOrigin);
        response.setHeader('vary', 'Origin');
        response.setHeader('access-control-allow-credentials', 'true');
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
        response.setHeader('access-control-allow-headers', 'content-type');
        response.writeHead(204).end();
        return;
      }
      await routeRequest(request, response, options, maxBodyBytes);
    } catch (error) {
      const status =
        error instanceof HttpProblem
          ? error.status
          : error instanceof ActionCapabilityError
            ? error.status
            : 500;
      const message =
        error instanceof HttpProblem
          ? error.message
          : 'The CICO service could not complete the request';
      sendJson(response, status, { message });
    }
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CicoHttpServiceOptions,
  maxBodyBytes: number,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://cico.local');
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', service: 'cico-passport-boundary' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/rarimo/verification-requests') {
    const body = parseVerificationRequest(await readJson(request, maxBodyBytes));
    sendSafeJson(response, 201, await options.gateway.createVerificationRequest(body));
    return;
  }

  const statusMatch = url.pathname.match(/^\/v1\/rarimo\/verification-requests\/([^/]+)\/status$/u);
  if (request.method === 'GET' && statusMatch) {
    sendSafeJson(response, 200, {
      status: await options.gateway.getVerificationStatus(decodeId(statusMatch[1])),
    });
    return;
  }
  const evidenceMatch = url.pathname.match(
    /^\/v1\/rarimo\/verification-requests\/([^/]+)\/evidence$/u,
  );
  if (request.method === 'GET' && evidenceMatch) {
    sendSafeJson(
      response,
      200,
      await options.gateway.getVerifiedEvidence(decodeId(evidenceMatch[1])),
    );
    return;
  }
  const verificationMatch = url.pathname.match(/^\/v1\/rarimo\/verification-requests\/([^/]+)$/u);
  if (request.method === 'DELETE' && verificationMatch) {
    await options.gateway.deleteVerification(decodeId(verificationMatch[1]));
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/enrollment/status') {
    if (!options.enrollmentStatus) {
      throw new HttpProblem(503, 'Enrollment status unavailable');
    }
    const status = options.enrollmentStatus();
    sendSafeJson(response, 200, {
      // Null means "not observed", never zero. The UI renders a dash for it and
      // must not imply progress the service has not actually seen.
      pendingCount: status.pendingCount,
      minBatchSize: status.minBatchSize,
      maxWaitMs: status.maxWaitMs,
      pendingSinceUnixMs: status.pendingSinceMs,
      publishesNoLaterThanUnixMs: status.publishesNoLaterThanMs,
      lastPublishedAtUnixMs: status.lastPublishedAtMs,
      observedAtUnixMs: status.observedAtMs,
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/service/status') {
    if (!options.serviceStatus) throw new HttpProblem(503, 'Service status unavailable');
    sendSafeJson(response, 200, await options.serviceStatus());
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/credentials/issuances') {
    const body = parseIssuanceRequest(await readJson(request, maxBodyBytes));
    const result = await options.issuer.issueCredential(body);
    sendSafeJson(response, 201, {
      issuanceId: result.issuanceId,
      credentialBlindHex: bytesToHex(result.credentialBlind),
      credentialLeafHex: bytesToHex(result.credentialLeaf),
      receipt: result.receipt,
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/action-capabilities') {
    if (!options.actionCapabilityIssuer)
      throw new HttpProblem(503, 'Action capability issuer unavailable');
    const body = parseActionCapabilityRequest(await readJson(request, maxBodyBytes));
    sendSafeJson(response, 201, {
      actionCapability: await options.actionCapabilityIssuer.issue(body),
    });
    return;
  }
  sendJson(response, 404, { message: 'Route not found' });
}

async function readJson(request: IncomingMessage, maximum: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximum) throw new HttpProblem(413, 'Request body is too large');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpProblem(400, 'Request body must be valid JSON');
  }
}

function parseVerificationRequest(value: unknown): RarimoVerificationRequest {
  if (!isRecord(value)) throw new HttpProblem(400, 'Invalid verification request');
  const requiredStrings = [
    'requestId',
    'eventId',
    'eventData',
    'eventDataDecimal',
    'selector',
    'birthDateLowerBound',
    'birthDateUpperBound',
    'identityCounterLowerBound',
    'identityCounterUpperBound',
    'expirationDateLowerBound',
    'expirationDateUpperBound',
    'timestampLowerBound',
    'timestampUpperBound',
  ] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || !value[key]) {
      throw new HttpProblem(400, `Invalid verification request ${key}`);
    }
  }
  if (!/^0x[0-9a-f]+$/iu.test(value.eventData as string)) {
    throw new HttpProblem(400, 'eventData must be hexadecimal');
  }
  if (value.citizenshipMask !== undefined && typeof value.citizenshipMask !== 'string') {
    throw new HttpProblem(400, 'Invalid citizenship mask');
  }
  return value as unknown as RarimoVerificationRequest;
}

function parseIssuanceRequest(value: unknown): CivicCredentialIssuanceRequest {
  if (
    !isRecord(value) ||
    typeof value.enrollmentId !== 'string' ||
    (value.provider !== 'rarimo' && value.provider !== 'passport-native') ||
    typeof value.evidenceAuthorization !== 'string' ||
    !isRecord(value.claims)
  ) {
    throw new HttpProblem(400, 'Invalid credential issuance request');
  }
  const claims = parseClaims(value.claims);
  return {
    enrollmentId: value.enrollmentId,
    provider: value.provider,
    evidenceAuthorization: value.evidenceAuthorization,
    holderBinding: parseBytes32(value.holderBindingHex, 'holderBindingHex'),
    claims,
  };
}

function parseClaims(value: Record<string, unknown>): CivicCredentialClaims {
  if (
    typeof value.issuerId !== 'string' ||
    typeof value.country !== 'string' ||
    (value.ageClass !== 'unknown' &&
      value.ageClass !== 'under-18' &&
      value.ageClass !== '18-plus') ||
    (value.assurance !== 'self-asserted' &&
      value.assurance !== 'document' &&
      value.assurance !== 'document-nfc' &&
      value.assurance !== 'passport-native') ||
    !Number.isSafeInteger(value.credentialEpoch) ||
    typeof value.validFrom !== 'string' ||
    typeof value.validUntil !== 'string'
  ) {
    throw new HttpProblem(400, 'Invalid minimal credential claims');
  }
  return {
    issuerId: value.issuerId,
    country: isoNumericCountry(value.country),
    ageClass: value.ageClass,
    assurance: value.assurance,
    credentialEpoch: value.credentialEpoch as number,
    validFrom: value.validFrom,
    validUntil: value.validUntil,
  };
}

function parseActionCapabilityRequest(value: unknown): ActionCapabilityIssuanceRequest {
  if (
    !isRecord(value) ||
    typeof value.actionId !== 'string' ||
    typeof value.idempotencyKey !== 'string' ||
    typeof value.requestHash !== 'string' ||
    typeof value.network !== 'string' ||
    typeof value.contractAddress !== 'string' ||
    typeof value.circuit !== 'string' ||
    (value.action !== 'credential' && value.action !== 'vote' && value.action !== 'cohort') ||
    typeof value.credentialAuthorization !== 'string'
  ) {
    throw new HttpProblem(400, 'Invalid action capability request');
  }
  return value as unknown as ActionCapabilityIssuanceRequest;
}

function parseBytes32(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/iu.test(value)) {
    throw new HttpProblem(400, `${label} must be 32-byte hexadecimal data`);
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytesToHex(value: Uint8Array): string {
  if (value.length !== 32) throw new HttpProblem(500, 'Issuer returned invalid private material');
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const forbiddenResponseKeys = new Set([
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
  'choice',
  'votersecret',
  'holderblind',
  // Nothing this service answers has a reason to carry one of these by name.
  'seed',
  'secret',
  'walletseed',
  'issuersecret',
  'capabilitysecret',
]);

function sendSafeJson(response: ServerResponse, status: number, value: unknown): void {
  assertSafeResponse(value);
  sendJson(response, status, value);
}

function assertSafeResponse(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSafeResponse(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
    if (forbiddenResponseKeys.has(normalized)) {
      throw new HttpProblem(500, 'Service attempted to expose forbidden passport material');
    }
    assertSafeResponse(item);
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new TypeError('Allowed origins must contain scheme and authority only');
  }
  return url.origin;
}

function tryNormalizeOrigin(value: string): string | null {
  try {
    return normalizeOrigin(value);
  } catch {
    return null;
  }
}

function requiresTrustedBrowserOrigin(
  method: string | undefined,
  requestUrl: string | undefined,
): boolean {
  const pathname = new URL(requestUrl ?? '/', 'http://cico.local').pathname;
  return pathname.startsWith('/v1/') || (method !== 'GET' && method !== 'HEAD');
}

function decodeId(value: string | undefined): string {
  if (!value) throw new HttpProblem(400, 'Request ID is required');
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpProblem(400, 'Request ID is invalid');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

class HttpProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
