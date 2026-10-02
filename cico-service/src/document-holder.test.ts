import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CivicCredentialIssuanceRequest,
  deriveRarimoEventId,
  isoNumericCountry,
} from 'midnight-referendum-api';
import { describe, expect, it, vi } from 'vitest';
import { CredentialIssuerService, type DocumentHolderPolicy } from './credential-issuer-service.js';
import { type DocumentBindingStore, FileDocumentBindingStore } from './durable-stores.js';

const receipt = {
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
};

/** One verification: an enrolment, the evidence it was authorized by, and who holds it. */
function attempt(enrollmentId: string, holder: number): CivicCredentialIssuanceRequest {
  return {
    enrollmentId,
    provider: 'rarimo',
    evidenceAuthorization: `authorization-${enrollmentId}`,
    holderBinding: new Uint8Array(32).fill(holder),
    claims: {
      issuerId: 'cico-rarimo-preview',
      country: isoNumericCountry('756'),
      ageClass: '18-plus',
      assurance: 'document-nfc',
      credentialEpoch: 1,
      validFrom: '2026-10-02T06:00:00.000Z',
      validUntil: '2026-10-03T06:00:00.000Z',
    },
  };
}

class MemoryBindings implements DocumentBindingStore {
  readonly holders = new Map<string, string>();
  async bind(documentTag: string, holderBinding: string) {
    const existing = this.holders.get(documentTag);
    if (!existing) {
      this.holders.set(documentTag, holderBinding);
      return 'bound' as const;
    }
    return existing === holderBinding ? ('same' as const) : ('other' as const);
  }
}

/** The issuer, with `documents` saying which document each enrolment's proof showed. */
function issuerFor(
  documents: Record<string, string | null>,
  mode: DocumentHolderPolicy['mode'] = 'enforce',
) {
  const reported: string[] = [];
  const order: string[] = [];
  const executor = {
    deploy: vi.fn(),
    join: vi.fn(async () => undefined),
    addCredential: vi.fn(async () => {
      order.push('pass issued');
      return receipt;
    }),
    freeze: vi.fn(),
    attestRegistryRoot: vi.fn(),
  };
  const bindings = new MemoryBindings();
  const service = new CredentialIssuerService({
    executor,
    registryContractAddress: receipt.contractAddress,
    issuerSecret: new Uint8Array(32).fill(9),
    evidenceAuthorizations: {
      claim: vi.fn(async () => {
        order.push('evidence spent');
        return true;
      }),
    },
    validateEvidenceAuthorization: async () => true,
    documentHolders: {
      tagFor: (authorization) => documents[authorization.replace('authorization-', '')],
      bindings,
      mode,
      report: (outcome) => reported.push(outcome),
    },
  });
  return { service, executor, bindings, reported, order };
}

