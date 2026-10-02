import { describe, expect, it } from 'vitest';
import {
  capabilityKeyId,
  signV2Capability,
  type V2CapabilityClaims,
  verifyV2Capability,
} from './v2-capability.js';

const claims: V2CapabilityClaims = {
  actionId: 'action-1',
  idempotencyKey: 'request-1',
  network: 'preview',
  contractAddress: 'contract-1',
  circuit: 'castVote',
  action: 'vote',
  requestHash: 'a'.repeat(64),
  expiresAt: 2_000,
};
const { expiresAt: _expiresAt, ...expectedClaims } = claims;

describe('v2 action capabilities', () => {
  it('verifies a signed capability and returns a token digest without exposing claims', () => {
    const token = signV2Capability(claims, 'test-secret');
    const verified = verifyV2Capability(token, 'test-secret', expectedClaims, 1_000);

    expect(verified.expiresAt).toBe(2_000);
    expect(verified.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(token).not.toContain('test-secret');
  });

  it.each([
    ['actionId', 'action-2'],
    ['idempotencyKey', 'request-2'],
    ['network', 'devnet'],
    ['contractAddress', 'contract-2'],
    ['circuit', 'closeVote'],
    ['action', 'credential'],
    ['requestHash', 'b'.repeat(64)],
  ] as const)('rejects a capability whose %s claim is rebound', (key, value) => {
    const token = signV2Capability(claims, 'test-secret');
    const expected = { ...expectedClaims, [key]: value };

    expect(() => verifyV2Capability(token, 'test-secret', expected, 1_000)).toThrow(
      'capability binding mismatch',
    );
  });

  it('rejects expired and tampered tokens', () => {
    const token = signV2Capability(claims, 'test-secret');
    expect(() => verifyV2Capability(token, 'test-secret', expectedClaims, 2_000)).toThrow(
      'expired capability',
    );
    expect(() => verifyV2Capability(`${token}x`, 'test-secret', expectedClaims, 1_000)).toThrow(
      'invalid capability',
    );
  });
});

describe('the public fingerprint of the capability secret', () => {
  // The credential service computes this in its own package. Both suites pin
  // the same vector, so the two can only drift by failing a test.
  const secret = 'a-capability-secret-shared-by-two-services';

  it('is the vector the credential service pins too', () => {
    expect(capabilityKeyId(secret)).toBe('4caad0fe941626a4');
  });

  it('is 64 bits of hexadecimal, differs per secret, and is not the secret', () => {
    const id = capabilityKeyId(secret);
    expect(id).toMatch(/^[0-9a-f]{16}$/u);
    expect(capabilityKeyId(`${secret}!`)).not.toBe(id);
    expect(secret).not.toContain(id);
  });

  it('cannot stand in for a signature', () => {
    const claims: V2CapabilityClaims = {
      actionId: 'action',
      idempotencyKey: 'key',
      network: 'preview',
      contractAddress: 'contract',
      circuit: 'castVote',
      action: 'vote',
      requestHash: 'a'.repeat(64),
      expiresAt: 2_000_000_000,
    };
    const [payload] = signV2Capability(claims, secret).split('.');
    const forged = `${payload}.${Buffer.from(capabilityKeyId(secret), 'hex').toString('base64url')}`;
    const { expiresAt: _expiresAt, ...expected } = claims;
    expect(() => verifyV2Capability(forged, secret, expected, 1_900_000_000)).toThrow(
      'invalid capability',
    );
  });
});
