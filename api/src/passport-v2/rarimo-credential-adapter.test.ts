import { describe, expect, it } from 'vitest';
import { deriveCredentialLeaf, deriveHolderBinding } from './crypto.js';
import type {
  CivicCredentialIssuanceRequest,
  CivicCredentialIssuerPort,
  CivicCredentialVaultPort,
  StoredCivicCredential,
} from './ports.js';
import {
  type HolderKeyVaultPort,
  RarimoCivicCredentialAdapter,
  type RarimoEnrollmentVaultPort,
  type StoredHolderKey,
  type StoredRarimoEnrollment,
} from './rarimo-credential-adapter.js';
import { rarimoVerificationRequestProblem } from './rarimo-query.js';
import type {
  RarimoVerificationGateway,
  RarimoVerificationLink,
  RarimoVerificationRequest,
  RarimoVerificationStatus,
  RarimoVerifiedEvidence,
} from './rarimo-types.js';
import {
  CivicCredentialError,
  type CredentialEnrollmentRequest,
  isoNumericCountry,
  type PassportSession,
} from './types.js';

const now = new Date('2026-08-24T12:00:00.000Z');
const argentina = isoNumericCountry('032');
const france = isoNumericCountry('250');

const mapper = {
  fromAlpha3(alpha3: string) {
    return alpha3 === 'ARG' ? argentina : alpha3 === 'FRA' ? france : undefined;
  },
  toAlpha3(country: typeof argentina) {
    return country === argentina ? 'ARG' : country === france ? 'FRA' : undefined;
  },
};

function session(): PassportSession {
  return {
    sessionId: 'midnight-preview-session',
    origin: 'http://localhost:4173',
    network: 'preview',
    status: 'connected',
    capabilities: ['session', 'profile'],
  };
}

function request(policy?: CredentialEnrollmentRequest['policy']): CredentialEnrollmentRequest {
  return { session: session(), policy };
}

function deterministicRandomBytes(): (length: number) => Uint8Array {
  let next = 1;
  return (length) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = next;
      next = (next + 1) % 256;
    }
    return bytes;
  };
}

class FakeRarimoGateway implements RarimoVerificationGateway {
  readonly requests = new Map<string, RarimoVerificationRequest>();
  readonly statuses = new Map<string, RarimoVerificationStatus>();
  readonly deleted: string[] = [];
  readonly proofReads = new Map<string, number>();
  evidenceOverride?: (
    request: RarimoVerificationRequest,
    evidence: RarimoVerifiedEvidence,
  ) => RarimoVerifiedEvidence;

  async createVerificationRequest(
    request: RarimoVerificationRequest,
  ): Promise<RarimoVerificationLink> {
    this.requests.set(request.requestId, request);
    this.statuses.set(request.requestId, 'not_verified');
    return {
      requestId: request.requestId,
      userIdHash: `user-${request.requestId}`,
      proofParamsUrl: `http://preview.invalid/proof-params/${request.requestId}`,
      proofRequestUrl: `https://app.rarime.com/external?type=proof-request&proof_params_url=${request.requestId}`,
    };
  }

  async getVerificationStatus(requestId: string): Promise<RarimoVerificationStatus> {
    return this.statuses.get(requestId) ?? 'failed_verification';
  }

  async getVerifiedEvidence(requestId: string): Promise<RarimoVerifiedEvidence | null> {
    const request = this.requests.get(requestId);
    if (!request || this.statuses.get(requestId) !== 'verified') return null;
    this.proofReads.set(requestId, (this.proofReads.get(requestId) ?? 0) + 1);
    const evidence: RarimoVerifiedEvidence = {
      requestId,
      userIdHash: `user-${requestId}`,
      evidenceAuthorization: `authorization-${requestId}`,
      evidenceFingerprint: 'ab'.repeat(32),
      eventId: request.eventId,
      eventDataDecimal: request.eventDataDecimal,
      selector: request.selector,
      timestampUpperBound: request.timestampUpperBound,
      identityCounterUpperBound: request.identityCounterUpperBound,
      birthDateUpperBound: BigInt(request.birthDateUpperBound).toString(10),
      expirationDateLowerBound: BigInt(request.expirationDateLowerBound).toString(10),
      citizenshipAlpha3: 'ARG',
      adultPredicateSatisfied: request.birthDateUpperBound !== '0x303030303030',
    };
    return this.evidenceOverride?.(request, evidence) ?? evidence;
  }

