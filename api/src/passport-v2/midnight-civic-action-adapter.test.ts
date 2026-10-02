import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  deriveCredentialLeaf,
  deriveHolderBinding,
  deriveRegistryContractBinding,
} from './crypto.js';
import {
  buildReferendumV2VoterPrivateState,
  MidnightCivicActionAdapter,
  type ReferendumV2CatalogEntry,
} from './midnight-civic-action-adapter.js';
import type { ReferendumV2Executor, ReferendumV2Providers } from './midnight-v2-executors.js';
import type {
  CivicCredentialPort,
  CivicCredentialPrivateMaterial,
  CivicCredentialPrivateStatePort,
} from './ports.js';
import { CivicCredentialError, isoNumericCountry } from './types.js';

const path = { __testPath: true } as unknown as MerkleTreePath<Uint8Array>;
const claims = {
  issuerId: 'cico-rarimo-preview',
  country: isoNumericCountry('032'),
  ageClass: '18-plus' as const,
  assurance: 'document-nfc' as const,
  credentialEpoch: 7,
  validFrom: '2026-08-24T12:00:00.000Z',
  validUntil: '2026-08-25T12:00:00.000Z',
};
const voterSecret = new Uint8Array(32).fill(1);
const holderBlind = new Uint8Array(32).fill(2);
const holderBinding = deriveHolderBinding(voterSecret, holderBlind);
const credentialBlind = new Uint8Array(32).fill(3);
const material: CivicCredentialPrivateMaterial = {
  voterSecret,
  holderBlind,
  holderBinding,
  credentialBlind,
  credentialLeaf: deriveCredentialLeaf({ holderBinding, credentialBlind, claims }),
  claims,
};

const entry: ReferendumV2CatalogEntry = {
  referendumId: 'global:land-policy',
  contractAddress: '11'.repeat(32),
  config: {
    registry: {
      registryContractAddress: '22'.repeat(32),
      registryContractBinding: deriveRegistryContractBinding('22'.repeat(32)),
      registryId: new Uint8Array(32).fill(4),
      issuerId: new Uint8Array(32).fill(5),
      credentialEpoch: 7n,
      frozenRoot: { field: 9n },
    },
    eventId: new Uint8Array(32).fill(6),
    organizerKey: new Uint8Array(32).fill(7),
    countryPolicy: new Uint8Array(32),
    countryPolicyEnabled: false,
    minimumAssurance: 2n,
    requireAdult: true,
    validityReference: 1_777_000_000n,
    rootPublisherKey: new Uint8Array(32).fill(8),
    opensAtUnix: 1_777_000_000n,
    enrollmentClosesAtUnix: 1_777_086_400n,
    closesAtUnix: 1_777_172_800n,
    revealClosesAtUnix: 1_777_259_200n,
    network: 'preview',
  },
};

const voteReceipt = {
  status: 'confirmed' as const,
  action: 'vote' as const,
  network: 'preview' as const,
  transactionId: 'vote-transaction-id',
  transactionHash: 'vote-transaction-hash',
  contractAddress: entry.contractAddress,
  circuit: 'castVote',
  blockHeight: 42,
  blockHash: 'vote-block-hash',
  blockTimestamp: '2026-08-24T12:05:00.000Z',
};

class FakeCredential implements CivicCredentialPort, CivicCredentialPrivateStatePort {
  readonly adapterName = 'fake-browser-credential';
  async beginEnrollment(): Promise<never> {
    throw new Error('not used');
  }
  async getEnrollmentStatus(): Promise<never> {
    throw new Error('not used');
  }
  async getCredentialSummary() {
    return { provider: 'rarimo' as const, status: 'issued' as const, ...claims };
  }
  async getActionAuthorization() {
    return { kind: 'civic-credential' as const, handle: 'issuance-handle' };
  }
  async getPrivateCredentialMaterial() {
    return material;
  }
  async clearCredential(): Promise<void> {}
}

function makeExecutor(joined: ReferendumV2PrivateStateCapture): ReferendumV2Executor {
  return {
    async deploy() {
      throw new Error('not used');
    },
    async join(address, privateState) {
      joined.address = address;
      joined.privateState = privateState;
    },
    async castVote() {
      return voteReceipt;
    },
    async closeVote() {
      throw new Error('not used');
    },
    async revealVote() {
      throw new Error('not used');
    },
    async finalizeVote() {
      throw new Error('not used');
    },
    async publishCredentialRoot() {
      throw new Error('not used');
    },
    async revokeCredentialRoot() {
      throw new Error('not used');
    },
    async closeEnrollment() {
      throw new Error('not used');
    },
  };
}

