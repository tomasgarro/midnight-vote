import { isoNumericCountry } from 'midnight-referendum-api';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpCivicCredentialIssuerPort,
  HttpEnrollmentStatusPort,
  HttpRarimoVerificationGateway,
} from '../integration/passport-v2-http-ports';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const verificationRequest = {
  requestId: 'request-id',
  eventId: 'event-id',
  eventData: `0x${'01'.repeat(31)}` as const,
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

const evidence = {
  requestId: 'request-id',
  userIdHash: 'user-hash',
  evidenceAuthorization: 'single-use-evidence-authorization',
  evidenceFingerprint: 'fingerprint',
  eventId: 'event-id',
  eventDataDecimal: '1',
  selector: '35361',
  timestampUpperBound: '1787594400',
  identityCounterUpperBound: '0',
  birthDateUpperBound: '0x3230303830383234',
  expirationDateLowerBound: '0x3230323630383234',
  citizenshipAlpha3: 'ARG',
  adultPredicateSatisfied: true,
};

const credentialReceipt = {
  status: 'confirmed',
  action: 'credential',
  network: 'preview',
  transactionId: 'credential-tx-id',
  transactionHash: 'credential-tx-hash',
  contractAddress: 'ab'.repeat(32),
  circuit: 'addCredential',
  blockHeight: 42,
  blockHash: 'block-hash',
  blockTimestamp: '2026-08-24T12:00:00.000Z',
};

describe('Passport v2 narrow HTTP boundaries', () => {
  it('creates, polls, reads minimal evidence, and deletes a Rarimo verification', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          requestId: 'request-id',
          userIdHash: 'user-hash',
          proofParamsUrl: 'https://gateway.example/proof-params/request-id',
          proofRequestUrl: 'https://app.rarime.com/external?id=request-id',
        }),
      )
      .mockResolvedValueOnce(json({ status: 'verified' }))
      .mockResolvedValueOnce(json(evidence))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = new HttpRarimoVerificationGateway({
      baseUrl: 'https://passport-api.example/',
      fetcher,
    });

    const link = await gateway.createVerificationRequest(verificationRequest);
    expect(link.proofRequestUrl).toBe('https://app.rarime.com/external?id=request-id');
    await expect(gateway.getVerificationStatus('request-id')).resolves.toBe('verified');
    await expect(gateway.getVerifiedEvidence('request-id')).resolves.toEqual(evidence);
    await gateway.deleteVerification('request-id');

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://passport-api.example/v1/rarimo/verification-requests',
      'https://passport-api.example/v1/rarimo/verification-requests/request-id/status',
      'https://passport-api.example/v1/rarimo/verification-requests/request-id/evidence',
      'https://passport-api.example/v1/rarimo/verification-requests/request-id',
    ]);
    const createBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(createBody).toEqual(verificationRequest);
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(
      /"(proof|pub_signals|mrz|birthDate|passportNumber|nfc|choice)"/i,
    );
  });

  it('issues from a public holder binding and minimal claims only', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        issuanceId: 'issuance-id',
        credentialBlindHex: '02'.repeat(32),
        credentialLeafHex: '03'.repeat(32),
        receipt: credentialReceipt,
      }),
    );
    const issuer = new HttpCivicCredentialIssuerPort({
      baseUrl: 'http://localhost:8790',
      fetcher,
    });
    const result = await issuer.issueCredential({
      enrollmentId: 'enrollment-id',
      provider: 'rarimo',
      evidenceAuthorization: 'single-use-evidence-authorization',
      holderBinding: new Uint8Array(32).fill(1),
      claims: {
        issuerId: 'cico-preview-issuer',
        country: isoNumericCountry('032'),
        ageClass: '18-plus',
        assurance: 'document-nfc',
        credentialEpoch: 1,
        validFrom: '2026-08-24T12:00:00.000Z',
        validUntil: '2026-08-25T12:00:00.000Z',
      },
    });

    expect(result.credentialBlind).toEqual(new Uint8Array(32).fill(2));
    expect(result.credentialLeaf).toEqual(new Uint8Array(32).fill(3));
    expect(result.receipt).toEqual(credentialReceipt);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      enrollmentId: 'enrollment-id',
      provider: 'rarimo',
      evidenceAuthorization: 'single-use-evidence-authorization',
      holderBindingHex: '01'.repeat(32),
      claims: expect.objectContaining({ country: '032', assurance: 'document-nfc' }),
    });
    expect(JSON.stringify(body)).not.toMatch(
      /"(proof|pub_signals|mrz|birthDate|passportNumber|nfc|choice|holderSecret|holderBlind)"/i,
    );
  });

  it('rejects insecure remotes, raw proof responses, and non-canonical issuance receipts', async () => {
    expect(
      () => new HttpRarimoVerificationGateway({ baseUrl: 'http://passport-api.example' }),
    ).toThrow('requires HTTPS');

    const rawGateway = new HttpRarimoVerificationGateway({
      baseUrl: 'https://passport-api.example',
      fetcher: vi.fn().mockResolvedValue(json({ proof: { pi_a: ['secret'] } })),
    });
    await expect(rawGateway.getVerifiedEvidence('request-id')).rejects.toMatchObject({
      code: 'ADAPTER_UNAVAILABLE',
      retryable: true,
    });

    const badIssuer = new HttpCivicCredentialIssuerPort({
      baseUrl: 'https://passport-api.example',
      fetcher: vi.fn().mockResolvedValue(
        json({
          issuanceId: 'issuance-id',
          credentialBlindHex: '02'.repeat(32),
          credentialLeafHex: '03'.repeat(32),
          receipt: { ...credentialReceipt, action: 'vote', circuit: 'castVote' },
        }),
      ),
    });
    await expect(
      badIssuer.issueCredential({
        enrollmentId: 'enrollment-id',
        provider: 'rarimo',
        evidenceAuthorization: 'single-use-evidence-authorization',
        holderBinding: new Uint8Array(32),
        claims: {
          issuerId: 'issuer',
          country: isoNumericCountry('032'),
          ageClass: '18-plus',
          assurance: 'document-nfc',
          credentialEpoch: 1,
          validFrom: '2026-08-24T12:00:00.000Z',
          validUntil: '2026-08-25T12:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'ADAPTER_UNAVAILABLE' });
  });

  describe('when the issuer refuses a pass', () => {
    const issuance = {
      enrollmentId: 'enrollment-id',
      provider: 'rarimo' as const,
      evidenceAuthorization: 'single-use-evidence-authorization',
      holderBinding: new Uint8Array(32).fill(1),
      claims: {
        issuerId: 'cico-preview-issuer',
        country: isoNumericCountry('032'),
        ageClass: '18-plus' as const,
        assurance: 'document-nfc' as const,
        credentialEpoch: 1,
        validFrom: '2026-08-24T12:00:00.000Z',
        validUntil: '2026-08-25T12:00:00.000Z',
      },
    };
    const issuerAnswering = (body: unknown, status: number) =>
      new HttpCivicCredentialIssuerPort({
        baseUrl: 'https://passport-api.example',
        fetcher: vi.fn().mockResolvedValue(json(body, status)),
      });

    it('names a document that belongs to another device, and does not call it retryable', async () => {
      const issuer = issuerAnswering(
        {
          message: 'This document already has a pass, held by another device or browser',
          code: 'DOCUMENT_ALREADY_ENROLLED',
        },
        409,
      );
      await expect(issuer.issueCredential(issuance)).rejects.toMatchObject({
        code: 'DOCUMENT_ALREADY_ENROLLED',
        retryable: false,
      });
    });

    it('takes the code only from a conflict: no other answer can end a verification', async () => {
      // The same code on a server error is a failure to try again.
      await expect(
        issuerAnswering(
          { message: 'unavailable', code: 'DOCUMENT_ALREADY_ENROLLED' },
          503,
        ).issueCredential(issuance),
      ).rejects.toMatchObject({ code: 'ADAPTER_UNAVAILABLE', retryable: true });
      // A conflict without the code stays what it was.
      await expect(
        issuerAnswering({ message: 'conflict' }, 409).issueCredential(issuance),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL_CLAIMS' });
    });
  });
});

describe('HttpEnrollmentStatusPort', () => {
  const wire = {
    pendingCount: 12,
    minBatchSize: 16,
    maxWaitMs: 900_000,
    pendingSinceUnixMs: 1_000,
    publishesNoLaterThanUnixMs: 901_000,
    lastPublishedAtUnixMs: 500,
    observedAtUnixMs: 2_000,
  };

  it('reads the pending batch and the deadline it is bounded by', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(wire));
    const port = new HttpEnrollmentStatusPort({ baseUrl: 'https://cico.test', fetcher });

    await expect(port.getStatus()).resolves.toEqual(wire);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://cico.test/v1/enrollment/status');
  });

  it('keeps an unobserved count as null instead of defaulting it to zero', async () => {
    const fetcher = vi.fn(async () =>
      json({ ...wire, pendingCount: null, publishesNoLaterThanUnixMs: null }),
    );
    const port = new HttpEnrollmentStatusPort({ baseUrl: 'https://cico.test', fetcher });

    const status = await port.getStatus();
    expect(status.pendingCount).toBeNull();
    expect(status.publishesNoLaterThanUnixMs).toBeNull();
  });

  it('rejects a malformed count rather than rendering a wrong number', async () => {
    const fetcher = vi.fn(async () => json({ ...wire, pendingCount: 'twelve' }));
    const port = new HttpEnrollmentStatusPort({ baseUrl: 'https://cico.test', fetcher });

    await expect(port.getStatus()).rejects.toMatchObject({ message: 'Invalid pendingCount' });
  });

  it('surfaces an unavailable service as retryable rather than as a bad request', async () => {
    const fetcher = vi.fn(async () => json({ message: 'Enrollment status unavailable' }, 503));
    const port = new HttpEnrollmentStatusPort({ baseUrl: 'https://cico.test', fetcher });

    await expect(port.getStatus()).rejects.toMatchObject({ code: 'ADAPTER_UNAVAILABLE' });
  });
});