  async deleteVerification(requestId: string): Promise<void> {
    this.deleted.push(requestId);
  }
}

class FakeCicoIssuer implements CivicCredentialIssuerPort {
  readonly adapterName = 'fake-cico-midnight-issuer';
  readonly requests: CivicCredentialIssuanceRequest[] = [];
  fail = false;

  async issueCredential(request: CivicCredentialIssuanceRequest) {
    this.requests.push(request);
    if (this.fail) throw new Error('issuer unavailable');
    const credentialBlind = new Uint8Array(32).fill(91);
    return {
      issuanceId: `issuance-${request.enrollmentId}`,
      credentialBlind,
      credentialLeaf: deriveCredentialLeaf({
        holderBinding: request.holderBinding,
        claims: request.claims,
        credentialBlind,
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
  }
}

class MemoryCredentialVault implements CivicCredentialVaultPort {
  stored: StoredCivicCredential | null = null;

  async load() {
    return this.stored;
  }

  async save(credential: StoredCivicCredential) {
    this.stored = structuredClone(credential);
  }

  async clear() {
    this.stored = null;
  }
}

function makeAdapter(
  gateway: FakeRarimoGateway,
  randomBytes = deterministicRandomBytes(),
  issuer: CivicCredentialIssuerPort = new FakeCicoIssuer(),
  vault?: CivicCredentialVaultPort,
) {
  return new RarimoCivicCredentialAdapter({
    gateway,
    issuer,
    issuerId: 'cico-rarimo-preview',
    credentialEpoch: 7,
    countryMapper: mapper,
    uniquenessTimestampUpperBoundUnixSeconds: 1_800_000_000,
    now: () => new Date(now),
    randomBytes,
    vault,
  });
}

describe('Rarimo civic credential boundary', () => {
  it('creates an opaque request and keeps pending evidence provider-neutral', async () => {
    const gateway = new FakeRarimoGateway();
    const adapter = makeAdapter(gateway);
    const enrollment = await adapter.beginEnrollment(
      request({ allowedCountries: [argentina], minimumAssurance: 'document', requireAdult: true }),
    );
    const providerRequest = [...gateway.requests.values()][0];

    expect(enrollment.status).toBe('pending');
    expect(enrollment.interaction).toMatchObject({
      kind: 'cross-device-qr',
    });
    expect(enrollment.interaction?.uri).toMatch(/^https:\/\/app\.rarime\.com\//);
    expect(enrollment.holderBinding).toHaveLength(32);
    const expectedRandom = deterministicRandomBytes();
    expectedRandom(16);
    expectedRandom(16);
    const voterSecret = expectedRandom(32);
    const holderBlind = expectedRandom(32);
    expect(enrollment.holderBinding).toEqual(deriveHolderBinding(voterSecret, holderBlind));
    expect(providerRequest.requestId).not.toBe('');
    expect(providerRequest.eventData).toMatch(/^0x[0-9a-f]+$/);
    expect(providerRequest.eventDataDecimal).toBe(BigInt(providerRequest.eventData).toString(10));
    expect(providerRequest.eventId).not.toBe('0');
    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'pending',
    });
    await expect(adapter.getCredentialSummary()).resolves.toBeNull();
  });

  it('asks only for verifications the credential service takes', async () => {
    // The service refuses a request of any other shape than the one it shares
    // with this adapter. Each policy the app can ask for must pass that check.
    for (const policy of [
      undefined,
      { requireAdult: true },
      { requireAdult: false, minimumAssurance: 'document-nfc' as const },
      { allowedCountries: [argentina], requireAdult: true },
    ]) {
      const gateway = new FakeRarimoGateway();
      await makeAdapter(gateway).beginEnrollment(request(policy));
      const asked = [...gateway.requests.values()][0];
      if (!asked) throw new Error('expected a verification request');
      expect(rarimoVerificationRequestProblem(asked, now)).toBeNull();
      expect(asked.identityCounterUpperBound).toBe('1');
    }
  });

  it('issues only after exact verified status and request-bound proof checks', async () => {
    const gateway = new FakeRarimoGateway();
    const issuer = new FakeCicoIssuer();
    const adapter = makeAdapter(gateway, deterministicRandomBytes(), issuer);
    const enrollment = await adapter.beginEnrollment(request({ requireAdult: true }));
    const requestId = [...gateway.requests.keys()][0];
    gateway.statuses.set(requestId, 'verified');

    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });
    await expect(adapter.getCredentialSummary()).resolves.toMatchObject({
      provider: 'rarimo',
      status: 'issued',
      issuerId: 'cico-rarimo-preview',
      country: '032',
      ageClass: '18-plus',
      assurance: 'document-nfc',
      credentialEpoch: 7,
    });
    expect(issuer.requests).toHaveLength(1);
    expect(Object.keys(issuer.requests[0]).sort()).toEqual([
      'claims',
      'enrollmentId',
      'evidenceAuthorization',
      'holderBinding',
      'provider',
    ]);
    expect(issuer.requests[0].evidenceAuthorization).toMatch(/^authorization-/);
    await expect(adapter.getActionAuthorization()).resolves.toEqual({
      kind: 'civic-credential',
      handle: `issuance-${enrollment.enrollmentId}`,
    });
    const privateMaterial = await adapter.getPrivateCredentialMaterial();
    expect(privateMaterial).not.toBeNull();
    expect(privateMaterial?.holderBinding).toEqual(
      deriveHolderBinding(
        privateMaterial?.voterSecret ?? new Uint8Array(),
        privateMaterial?.holderBlind ?? new Uint8Array(),
      ),
    );
    expect(privateMaterial?.credentialBlind).toEqual(new Uint8Array(32).fill(91));
    expect(privateMaterial?.credentialLeaf).toEqual(
      deriveCredentialLeaf({
        holderBinding: privateMaterial?.holderBinding ?? new Uint8Array(),
        claims: privateMaterial?.claims ?? issuer.requests[0].claims,
        credentialBlind: privateMaterial?.credentialBlind ?? new Uint8Array(),
      }),
    );
    privateMaterial?.voterSecret.fill(0);
    privateMaterial?.credentialBlind.fill(0);
    const secondRead = await adapter.getPrivateCredentialMaterial();
    expect(secondRead?.voterSecret).not.toEqual(privateMaterial?.voterSecret);
    expect(secondRead?.credentialBlind).toEqual(new Uint8Array(32).fill(91));
  });

  it('restores issued credential material from the encrypted-vault boundary after restart', async () => {
    const gateway = new FakeRarimoGateway();
    const issuer = new FakeCicoIssuer();
    const vault = new MemoryCredentialVault();
    const first = makeAdapter(gateway, deterministicRandomBytes(), issuer, vault);
    const enrollment = await first.beginEnrollment(request({ requireAdult: true }));
    gateway.statuses.set([...gateway.requests.keys()][0], 'verified');

    await expect(first.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });

    const restarted = makeAdapter(
      new FakeRarimoGateway(),
      deterministicRandomBytes(),
      new FakeCicoIssuer(),
      vault,
    );
    await expect(restarted.getCredentialSummary()).resolves.toMatchObject({
      provider: 'rarimo',
      status: 'issued',
      country: '032',
    });
    await expect(restarted.getActionAuthorization()).resolves.toEqual({
      kind: 'civic-credential',
      handle: `issuance-${enrollment.enrollmentId}`,
    });
    await expect(restarted.getPrivateCredentialMaterial()).resolves.toMatchObject({
      credentialBlind: new Uint8Array(32).fill(91),
    });

    await restarted.clearCredential();
    await expect(restarted.getCredentialSummary()).resolves.toBeNull();
    expect(vault.stored).toBeNull();
  });

