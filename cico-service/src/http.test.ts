import type { AddressInfo } from 'node:net';
import {
  deriveCredentialLeaf,
  type RarimoVerificationGateway,
  type RarimoVerificationRequest,
} from 'midnight-referendum-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCicoHttpService } from './http.js';

const servers: ReturnType<typeof createCicoHttpService>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

const verificationRequest: RarimoVerificationRequest = {
  requestId: 'request-id',
  eventId: 'event-id',
  eventData: `0x${'01'.repeat(31)}`,
  eventDataDecimal: '1',
  selector: '35361',
  birthDateLowerBound: '0x303030303030',
  birthDateUpperBound: '0x3230303830383234',
  identityCounterLowerBound: '0',
  identityCounterUpperBound: '0',
  expirationDateLowerBound: '0x3230323630383234',
  expirationDateUpperBound: '0x393939393939',
  timestampLowerBound: '0',
  timestampUpperBound: '1787594400',
};

function gateway(): RarimoVerificationGateway {
  return {
    createVerificationRequest: vi.fn().mockResolvedValue({
      requestId: 'request-id',
      userIdHash: 'user-hash',
      proofParamsUrl: 'https://rarimo.example/proof-params/request-id',
      proofRequestUrl: 'https://app.rarime.com/external?id=request-id',
    }),
    getVerificationStatus: vi.fn().mockResolvedValue('verified'),
    getVerifiedEvidence: vi.fn().mockResolvedValue({
      requestId: 'request-id',
      userIdHash: 'user-hash',
      evidenceAuthorization: 'single-use-authorization',
      evidenceFingerprint: 'ab'.repeat(32),
      eventId: 'event-id',
      eventDataDecimal: '1',
      selector: '35361',
      timestampUpperBound: '1787594400',
      identityCounterUpperBound: '0',
      birthDateUpperBound: '562958543026260',
      expirationDateLowerBound: '562958626027572',
      citizenshipAlpha3: 'ARG',
      adultPredicateSatisfied: true,
    }),
    deleteVerification: vi.fn(),
  };
}

function issuer() {
  return {
    adapterName: 'test-midnight-issuer',
    async issueCredential(
      request: Parameters<
        import('midnight-referendum-api').CivicCredentialIssuerPort['issueCredential']
      >[0],
    ) {
      const credentialBlind = new Uint8Array(32).fill(2);
      return {
        issuanceId: 'issuance-id',
        credentialBlind,
        credentialLeaf: deriveCredentialLeaf({
          holderBinding: request.holderBinding,
          credentialBlind,
          claims: request.claims,
        }),
        receipt: {
          status: 'confirmed' as const,
          action: 'credential' as const,
          network: 'preview' as const,
          transactionId: 'credential-transaction-id',
          transactionHash: 'credential-transaction-hash',
          contractAddress: 'credential-registry-address',
          circuit: 'addCredential',
          blockHeight: 42,
          blockHash: 'credential-block-hash',
          blockTimestamp: '2026-08-24T12:00:00.000Z',
        },
      };
    },
  };
}

