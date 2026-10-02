import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCapabilityError,
  type ActionCapabilityIssuanceRequest,
  capabilityKeyId,
  HmacActionCapabilityIssuer,
} from './action-capability-issuer.js';

const secret = 'relay-capability-secret-that-is-long-enough';
const request: ActionCapabilityIssuanceRequest = {
  actionId: 'action-1',
  idempotencyKey: 'idem-1',
  requestHash: 'ab'.repeat(32),
  network: 'undeployed',
  contractAddress: 'contract-1',
  circuit: 'castVote',
  action: 'vote',
  credentialAuthorization: 'credential:issued-1',
};

function issuer(exists = true) {
  return new HmacActionCapabilityIssuer({
    secret,
    credentialAuthorizationExists: vi.fn(async () => exists),
    allowedNetworks: ['undeployed'],
    allowedContracts: ['contract-1'],
    allowedCircuits: ['castVote'],
    ttlSeconds: 60,
    nowSeconds: () => 1_000,
  });
}

describe('HmacActionCapabilityIssuer', () => {
  it('binds every relay field without disclosing the credential authorization', async () => {
    const token = await issuer().issue(request);
    const [encoded, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString('utf8'));

    expect(payload).toEqual({
      v: 1,
      actionId: 'action-1',
      idempotencyKey: 'idem-1',
      network: 'undeployed',
      contractAddress: 'contract-1',
      circuit: 'castVote',
      action: 'vote',
      requestHash: 'ab'.repeat(32),
      expiresAt: 1_060,
    });
    expect(JSON.stringify(payload)).not.toContain(request.credentialAuthorization);
    expect(signature).toBe(
      createHmac('sha256', secret)
        .update(`midnight-referendum:v2-capability:1:${encoded}`)
        .digest('base64url'),
    );
  });

  it('fails closed for an unknown credential, policy mismatch, or malformed request', async () => {
    await expect(issuer(false).issue(request)).rejects.toBeInstanceOf(ActionCapabilityError);
    await expect(issuer().issue({ ...request, contractAddress: 'other' })).rejects.toBeInstanceOf(
      ActionCapabilityError,
    );
    await expect(
      issuer().issue({ ...request, requestHash: 'not-a-digest' }),
    ).rejects.toBeInstanceOf(ActionCapabilityError);
  });

  it('lets a citizen credential count its own answer when the circuit is allowlisted', async () => {
    const counting = new HmacActionCapabilityIssuer({
      secret,
      credentialAuthorizationExists: vi.fn(async () => true),
      allowedNetworks: ['undeployed'],
      allowedContracts: ['contract-1'],
      allowedCircuits: ['castVote', 'revealVote'],
      ttlSeconds: 60,
      nowSeconds: () => 1_000,
    });
    const token = await counting.issue({ ...request, circuit: 'revealVote' });
    const payload = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString());
    expect(payload).toMatchObject({ circuit: 'revealVote', action: 'vote' });
    // The allowlist still decides: a cast-only deployment refuses it.
    await expect(issuer().issue({ ...request, circuit: 'revealVote' })).rejects.toBeInstanceOf(
      ActionCapabilityError,
    );
  });

  it('never grants organizer or issuer circuits from a citizen credential', async () => {
    const misconfigured = new HmacActionCapabilityIssuer({
      secret,
      credentialAuthorizationExists: vi.fn(async () => true),
      allowedNetworks: ['undeployed'],
      allowedContracts: ['contract-1'],
      allowedCircuits: ['closeVote', 'revealVote', 'finalizeVote', 'addCredential', 'freeze'],
      ttlSeconds: 60,
      nowSeconds: () => 1_000,
    });

    for (const circuit of ['closeVote', 'finalizeVote']) {
      await expect(misconfigured.issue({ ...request, circuit })).rejects.toBeInstanceOf(
        ActionCapabilityError,
      );
    }
    for (const circuit of ['addCredential', 'freeze']) {
      await expect(
        misconfigured.issue({ ...request, circuit, action: 'credential' }),
      ).rejects.toBeInstanceOf(ActionCapabilityError);
    }
  });
});

describe('the public fingerprint of the capability secret', () => {
  it('is the vector the relay pins too', () => {
    // The relay computes this in its own package. Both suites pin this value.
    expect(capabilityKeyId('a-capability-secret-shared-by-two-services')).toBe('4caad0fe941626a4');
  });

  it('differs per secret and is not a capability signature', async () => {
    const id = capabilityKeyId(secret);
    expect(id).toMatch(/^[0-9a-f]{16}$/u);
    expect(capabilityKeyId(`${secret}!`)).not.toBe(id);
    const token = await issuer().issue(request);
    expect(token).not.toContain(id);
  });
});