  it('does not mark verified evidence issued until the Midnight issuer confirms it', async () => {
    const gateway = new FakeRarimoGateway();
    const issuer = new FakeCicoIssuer();
    issuer.fail = true;
    const adapter = makeAdapter(gateway, deterministicRandomBytes(), issuer);
    const enrollment = await adapter.beginEnrollment(request());
    const requestId = [...gateway.requests.keys()][0];
    gateway.statuses.set(requestId, 'verified');

    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).rejects.toMatchObject({
      code: 'ISSUANCE_FAILED',
      retryable: true,
    });
    await expect(adapter.getCredentialSummary()).resolves.toBeNull();
    await expect(adapter.getActionAuthorization()).resolves.toBeNull();

    issuer.fail = false;
    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });
  });

  it('is idempotent for replayed status polling and cleanup', async () => {
    const gateway = new FakeRarimoGateway();
    const adapter = makeAdapter(gateway);
    const enrollment = await adapter.beginEnrollment(request());
    const requestId = [...gateway.requests.keys()][0];
    gateway.statuses.set(requestId, 'verified');

    await adapter.getEnrollmentStatus(enrollment.enrollmentId);
    await adapter.getEnrollmentStatus(enrollment.enrollmentId);
    expect(gateway.proofReads.get(requestId)).toBe(1);
    await adapter.clearCredential();
    await adapter.clearCredential();
    expect(gateway.deleted).toEqual([requestId]);
  });

  it('serializes concurrent verified polls into one issuer operation', async () => {
    const gateway = new FakeRarimoGateway();
    const issuer = new FakeCicoIssuer();
    const adapter = makeAdapter(gateway, deterministicRandomBytes(), issuer);
    const enrollment = await adapter.beginEnrollment(request());
    const requestId = [...gateway.requests.keys()][0];
    gateway.statuses.set(requestId, 'verified');

    const results = await Promise.all([
      adapter.getEnrollmentStatus(enrollment.enrollmentId),
      adapter.getEnrollmentStatus(enrollment.enrollmentId),
      adapter.getEnrollmentStatus(enrollment.enrollmentId),
    ]);
    expect(results.every((result) => result.status === 'issued')).toBe(true);
    expect(issuer.requests).toHaveLength(1);
    expect(gateway.proofReads.get(requestId)).toBe(1);
  });

  it('rejects provider failure and invokes the cleanup hook', async () => {
    const gateway = new FakeRarimoGateway();
    const adapter = makeAdapter(gateway);
    const enrollment = await adapter.beginEnrollment(request());
    const requestId = [...gateway.requests.keys()][0];
    gateway.statuses.set(requestId, 'uniqueness_check_failed');

    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_CREDENTIAL_CLAIMS',
    });
    expect(gateway.deleted).toEqual([requestId]);
    await expect(adapter.getCredentialSummary()).resolves.toBeNull();
  });

  it('rejects a proof whose request or user binding was changed', async () => {
    const gateway = new FakeRarimoGateway();
    gateway.evidenceOverride = (request, evidence) => ({
      ...evidence,
      requestId: `${request.requestId}-replayed`,
    });
    const adapter = makeAdapter(gateway);
    const enrollment = await adapter.beginEnrollment(request());
    const requestId = [...gateway.requests.keys()][0];
    gateway.statuses.set(requestId, 'verified');

    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_CREDENTIAL_CLAIMS',
    });
    expect(gateway.deleted).toEqual([requestId]);
  });

  it('clears pending provider state and forgets the enrollment locally', async () => {
    const gateway = new FakeRarimoGateway();
    const adapter = makeAdapter(gateway);
    const enrollment = await adapter.beginEnrollment(request());
    const requestId = [...gateway.requests.keys()][0];

    await adapter.clearCredential();
    expect(gateway.deleted).toEqual([requestId]);
    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND',
    });
    await expect(adapter.getCredentialSummary()).resolves.toBeNull();
    await expect(adapter.getPrivateCredentialMaterial()).resolves.toBeNull();
  });
});