interface ReferendumV2PrivateStateCapture {
  address?: string;
  privateState?: Parameters<ReferendumV2Executor['join']>[1];
}

describe('Midnight browser civic action adapter', () => {
  it('encodes credential claims and ballot choice only in local private state', () => {
    const state = buildReferendumV2VoterPrivateState(
      material,
      path,
      'YES',
      new Uint8Array(32).fill(8),
    );
    expect(state).toMatchObject({
      role: 'voter',
      credentialAgeClass: 2n,
      credentialAssurance: 2n,
      credentialClaimEpoch: 7n,
      credentialValidUntil: 1_787_659_200n,
      voterPath: path,
      voterChoice: 'YES',
    });
    expect(new TextDecoder().decode(state.credentialCountry).replace(/\0+$/u, '')).toBe('032');
    material.voterSecret[0] = 99;
    expect(state.voterSecret?.[0]).toBe(1);
    material.voterSecret[0] = 1;
  });

  it('binds canonical state, joins with browser witnesses, and returns a public receipt', async () => {
    const joined: ReferendumV2PrivateStateCapture = {};
    const assertCanonicalBinding = vi.fn().mockResolvedValue(undefined);
    const resolveCredentialPath = vi.fn().mockResolvedValue(path);
    const adapter = new MidnightCivicActionAdapter({
      providers: {} as ReferendumV2Providers,
      credential: new FakeCredential(),
      referenda: [entry],
      randomBytes: () => new Uint8Array(32).fill(8),
      stateResolver: { assertCanonicalBinding, resolveCredentialPath },
      executorFactory: () => makeExecutor(joined),
    });

    const receipt = await adapter.castVote({
      referendumId: entry.referendumId,
      choice: 'NO',
      authorization: { kind: 'civic-credential', handle: 'issuance-handle' },
    });
    expect(assertCanonicalBinding).toHaveBeenCalledWith(entry);
    expect(resolveCredentialPath).toHaveBeenCalledWith(entry, material.credentialLeaf);
    expect(joined).toMatchObject({
      address: entry.contractAddress,
      privateState: { role: 'voter', voterChoice: 'NO', voterPath: path },
    });
    expect(receipt).toEqual(voteReceipt);
    expect(JSON.stringify(receipt)).not.toMatch(/choice|secret|blind|path|salt/i);
    await expect(adapter.getCanonicalReceipt(receipt.transactionId)).resolves.toEqual(receipt);
  });

  it('rejects stale authorization, unknown referenda, and public cohort disclosure', async () => {
    const adapter = new MidnightCivicActionAdapter({
      providers: {} as ReferendumV2Providers,
      credential: new FakeCredential(),
      referenda: [entry],
      stateResolver: {
        async assertCanonicalBinding() {},
        async resolveCredentialPath() {
          return path;
        },
      },
      executorFactory: () => makeExecutor({}),
    });
    await expect(
      adapter.castVote({
        referendumId: entry.referendumId,
        choice: 'YES',
        authorization: { kind: 'civic-credential', handle: 'stale-handle' },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(
      adapter.castVote({
        referendumId: 'unknown',
        choice: 'YES',
        authorization: { kind: 'civic-credential', handle: 'issuance-handle' },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_NOT_SATISFIED' });
    await expect(
      adapter.recordPublicCohort({
        referendumId: entry.referendumId,
        country: isoNumericCountry('032'),
        authorization: { kind: 'civic-credential', handle: 'issuance-handle' },
        explicitPublicOptIn: true,
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });

  it('serializes delayed votes across adapters sharing one private-state provider', async () => {
    const secondEntry: ReferendumV2CatalogEntry = {
      ...entry,
      referendumId: 'global:second-policy',
      contractAddress: 'referendum-v2-address-b',
      config: {
        ...entry.config,
        eventId: new Uint8Array(32).fill(10),
      },
    };
    const joined: string[] = [];
    let activeContract = '';
    let signalFirstJoin!: () => void;
    let releaseFirstJoin!: () => void;
    const firstJoinEntered = new Promise<void>((resolve) => {
      signalFirstJoin = resolve;
    });
    const firstJoinRelease = new Promise<void>((resolve) => {
      releaseFirstJoin = resolve;
    });
    const providers = {
      privateStateProvider: {},
    } as ReferendumV2Providers;
    const receiptFor = (contractAddress: string) => ({
      ...voteReceipt,
      contractAddress,
      transactionId: `vote-${contractAddress}`,
    });
    const executorFactory = (): ReferendumV2Executor => ({
      async deploy() {
        throw new Error('not used');
      },
      async join(address) {
        joined.push(address);
        activeContract = address;
        if (address === entry.contractAddress) {
          signalFirstJoin();
          await firstJoinRelease;
        }
      },
      async castVote() {
        return receiptFor(activeContract);
      },
      async closeVote() {
        throw new Error('not used');
      },
      async revealVote() {
        throw new Error('not used');
      },
      async finalizeVote() {
        throw new Error('not used');
      },
      async publishCredentialRoot() {
        throw new Error('not used');
      },
      async revokeCredentialRoot() {
        throw new Error('not used');
      },
      async closeEnrollment() {
        throw new Error('not used');
      },
    });
    const stateResolver = {
      async assertCanonicalBinding() {},
      async resolveCredentialPath() {
        return path;
      },
    };
    const firstAdapter = new MidnightCivicActionAdapter({
      providers,
      credential: new FakeCredential(),
      referenda: [entry],
      randomBytes: () => new Uint8Array(32).fill(8),
      stateResolver,
      executorFactory,
    });
    const secondAdapter = new MidnightCivicActionAdapter({
      providers,
      credential: new FakeCredential(),
      referenda: [secondEntry],
      randomBytes: () => new Uint8Array(32).fill(8),
      stateResolver,
      executorFactory,
    });

    const firstVote = firstAdapter.castVote({
      referendumId: entry.referendumId,
      choice: 'YES',
      authorization: { kind: 'civic-credential', handle: 'issuance-handle' },
    });
    await firstJoinEntered;
    const secondVote = secondAdapter.castVote({
      referendumId: secondEntry.referendumId,
      choice: 'NO',
      authorization: { kind: 'civic-credential', handle: 'issuance-handle' },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const joinedBeforeRelease = [...joined];
    releaseFirstJoin();
    const outcomes = await Promise.allSettled([firstVote, secondVote]);

    expect(joinedBeforeRelease).toEqual([entry.contractAddress]);
    expect(outcomes[0]).toMatchObject({
      status: 'fulfilled',
      value: { contractAddress: entry.contractAddress },
    });
    expect(outcomes[1]).toMatchObject({
      status: 'fulfilled',
      value: { contractAddress: secondEntry.contractAddress },
    });
    expect(joined).toEqual([entry.contractAddress, secondEntry.contractAddress]);
  });
});

describe('asking whether a pass can answer, before any proof', () => {
  const adapterWith = (
    resolveCredentialPath: () => Promise<MerkleTreePath<Uint8Array>>,
    credential: CivicCredentialPort & CivicCredentialPrivateStatePort = new FakeCredential(),
  ) =>
    new MidnightCivicActionAdapter({
      providers: {} as ReferendumV2Providers,
      credential,
      referenda: [entry],
      stateResolver: { assertCanonicalBinding: async () => undefined, resolveCredentialPath },
      executorFactory: () => makeExecutor({}),
    });

  it('says admitted when a path against an admitted root exists', async () => {
    const resolveCredentialPath = vi.fn(async () => path);
    await expect(
      adapterWith(resolveCredentialPath).getPassAdmission(entry.referendumId),
    ).resolves.toBe('admitted');
    expect(resolveCredentialPath).toHaveBeenCalledWith(entry, material.credentialLeaf);
  });

  it('tells a pass that will be admitted from one that came too late', async () => {
    const refusing = (code: 'CREDENTIAL_NOT_ADMITTED' | 'CREDENTIAL_ADMISSION_CLOSED') =>
      adapterWith(async () => {
        throw new CivicCredentialError(code, 'refused');
      }).getPassAdmission(entry.referendumId);
    await expect(refusing('CREDENTIAL_NOT_ADMITTED')).resolves.toBe('pending');
    await expect(refusing('CREDENTIAL_ADMISSION_CLOSED')).resolves.toBe('closed');
  });

  it('says so when the device holds no pass, without reading the chain', async () => {
    const resolveCredentialPath = vi.fn(async () => path);
    const noPass = new FakeCredential();
    noPass.getPrivateCredentialMaterial = async () => null as unknown as typeof material;
    await expect(
      adapterWith(resolveCredentialPath, noPass).getPassAdmission(entry.referendumId),
    ).resolves.toBe('no-pass');
    expect(resolveCredentialPath).not.toHaveBeenCalled();
  });

  it('does not turn a failed read into an answer', async () => {
    await expect(
      adapterWith(async () => {
        throw new Error('indexer unavailable');
      }).getPassAdmission(entry.referendumId),
    ).rejects.toThrow('indexer unavailable');
    await expect(adapterWith(async () => path).getPassAdmission('unknown')).rejects.toMatchObject({
      code: 'POLICY_NOT_SATISFIED',
    });
  });
});