async function start(options?: {
  gateway?: RarimoVerificationGateway;
  actionCapabilityIssuer?: import('./action-capability-issuer.js').ActionCapabilityIssuer;
  enrollmentStatus?: import('./http.js').EnrollmentStatusReader;
  serviceStatus?: () => Promise<import('./http.js').CicoServiceStatus>;
}) {
  const service = createCicoHttpService({
    gateway: options?.gateway ?? gateway(),
    issuer: issuer(),
    allowedOrigins: ['http://localhost:4173'],
    ...(options?.actionCapabilityIssuer
      ? { actionCapabilityIssuer: options.actionCapabilityIssuer }
      : {}),
    ...(options?.enrollmentStatus ? { enrollmentStatus: options.enrollmentStatus } : {}),
    ...(options?.serviceStatus ? { serviceStatus: options.serviceStatus } : {}),
  });
  servers.push(service);
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  const address = service.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

const browserHeaders = {
  origin: 'http://localhost:4173',
  'content-type': 'application/json',
};

describe('CICO HTTP boundary service', () => {
  it('runs the proof-free Rarimo and canonical issuer route transcript', async () => {
    const base = await start();
    const created = await fetch(`${base}/v1/rarimo/verification-requests`, {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify(verificationRequest),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ requestId: 'request-id' });

    const status = await fetch(`${base}/v1/rarimo/verification-requests/request-id/status`, {
      headers: { origin: browserHeaders.origin },
    });
    expect(await status.json()).toEqual({ status: 'verified' });
    const evidence = await fetch(`${base}/v1/rarimo/verification-requests/request-id/evidence`, {
      headers: { origin: browserHeaders.origin },
    });
    expect(await evidence.json()).toMatchObject({ citizenshipAlpha3: 'ARG' });

    const issued = await fetch(`${base}/v1/credentials/issuances`, {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify({
        enrollmentId: 'enrollment-id',
        provider: 'rarimo',
        evidenceAuthorization: 'single-use-authorization',
        holderBindingHex: '01'.repeat(32),
        claims: {
          issuerId: 'cico-rarimo-preview',
          country: '032',
          ageClass: '18-plus',
          assurance: 'document-nfc',
          credentialEpoch: 7,
          validFrom: '2026-08-24T12:00:00.000Z',
          validUntil: '2026-08-25T12:00:00.000Z',
        },
      }),
    });
    expect(issued.status).toBe(201);
    const issuedBody = await issued.json();
    expect(issuedBody).toMatchObject({
      issuanceId: 'issuance-id',
      credentialBlindHex: '02'.repeat(32),
      receipt: { action: 'credential', circuit: 'addCredential' },
    });
    expect(JSON.stringify(issuedBody)).not.toMatch(
      /proof|mrz|birthDate|passportNumber|nfc|choice|voterSecret|holderBlind/i,
    );

    const deleted = await fetch(`${base}/v1/rarimo/verification-requests/request-id`, {
      method: 'DELETE',
      headers: { origin: browserHeaders.origin },
    });
    expect(deleted.status).toBe(204);
  });

  it('rejects missing, malformed, or foreign mutation origins and any raw proof response', async () => {
    const base = await start();
    const missingOrigin = await fetch(`${base}/v1/rarimo/verification-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(verificationRequest),
    });
    expect(missingOrigin.status).toBe(403);
    expect(await missingOrigin.json()).toEqual({
      message: 'A trusted browser Origin is required',
    });

    const missingEvidenceOrigin = await fetch(
      `${base}/v1/rarimo/verification-requests/request-id/evidence`,
    );
    expect(missingEvidenceOrigin.status).toBe(403);

    const malformedOrigin = await fetch(`${base}/v1/rarimo/verification-requests`, {
      method: 'POST',
      headers: { ...browserHeaders, origin: 'not a valid origin' },
      body: JSON.stringify(verificationRequest),
    });
    expect(malformedOrigin.status).toBe(403);

    const foreign = await fetch(`${base}/health`, {
      headers: { origin: 'https://attacker.example' },
    });
    expect(foreign.status).toBe(403);

    const unsafe = gateway();
    unsafe.getVerifiedEvidence = vi.fn().mockResolvedValue({ proof: { pi_a: ['secret'] } });
    const unsafeBase = await start({ gateway: unsafe });
    const response = await fetch(
      `${unsafeBase}/v1/rarimo/verification-requests/request-id/evidence`,
      { headers: { origin: browserHeaders.origin } },
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });

  it('limits request bodies and exposes no civic vote endpoint', async () => {
    const service = createCicoHttpService({
      gateway: gateway(),
      issuer: issuer(),
      allowedOrigins: ['http://localhost:4173'],
      maxBodyBytes: 8,
    });
    servers.push(service);
    await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
    const address = service.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const oversized = await fetch(`${base}/v1/rarimo/verification-requests`, {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify(verificationRequest),
    });
    expect(oversized.status).toBe(413);
    const vote = await fetch(`${base}/v1/civic/votes`, {
      method: 'POST',
      headers: browserHeaders,
      body: '{}',
    });
    expect(vote.status).toBe(404);
  });

  it('issues a capability through CICO without returning the credential handle', async () => {
    const issue = vi.fn().mockResolvedValue('signed-capability');
    const base = await start({
      actionCapabilityIssuer: { issue },
    });
    const body = {
      actionId: 'action-1',
      idempotencyKey: 'idem-1',
      requestHash: 'ab'.repeat(32),
      network: 'preview',
      contractAddress: 'contract-1',
      circuit: 'castVote',
      action: 'vote',
      credentialAuthorization: 'credential:issued-1',
    };
    const response = await fetch(`${base}/v1/action-capabilities`, {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(201);
    expect(issue).toHaveBeenCalledWith(body);
    const payload = await response.json();
    expect(payload).toEqual({ actionCapability: 'signed-capability' });
    expect(JSON.stringify(payload)).not.toContain(body.credentialAuthorization);
  });
  describe('GET /v1/enrollment/status', () => {
    it('reports the pending batch and the deadline the wait is bounded by', async () => {
      const base = await start({
        enrollmentStatus: () => ({
          pendingCount: 12,
          minBatchSize: 16,
          maxWaitMs: 900_000,
          pendingSinceMs: 1_000,
          publishesNoLaterThanMs: 901_000,
          lastPublishedAtMs: 500,
          observedAtMs: 2_000,
        }),
      });

      const response = await fetch(`${base}/v1/enrollment/status`, {
        headers: { origin: browserHeaders.origin },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        pendingCount: 12,
        minBatchSize: 16,
        maxWaitMs: 900_000,
        pendingSinceUnixMs: 1_000,
        publishesNoLaterThanUnixMs: 901_000,
        lastPublishedAtUnixMs: 500,
        observedAtUnixMs: 2_000,
      });
    });

    it('passes an unobserved count through as null rather than coercing it to zero', async () => {
      const base = await start({
        enrollmentStatus: () => ({
          pendingCount: null,
          minBatchSize: 16,
          maxWaitMs: 900_000,
          pendingSinceMs: null,
          publishesNoLaterThanMs: null,
          lastPublishedAtMs: null,
          observedAtMs: 2_000,
        }),
      });

      const response = await fetch(`${base}/v1/enrollment/status`, {
        headers: { origin: browserHeaders.origin },
      });
      const body = (await response.json()) as Record<string, unknown>;
      // The UI distinguishes these: null renders a dash, 0 would render an
      // empty progress bar and claim we observed no enrolments.
      expect(body.pendingCount).toBeNull();
      expect(body.publishesNoLaterThanUnixMs).toBeNull();
    });

    it('reports unavailable when no referenda are configured', async () => {
      const base = await start();
      const response = await fetch(`${base}/v1/enrollment/status`, {
        headers: { origin: browserHeaders.origin },
      });
      expect(response.status).toBe(503);
    });

    it('still requires a trusted browser origin', async () => {
      const base = await start({
        enrollmentStatus: () => ({
          pendingCount: 1,
          minBatchSize: 16,
          maxWaitMs: 900_000,
          pendingSinceMs: 1,
          publishesNoLaterThanMs: 2,
          lastPublishedAtMs: null,
          observedAtMs: 3,
        }),
      });
      expect((await fetch(`${base}/v1/enrollment/status`)).status).toBe(403);
      expect(
        (
          await fetch(`${base}/v1/enrollment/status`, {
            headers: { origin: 'https://attacker.example' },
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('GET /v1/service/status', () => {
    const status = {
      registryContractAddress: 'ab'.repeat(32),
      consultations: ['cd'.repeat(32)],
      actionCapabilities: {
        keyId: '4caad0fe941626a4',
        networks: ['preview'],
        contracts: ['cd'.repeat(32)],
        circuits: ['castVote', 'revealVote'],
      },
      issuerWallet: { address: 'mn_addr_preview1example', dustAvailable: true },
    };

    it('says what the service is configured for, in public terms', async () => {
      const base = await start({ serviceStatus: async () => status });
      const response = await fetch(`${base}/v1/service/status`, {
        headers: { origin: browserHeaders.origin },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(status);
    });

    it('passes what it does not know through as null', async () => {
      const base = await start({
        serviceStatus: async () => ({
          ...status,
          actionCapabilities: null,
          issuerWallet: { address: null, dustAvailable: null },
        }),
      });
      const body = (await (
        await fetch(`${base}/v1/service/status`, { headers: { origin: browserHeaders.origin } })
      ).json()) as typeof status;
      expect(body.actionCapabilities).toBeNull();
      expect(body.issuerWallet).toEqual({ address: null, dustAvailable: null });
    });

    it('refuses to send a status that carries a secret by name', async () => {
      const base = await start({
        serviceStatus: async () =>
          ({ ...status, issuerWallet: { ...status.issuerWallet, seed: 'never' } }) as typeof status,
      });
      const response = await fetch(`${base}/v1/service/status`, {
        headers: { origin: browserHeaders.origin },
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('never');
    });

    it('reports unavailable when the service offers none, and requires a trusted origin', async () => {
      const without = await start();
      expect(
        (
          await fetch(`${without}/v1/service/status`, {
            headers: { origin: browserHeaders.origin },
          })
        ).status,
      ).toBe(503);
      const base = await start({ serviceStatus: async () => status });
      expect((await fetch(`${base}/v1/service/status`)).status).toBe(403);
    });
  });
});