/** The device's vault for a verification in progress. It outlives a page. */
class MemoryEnrollmentVault implements RarimoEnrollmentVaultPort {
  stored: StoredRarimoEnrollment | null = null;
  failing = false;

  async load() {
    if (this.failing) throw new Error('vault unavailable');
    return this.stored ? structuredClone(this.stored) : null;
  }

  async save(enrollment: StoredRarimoEnrollment) {
    if (this.failing) throw new Error('vault unavailable');
    this.stored = structuredClone(enrollment);
  }

  async clear() {
    this.stored = null;
  }
}

describe('a verification in progress when the page is dropped', () => {
  // One gateway, one issuer and two vaults stand for the services and the
  // device. Each call to `page()` is the app starting again on that device.
  function device() {
    const gateway = new FakeRarimoGateway();
    const issuer = new FakeCicoIssuer();
    const vault = new MemoryCredentialVault();
    const pendingVault = new MemoryEnrollmentVault();
    const page = () =>
      new RarimoCivicCredentialAdapter({
        gateway,
        issuer,
        issuerId: 'cico-rarimo-preview',
        credentialEpoch: 7,
        countryMapper: mapper,
        uniquenessTimestampUpperBoundUnixSeconds: 1_800_000_000,
        now: () => new Date(now),
        vault,
        pendingVault,
      });
    return { gateway, issuer, vault, pendingVault, page };
  }

  it('picks the attempt up again and issues the pass the scan was bound to', async () => {
    const { gateway, issuer, vault, pendingVault, page } = device();
    const enrollment = await page().beginEnrollment(request({ requireAdult: true }));
    const requestId = [...gateway.requests.keys()][0];
    expect(pendingVault.stored?.enrollmentId).toBe(enrollment.enrollmentId);

    // The person scans in the other app. Meanwhile the browser drops the page.
    gateway.statuses.set(requestId, 'verified');
    const reloaded = page();

    await expect(reloaded.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });
    // Issued for the binding the scan carried, not for a new one.
    expect(issuer.requests).toHaveLength(1);
    expect(issuer.requests[0]?.holderBinding).toEqual(enrollment.holderBinding);
    const material = await reloaded.getPrivateCredentialMaterial();
    expect(material?.holderBinding).toEqual(enrollment.holderBinding);
    expect(
      deriveHolderBinding(material?.voterSecret as Uint8Array, material?.holderBlind as Uint8Array),
    ).toEqual(enrollment.holderBinding);
    // The pass is in its own vault; the attempt is gone.
    expect(vault.stored?.summary.status).toBe('issued');
    expect(pendingVault.stored).toBeNull();
  });

  it('keeps waiting after a reload while the scan is not done', async () => {
    const { gateway, pendingVault, page } = device();
    const enrollment = await page().beginEnrollment(request());
    const reloaded = page();

    await expect(reloaded.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'pending',
    });
    expect(pendingVault.stored?.enrollmentId).toBe(enrollment.enrollmentId);
    expect(gateway.deleted).toEqual([]);
  });

  it('keeps nothing of the attempt that names the person or the document', async () => {
    const { pendingVault, page } = device();
    await page().beginEnrollment(request({ requireAdult: true }));
    const kept = pendingVault.stored;
    if (!kept) throw new Error('expected a kept attempt');
    expect(Object.keys(kept).sort()).toEqual(
      [
        'createdAt',
        'enrollmentId',
        'expiresAt',
        'holderBinding',
        'holderBlind',
        'holderSecret',
        'policy',
        'request',
        'requestId',
        'userIdHash',
      ].sort(),
    );
    expect(JSON.stringify(kept)).not.toMatch(/mrz|passport|birthDate"|nfc|proof"/iu);
  });

  it('forgets the attempt when it fails, expires, is cleared or is replaced', async () => {
    const failed = device();
    const first = await failed.page().beginEnrollment(request());
    failed.gateway.statuses.set([...failed.gateway.requests.keys()][0], 'failed_verification');
    await expect(failed.page().getEnrollmentStatus(first.enrollmentId)).resolves.toMatchObject({
      status: 'failed',
    });
    expect(failed.pendingVault.stored).toBeNull();

    const cleared = device();
    const adapter = cleared.page();
    await adapter.beginEnrollment(request());
    await adapter.clearCredential();
    expect(cleared.pendingVault.stored).toBeNull();

    const replaced = device();
    const old = await replaced.page().beginEnrollment(request());
    const next = await replaced.page().beginEnrollment(request());
    expect(replaced.pendingVault.stored?.enrollmentId).toBe(next.enrollmentId);
    await expect(replaced.page().getEnrollmentStatus(old.enrollmentId)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND',
    });

    const expired = device();
    const late = await expired.page().beginEnrollment(request());
    const afterTheWindow = new RarimoCivicCredentialAdapter({
      gateway: expired.gateway,
      issuer: expired.issuer,
      issuerId: 'cico-rarimo-preview',
      credentialEpoch: 7,
      countryMapper: mapper,
      uniquenessTimestampUpperBoundUnixSeconds: 1_800_000_000,
      now: () => new Date(now.getTime() + 11 * 60 * 1_000),
      pendingVault: expired.pendingVault,
    });
    await expect(afterTheWindow.getEnrollmentStatus(late.enrollmentId)).resolves.toMatchObject({
      status: 'expired',
    });
    expect(expired.pendingVault.stored).toBeNull();
  });

  it('refuses a kept attempt whose secret does not lead to its binding', async () => {
    const { gateway, issuer, pendingVault, page } = device();
    const enrollment = await page().beginEnrollment(request());
    gateway.statuses.set([...gateway.requests.keys()][0], 'verified');
    if (!pendingVault.stored) throw new Error('expected a kept attempt');
    pendingVault.stored = {
      ...pendingVault.stored,
      holderSecret: new Uint8Array(32).fill(250),
    };

    await expect(page().getEnrollmentStatus(enrollment.enrollmentId)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND',
    });
    expect(issuer.requests).toHaveLength(0);
    expect(pendingVault.stored).toBeNull();
  });

  it('still runs the scan when the vault cannot be written or read', async () => {
    const { gateway, pendingVault, page } = device();
    pendingVault.failing = true;
    const adapter = page();
    const enrollment = await adapter.beginEnrollment(request());
    gateway.statuses.set([...gateway.requests.keys()][0], 'verified');

    // The same page still holds the attempt and completes it.
    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });
    // A new page finds nothing, as before this vault existed.
    await expect(page().getEnrollmentStatus(enrollment.enrollmentId)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND',
    });
  });
});