describe('one holder per document', () => {
  it('gives a document its first holder, and a pass', async () => {
    const { service, executor, reported } = issuerFor({ first: 'document-a' });
    await expect(service.issueCredential(attempt('first', 1))).resolves.toMatchObject({
      issuanceId: 'credential:credential-transaction-id',
    });
    expect(executor.addCredential).toHaveBeenCalledTimes(1);
    expect(reported).toEqual(['bound']);
  });

  it('refuses the same document on another device, before anything is spent', async () => {
    const { service, executor, reported, order } = issuerFor({
      first: 'document-a',
      second: 'document-a',
    });
    await service.issueCredential(attempt('first', 1));
    order.length = 0;

    await expect(service.issueCredential(attempt('second', 2))).rejects.toMatchObject({
      code: 'DOCUMENT_ALREADY_ENROLLED',
      retryable: false,
    });
    // No pass on chain, and the person's verification was not used up either.
    expect(order).toEqual([]);
    expect(executor.addCredential).toHaveBeenCalledTimes(1);
    expect(reported).toEqual(['bound', 'refused']);
  });

  it('renews a pass for the holder the document already has', async () => {
    const { service, executor, reported } = issuerFor({ first: 'document-a', later: 'document-a' });
    await service.issueCredential(attempt('first', 1));
    await expect(service.issueCredential(attempt('later', 1))).resolves.toBeTruthy();
    // A second leaf for the same holder: it still answers each consultation once.
    expect(executor.addCredential).toHaveBeenCalledTimes(2);
    expect(reported).toEqual(['bound', 'renewed']);
  });

  it('keeps two documents apart, each with its own holder', async () => {
    const { service, executor, bindings } = issuerFor({ one: 'document-a', two: 'document-b' });
    await service.issueCredential(attempt('one', 1));
    await service.issueCredential(attempt('two', 2));
    expect(executor.addCredential).toHaveBeenCalledTimes(2);
    expect(bindings.holders.size).toBe(2);
  });

  it('refuses a proof made without its nullifier: it would be the way around', async () => {
    const { service, executor, reported, order } = issuerFor({ hidden: null });
    await expect(service.issueCredential(attempt('hidden', 1))).rejects.toMatchObject({
      code: 'INVALID_CREDENTIAL_CLAIMS',
    });
    expect(order).toEqual([]);
    expect(executor.addCredential).not.toHaveBeenCalled();
    expect(reported).toEqual(['no-nullifier']);
  });

  it('in observe mode records and reports, and refuses nothing', async () => {
    const { service, executor, reported, bindings } = issuerFor(
      { first: 'document-a', second: 'document-a', hidden: null },
      'observe',
    );
    await service.issueCredential(attempt('first', 1));
    await service.issueCredential(attempt('second', 2));
    await service.issueCredential(attempt('hidden', 3));
    expect(executor.addCredential).toHaveBeenCalledTimes(3);
    expect(reported).toEqual(['bound', 'would-refuse', 'no-nullifier']);
    // The first holder stays the document's holder.
    expect([...bindings.holders.values()]).toEqual(['01'.repeat(32)]);
  });

  it('answers a retry of the same enrolment with the pass it issued, without asking again', async () => {
    const { service, executor, reported } = issuerFor({ first: 'document-a' });
    const first = await service.issueCredential(attempt('first', 1));
    const again = await service.issueCredential(attempt('first', 1));
    expect(again.issuanceId).toBe(first.issuanceId);
    expect(executor.addCredential).toHaveBeenCalledTimes(1);
    expect(reported).toEqual(['bound']);
  });
});

describe('the durable record of who holds a document', () => {
  it('survives a restart and holds nothing but digests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cico-documents-'));
    const file = join(directory, 'document-bindings.json');
    try {
      const store = new FileDocumentBindingStore(file);
      await expect(store.bind('document-tag-a', 'holder-one')).resolves.toBe('bound');
      await expect(store.bind('document-tag-a', 'holder-one')).resolves.toBe('same');

      const restarted = new FileDocumentBindingStore(file);
      await expect(restarted.bind('document-tag-a', 'holder-two')).resolves.toBe('other');
      await expect(restarted.bind('document-tag-a', 'holder-one')).resolves.toBe('same');
      await expect(restarted.bind('document-tag-b', 'holder-two')).resolves.toBe('bound');

      const written = await readFile(file, 'utf8');
      expect(written).not.toContain('document-tag-a');
      expect(written).not.toContain('holder-one');
      const state = JSON.parse(written) as { documents: Record<string, string> };
      expect(Object.keys(state.documents)).toHaveLength(2);
      for (const [document, holder] of Object.entries(state.documents)) {
        expect(document).toMatch(/^[a-f0-9]{64}$/u);
        expect(holder).toMatch(/^[a-f0-9]{64}$/u);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('settles two devices racing for one document: one holder, whichever came first', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cico-documents-'));
    try {
      const store = new FileDocumentBindingStore(join(directory, 'document-bindings.json'));
      const outcomes = await Promise.all([
        store.bind('document-tag-a', 'holder-one'),
        store.bind('document-tag-a', 'holder-two'),
      ]);
      expect(outcomes.sort()).toEqual(['bound', 'other']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('the event every verification is made under', () => {
  const registry = '9f8fe7c54d9907543cbcde82943c2be35ccb20f404e477ca2c29b8fc84a52132';

  it('follows from the registry and its epoch alone', () => {
    const event = deriveRarimoEventId(registry, 1);
    expect(event).toMatch(/^[1-9][0-9]*$/u);
    expect(deriveRarimoEventId(registry.toUpperCase(), 1n)).toBe(event);
    // A BN254 scalar: under 2^248.
    expect(BigInt(event) < 1n << 248n).toBe(true);
  });

  it('differs for another registry and for another epoch, so every document starts afresh', () => {
    const event = deriveRarimoEventId(registry, 1);
    expect(deriveRarimoEventId(registry, 2)).not.toBe(event);
    expect(deriveRarimoEventId('bb'.repeat(32), 1)).not.toBe(event);
    expect(() => deriveRarimoEventId('not-an-address', 1)).toThrow('32-byte hexadecimal');
  });
});
