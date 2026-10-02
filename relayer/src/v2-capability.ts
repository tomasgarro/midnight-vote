import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CivicActionKind } from 'midnight-referendum-api';
import { digestCapability } from './v2-hash.js';

export interface V2CapabilityClaims {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly network: string;
  readonly contractAddress: string;
  readonly circuit: string;
  readonly action: CivicActionKind;
  readonly requestHash: string;
  /** Unix seconds, not milliseconds. */
  readonly expiresAt: number;
}

/**
 * A short public fingerprint of the capability secret.
 *
 * The relay and the credential service are given the same secret by hand, in
 * two places. If the two differ, a person learns it only after their device
 * has built a proof: the relay refuses the capability. Each service publishes
 * this fingerprint, so an operator can compare them from outside beforehand.
 *
 * It is a keyed hash of a constant, cut to 64 bits. It signs nothing, and it
 * tells no more about the secret than any capability the service hands out.
 * The credential service computes the same value in its own package; the two
 * are held together by a shared test vector.
 */
export function capabilityKeyId(secret: string): string {
  return createHmac('sha256', secret)
    .update('midnight-referendum:v2-capability:key-id:1')
    .digest('hex')
    .slice(0, 16);
}

/** Test/operator helper; production issuance belongs to the trusted API. */
export function signV2Capability(claims: V2CapabilityClaims, secret: string): string {
  const payload = base64Url(JSON.stringify({ v: 1, ...claims }));
  return `${payload}.${base64Url(signature(payload, secret))}`;
}

export function verifyV2Capability(
  token: string,
  secret: string,
  expected: Omit<V2CapabilityClaims, 'expiresAt'>,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { readonly digest: string; readonly expiresAt: number } {
  if (!secret || typeof token !== 'string' || token.length > 4096) {
    throw new Error('invalid capability');
  }
  const [encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra !== undefined)
    throw new Error('invalid capability');
  const supplied = fromBase64Url(encodedSignature);
  const actual = signature(encodedPayload, secret);
  if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) {
    throw new Error('invalid capability');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid capability');
  }
  if (!isRecord(payload) || payload.v !== 1 || !Number.isSafeInteger(payload.expiresAt)) {
    throw new Error('invalid capability');
  }
  const expiresAt = payload.expiresAt as number;
  if (expiresAt <= nowSeconds) throw new Error('expired capability');
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) throw new Error('capability binding mismatch');
  }
  return { digest: digestCapability(token), expiresAt };
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(`midnight-referendum:v2-capability:1:${payload}`)
    .digest();
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string): Buffer {
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return Buffer.alloc(0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