describe('asking the issuer again for the same pass', () => {
  // A clock that moves: each look at it is five seconds later.
  function movingClock() {
    let time = now.getTime();
    return () => {
      time += 5_000;
      return new Date(time);
    };
  }

  it('asks with the claims of the first attempt, however much later', async () => {
    const gateway = new FakeRarimoGateway();
    const issuer = new FakeCicoIssuer();
    const adapter = new RarimoCivicCredentialAdapter({
      gateway,
      issuer,
      issuerId: 'cico-rarimo-preview',
      credentialEpoch: 7,
      countryMapper: mapper,
      uniquenessTimestampUpperBoundUnixSeconds: 1_800_000_000,
      now: movingClock(),
    });
    const enrollment = await adapter.beginEnrollment(request({ requireAdult: true }));
    gateway.statuses.set([...gateway.requests.keys()][0], 'verified');

    // The request is cut off: the issuer may or may not have issued the pass.
    issuer.fail = true;
    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).rejects.toMatchObject({
      code: 'ISSUANCE_FAILED',
      retryable: true,
    });
    issuer.fail = false;
    await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });

    expect(issuer.requests).toHaveLength(2);
    // The issuer tells a retry from a different pass by these. They must not move.
    expect(issuer.requests[1]?.claims).toEqual(issuer.requests[0]?.claims);
    expect(issuer.requests[1]?.evidenceAuthorization).toBe(
      issuer.requests[0]?.evidenceAuthorization,
    );
    const summary = await adapter.getCredentialSummary();
    expect(summary?.validFrom).toBe(issuer.requests[0]?.claims.validFrom);
  });

  it('asks for the same pass after the page was dropped while it was being issued', async () => {
    const gateway = new FakeRarimoGateway();
    const issuer = new FakeCicoIssuer();
    const pendingVault = new MemoryEnrollmentVault();
    const clock = movingClock();
    const page = () =>
      new RarimoCivicCredentialAdapter({
        gateway,
        issuer,
        issuerId: 'cico-rarimo-preview',
        credentialEpoch: 7,
        countryMapper: mapper,
        uniquenessTimestampUpperBoundUnixSeconds: 1_800_000_000,
        now: clock,
        vault: new MemoryCredentialVault(),
        pendingVault,
      });
    const first = page();
    const enrollment = await first.beginEnrollment(request());
    gateway.statuses.set([...gateway.requests.keys()][0], 'verified');
    issuer.fail = true;
    await expect(first.getEnrollmentStatus(enrollment.enrollmentId)).rejects.toMatchObject({
      code: 'ISSUANCE_FAILED',
    });
    expect(pendingVault.stored?.issuanceClaims).toEqual(issuer.requests[0]?.claims);

    issuer.fail = false;
    await expect(page().getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });
    expect(issuer.requests[1]?.claims).toEqual(issuer.requests[0]?.claims);
    expect(issuer.requests[1]?.holderBinding).toEqual(issuer.requests[0]?.holderBinding);
  });
});

/** The device's vault for its holder secret. It outlives every pass. */
class MemoryHolderKeyVault implements HolderKeyVaultPort {
  stored: StoredHolderKey | null = null;
  saves = 0;
  failing: 'load' | 'save' | null = null;

  async load() {
    if (this.failing === 'load') throw new Error('vault unavailable');
    return this.stored ? structuredClone(this.stored) : null;
  }

  async save(key: StoredHolderKey) {
    if (this.failing === 'save') throw new Error('vault unavailable');
    this.saves += 1;
    this.stored = structuredClone(key);
  }
}

describe('one holder for every pass a device is issued', () => {
  const event = '424242';

  // One gateway and one issuer stand for the services; a device is its vaults.
  function services() {
    return { gateway: new FakeRarimoGateway(), issuer: new FakeCicoIssuer() };
  }

  function device(
    { gateway, issuer }: { gateway: FakeRarimoGateway; issuer: CivicCredentialIssuerPort },
    holderKeyVault: HolderKeyVaultPort | null = new MemoryHolderKeyVault(),
  ) {
    const vault = new MemoryCredentialVault();
    const pendingVault = new MemoryEnrollmentVault();
    const page = () =>
      new RarimoCivicCredentialAdapter({
        gateway,
        issuer,
        issuerId: 'cico-rarimo-preview',
        credentialEpoch: 7,
        countryMapper: mapper,
        uniquenessTimestampUpperBoundUnixSeconds: 1_800_000_000,
        now: () => new Date(now),
        vault,
        pendingVault,
        verificationEventId: event,
        ...(holderKeyVault ? { holderKeyVault } : {}),
      });
    return { vault, pendingVault, page };
  }

  it('asks for every verification under the event of its registry', async () => {
    const shared = services();
    await device(shared).page().beginEnrollment(request());
    await device(shared)
      .page()
      .beginEnrollment(request({ requireAdult: true }));

    const asked = [...shared.gateway.requests.values()];
    expect(asked).toHaveLength(2);
    // The same event on two devices: a document shows both the same nullifier.
    expect(asked.map((one) => one.eventId)).toEqual([event, event]);
    // What ties a proof to its attempt is still its own.
    expect(asked[0]?.eventData).not.toBe(asked[1]?.eventData);
  });

  it('refuses an event that is not a positive decimal', () => {
    for (const malformed of ['0', '', '0x2a', '-1', '1'.repeat(78)]) {
      expect(
        () =>
          new RarimoCivicCredentialAdapter({
            ...services(),
            issuerId: 'cico-rarimo-preview',
            credentialEpoch: 7,
            countryMapper: mapper,
            uniquenessTimestampUpperBoundUnixSeconds: 1_800_000_000,
            verificationEventId: malformed,
          }),
      ).toThrow('verificationEventId must be a positive decimal field element');
    }
  });

  it('keeps one holder across attempts, reloads and renewals', async () => {
    const shared = services();
    const keys = new MemoryHolderKeyVault();
    const { page } = device(shared, keys);

    const first = await page().beginEnrollment(request());
    // The person starts again, then the page is dropped, then they come back.
    const second = await page().beginEnrollment(request());
    expect(second.holderBinding).toEqual(first.holderBinding);
    expect(keys.saves).toBe(1);

    shared.gateway.statuses.set([...shared.gateway.requests.keys()][1] as string, 'verified');
    const issuing = page();
    await expect(issuing.getEnrollmentStatus(second.enrollmentId)).resolves.toMatchObject({
      status: 'issued',
    });

    // A renewal, weeks later: the pass is replaced, the holder is not.
    const renewal = await page().beginEnrollment(request());
    expect(renewal.holderBinding).toEqual(first.holderBinding);
    expect(keys.saves).toBe(1);
    const kept = keys.stored;
    if (!kept) throw new Error('expected a kept holder key');
    expect(deriveHolderBinding(kept.holderSecret, kept.holderBlind)).toEqual(first.holderBinding);
  });

  it('survives the pass being cleared: the document still has this holder', async () => {
    const shared = services();
    const keys = new MemoryHolderKeyVault();
    const { page } = device(shared, keys);
    const adapter = page();
    const first = await adapter.beginEnrollment(request());
    await adapter.clearCredential();

    const again = await page().beginEnrollment(request());
    expect(again.holderBinding).toEqual(first.holderBinding);
  });

  it('gives two devices two holders, and a device without the vault a new one each time', async () => {
    const shared = services();
    const one = await device(shared).page().beginEnrollment(request());
    const other = await device(shared).page().beginEnrollment(request());
    expect(other.holderBinding).not.toEqual(one.holderBinding);

    const forgetful = device(shared, null);
    const early = await forgetful.page().beginEnrollment(request());
    const late = await forgetful.page().beginEnrollment(request());
    expect(late.holderBinding).not.toEqual(early.holderBinding);
  });

  it('keeps the holder key and nothing else beside it', async () => {
    const keys = new MemoryHolderKeyVault();
    await device(services(), keys)
      .page()
      .beginEnrollment(request({ requireAdult: true }));
    const kept = keys.stored;
    if (!kept) throw new Error('expected a kept holder key');
    expect(Object.keys(kept).sort()).toEqual(['holderBlind', 'holderSecret']);
    expect(kept.holderSecret).toHaveLength(32);
    expect(kept.holderBlind).toHaveLength(32);
  });

  it('does not start a verification when the key cannot be kept or read', async () => {
    const shared = services();
    const keys = new MemoryHolderKeyVault();
    keys.failing = 'save';
    await expect(device(shared, keys).page().beginEnrollment(request())).rejects.toMatchObject({
      code: 'ADAPTER_UNAVAILABLE',
    });
    keys.failing = 'load';
    await expect(device(shared, keys).page().beginEnrollment(request())).rejects.toMatchObject({
      code: 'ADAPTER_UNAVAILABLE',
      retryable: true,
    });
    // No scan was asked for: a pass with a holder nobody kept would lock the
    // document out for the whole epoch.
    expect(shared.gateway.requests.size).toBe(0);
  });

  it('replaces a kept key that is not a key, rather than issuing under it', async () => {
    const keys = new MemoryHolderKeyVault();
    keys.stored = { holderSecret: new Uint8Array(5), holderBlind: new Uint8Array(32) };
    const enrollment = await device(services(), keys).page().beginEnrollment(request());
    expect(keys.saves).toBe(1);
    expect(keys.stored?.holderSecret).toHaveLength(32);
    expect(
      deriveHolderBinding(
        keys.stored?.holderSecret as Uint8Array,
        keys.stored?.holderBlind as Uint8Array,
      ),
    ).toEqual(enrollment.holderBinding);
  });

  describe('when the document already belongs to another device', () => {
    class RefusingIssuer implements CivicCredentialIssuerPort {
      readonly adapterName = 'refusing-issuer';
      asked = 0;
      async issueCredential(): Promise<never> {
        this.asked += 1;
        throw new CivicCredentialError(
          'DOCUMENT_ALREADY_ENROLLED',
          'This document already has a pass, held by another device or browser',
        );
      }
    }

    it('ends the attempt and says why, instead of asking again', async () => {
      const gateway = new FakeRarimoGateway();
      const issuer = new RefusingIssuer();
      const { vault, pendingVault, page } = device({ gateway, issuer });
      const adapter = page();
      const enrollment = await adapter.beginEnrollment(request());
      const requestId = [...gateway.requests.keys()][0] as string;
      gateway.statuses.set(requestId, 'verified');

      await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toEqual({
        enrollmentId: enrollment.enrollmentId,
        status: 'failed',
        updatedAt: now.toISOString(),
        errorCode: 'DOCUMENT_ALREADY_ENROLLED',
      });
      // The verification is removed at the verifier and forgotten on the device.
      expect(gateway.deleted).toEqual([requestId]);
      expect(pendingVault.stored).toBeNull();
      expect(vault.stored).toBeNull();
      await expect(adapter.getCredentialSummary()).resolves.toBeNull();

      // Asked again, it gives the same answer and does not trouble the issuer.
      await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).resolves.toMatchObject({
        status: 'failed',
        errorCode: 'DOCUMENT_ALREADY_ENROLLED',
      });
      expect(issuer.asked).toBe(1);
    });

    it('still treats every other issuer failure as one to try again', async () => {
      const gateway = new FakeRarimoGateway();
      const issuer = new FakeCicoIssuer();
      issuer.fail = true;
      const { pendingVault, page } = device({ gateway, issuer });
      const adapter = page();
      const enrollment = await adapter.beginEnrollment(request());
      gateway.statuses.set([...gateway.requests.keys()][0] as string, 'verified');

      await expect(adapter.getEnrollmentStatus(enrollment.enrollmentId)).rejects.toMatchObject({
        code: 'ISSUANCE_FAILED',
        retryable: true,
      });
      expect(pendingVault.stored?.enrollmentId).toBe(enrollment.enrollmentId);
      expect(gateway.deleted).toEqual([]);
    });

    it('leaves the holder key in place: this device may hold another document', async () => {
      const gateway = new FakeRarimoGateway();
      const keys = new MemoryHolderKeyVault();
      const refused = device({ gateway, issuer: new RefusingIssuer() }, keys);
      const adapter = refused.page();
      const enrollment = await adapter.beginEnrollment(request());
      gateway.statuses.set([...gateway.requests.keys()][0] as string, 'verified');
      await adapter.getEnrollmentStatus(enrollment.enrollmentId);

      const kept = keys.stored;
      if (!kept) throw new Error('expected a kept holder key');
      expect(deriveHolderBinding(kept.holderSecret, kept.holderBlind)).toEqual(
        enrollment.holderBinding,
      );
    });
  });
});
