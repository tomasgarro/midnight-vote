import type {
  CanonicalReceipt,
  CredentialRegistryV1Executor,
  CredentialRegistryV1State,
  ReferendumV2Executor,
  ReferendumV2State,
} from 'midnight-referendum-api';
import { describe, expect, it, vi } from 'vitest';
import {
  CredentialRootPublisher,
  type CredentialRootPublisherReader,
  type CredentialRootPublisherReferendumTarget,
} from './credential-root-publisher.js';

const registryAddress = 'aa'.repeat(32);
const referendumAddressA = 'bb'.repeat(32);
const referendumAddressB = 'cc'.repeat(32);

function attestReceipt(transactionId = 'attest-tx'): CanonicalReceipt {
  return {
    status: 'confirmed',
    action: 'credential',
    network: 'preview',
    transactionId,
    transactionHash: `${transactionId}-hash`,
    contractAddress: registryAddress,
    circuit: 'attestCurrentRoot',
    blockHeight: 1,
    blockHash: 'attest-block',
    blockTimestamp: '2026-08-24T12:00:00.000Z',
  };
}

function publishReceipt(contractAddress: string, transactionId: string): CanonicalReceipt {
  return {
    status: 'confirmed',
    action: 'vote',
    network: 'preview',
    transactionId,
    transactionHash: `${transactionId}-hash`,
    contractAddress,
    circuit: 'publishCredentialRoot',
    blockHeight: 2,
    blockHash: 'publish-block',
    blockTimestamp: '2026-08-24T12:00:00.000Z',
  };
}

function registryState(
  overrides: Partial<CredentialRegistryV1State> = {},
): CredentialRegistryV1State {
  return {
    registryId: new Uint8Array(32).fill(1),
    issuerId: new Uint8Array(32).fill(2),
    credentialEpoch: 7n,
    currentRoot: { field: 100n },
    frozenRoot: { field: 0n },
    frozen: false,
    credentialCount: 0n,
    ...overrides,
  };
}

function referendumState(overrides: Partial<ReferendumV2State> = {}): ReferendumV2State {
  return {
    registryId: new Uint8Array(32).fill(1),
    issuerId: new Uint8Array(32).fill(2),
    credentialEpoch: 7n,
    initialCredentialRoot: { field: 0n },
    acceptedCredentialRoots: [],
    revokedCredentialRoots: [],
    enrollmentClosed: false,
    registryContractBinding: new Uint8Array(32),
    registryContract: new Uint8Array(32),
    eventId: new Uint8Array(32),
    organizerKey: new Uint8Array(32),
    rootPublisherKey: new Uint8Array(32),
    opensAtUnix: 0n,
    enrollmentClosesAtUnix: 999_999_999_999n,
    closesAtUnix: 999_999_999_999n,
    revealClosesAtUnix: 999_999_999_999n,
    phase: 'COMMIT',
    closed: false,
    issuedVotes: 0n,
    countryPolicy: new Uint8Array(32),
    countryPolicyEnabled: false,
    minimumAssurance: 0n,
    requireAdult: false,
    validityReference: 0n,
    tally: new Map(),
    ...overrides,
  };
}

function makeRegistryExecutor(options?: {
  onAttest?: (field: bigint) => void;
  attestFails?: boolean;
}): CredentialRegistryV1Executor & { attestRegistryRoot: ReturnType<typeof vi.fn> } {
  return {
    deploy: vi.fn(),
    join: vi.fn(async () => undefined),
    addCredential: vi.fn(),
    freeze: vi.fn(),
    attestRegistryRoot: vi.fn(async (root: { field: bigint }) => {
      if (options?.attestFails) throw new Error('registry attestation rejected');
      options?.onAttest?.(root.field);
      return attestReceipt();
    }),
  };
}

function makeReferendumExecutor(
  contractAddress: string,
): ReferendumV2Executor & { publishCredentialRoot: ReturnType<typeof vi.fn> } {
  let counter = 0;
  return {
    deploy: vi.fn(),
    join: vi.fn(async () => undefined),
    castVote: vi.fn(),
    publishCredentialRoot: vi.fn(async () => {
      counter += 1;
      return publishReceipt(contractAddress, `${contractAddress}-publish-${counter}`);
    }),
    revokeCredentialRoot: vi.fn(),
    closeEnrollment: vi.fn(),
    closeVote: vi.fn(),
    revealVote: vi.fn(),
    finalizeVote: vi.fn(),
  };
}

function makeReader(
  registry: () => CredentialRegistryV1State,
  referenda: Record<string, () => ReferendumV2State> = {},
): CredentialRootPublisherReader {
  return {
    readRegistry: vi.fn(async () => registry()),
    readReferendum: vi.fn(async (address: string) => {
      const factory = referenda[address];
      if (!factory) throw new Error(`no referendum state configured for ${address}`);
      return factory();
    }),
  };
}

function target(
  contractAddress: string,
  executor: ReferendumV2Executor,
): CredentialRootPublisherReferendumTarget {
  return {
    contractAddress,
    executor,
    rootPublisherSecret: new Uint8Array(32).fill(4),
  };
}

describe('CredentialRootPublisher', () => {
  it('publishes nothing when the registry root is unchanged', async () => {
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 100n }, credentialCount: 20n }),
    );
    const registryExecutor = makeRegistryExecutor();
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
    });

    const first = await publisher.publishOnce();
    expect(first.published).toBe(true);

    const second = await publisher.publishOnce();
    expect(second).toEqual({ published: false, reason: 'unchanged' });
    expect(registryExecutor.attestRegistryRoot).toHaveBeenCalledTimes(1);
    expect(referendumExecutor.publishCredentialRoot).toHaveBeenCalledTimes(1);
  });

  it('publishes once the batch reaches minBatchSize', async () => {
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 200n }, credentialCount: 16n }),
    );
    const registryExecutor = makeRegistryExecutor();
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
      minBatchSize: 16,
    });

    const result = await publisher.publishOnce();
    expect(result).toMatchObject({ published: true, batchSize: 16, belowMinimum: false });
  });

  it('does not publish an under-sized batch before maxWaitMs elapses', async () => {
    let now = 0;
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 300n }, credentialCount: 3n }),
    );
    const registryExecutor = makeRegistryExecutor();
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
      minBatchSize: 16,
      maxWaitMs: 900_000,
      now: () => now,
    });

    const first = await publisher.publishOnce();
    expect(first).toEqual({ published: false, reason: 'below-minimum-batch', batchSize: 3 });

    now += 100_000;
    const second = await publisher.publishOnce();
    expect(second).toEqual({ published: false, reason: 'below-minimum-batch', batchSize: 3 });
    expect(registryExecutor.attestRegistryRoot).not.toHaveBeenCalled();
    expect(referendumExecutor.publishCredentialRoot).not.toHaveBeenCalled();
  });

  it('publishes an under-sized batch after maxWaitMs and flags belowMinimum', async () => {
    let now = 0;
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 400n }, credentialCount: 3n }),
    );
    const registryExecutor = makeRegistryExecutor();
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
      minBatchSize: 16,
      maxWaitMs: 900_000,
      now: () => now,
    });

    const first = await publisher.publishOnce();
    expect(first.published).toBe(false);

    now += 900_001;
    const second = await publisher.publishOnce();
    expect(second).toMatchObject({ published: true, batchSize: 3, belowMinimum: true });
  });

  it('attests before publishing and records both transaction ids', async () => {
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 500n }, credentialCount: 16n }),
    );
    const callOrder: string[] = [];
    const registryExecutor = makeRegistryExecutor({
      onAttest: () => callOrder.push('attest'),
    });
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    referendumExecutor.publishCredentialRoot.mockImplementation(async () => {
      callOrder.push('publish');
      return publishReceipt(referendumAddressA, 'publish-tx');
    });
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
      minBatchSize: 16,
    });

    const result = await publisher.publishOnce();
    expect(callOrder).toEqual(['attest', 'publish']);
    expect(result).toMatchObject({
      published: true,
      attestationTransactionId: 'attest-tx',
      referenda: [
        { contractAddress: referendumAddressA, status: 'published', transactionId: 'publish-tx' },
      ],
    });
  });

  it('does not publish when the attestation fails', async () => {
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 600n }, credentialCount: 16n }),
    );
    const registryExecutor = makeRegistryExecutor({ attestFails: true });
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
      minBatchSize: 16,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

    const result = await publisher.publishOnce();
    expect(result).toEqual({ published: false, reason: 'attestation-failed' });
    expect(referendumExecutor.publishCredentialRoot).not.toHaveBeenCalled();
  });

  it('publishes to every configured referendum', async () => {
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 700n }, credentialCount: 16n }),
    );
    const registryExecutor = makeRegistryExecutor();
    const referendumExecutorA = makeReferendumExecutor(referendumAddressA);
    const referendumExecutorB = makeReferendumExecutor(referendumAddressB);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [
        target(referendumAddressA, referendumExecutorA),
        target(referendumAddressB, referendumExecutorB),
      ],
      minBatchSize: 16,
    });

    const result = await publisher.publishOnce();
    expect(referendumExecutorA.publishCredentialRoot).toHaveBeenCalledTimes(1);
    expect(referendumExecutorB.publishCredentialRoot).toHaveBeenCalledTimes(1);
    expect(result.published).toBe(true);
    if (result.published) {
      expect(result.referenda).toHaveLength(2);
      expect(result.referenda.map((entry) => entry.contractAddress).sort()).toEqual(
        [referendumAddressA, referendumAddressB].sort(),
      );
    }
  });

  it('does not let a failing cycle stop later cycles', async () => {
    let call = 0;
    const reader: CredentialRootPublisherReader = {
      readRegistry: vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('indexer unavailable');
        return registryState({ currentRoot: { field: 800n }, credentialCount: 16n });
      }),
      readReferendum: vi.fn(async () => referendumState()),
    };
    const registryExecutor = makeRegistryExecutor();
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
      minBatchSize: 16,
    });

    await expect(publisher.publishOnce()).rejects.toThrow('indexer unavailable');
    const second = await publisher.publishOnce();
    expect(second).toMatchObject({ published: true, batchSize: 16 });
  });

  it('is a no-op when no referenda are configured, so the deployment behaves as today', async () => {
    const reader = makeReader(() =>
      registryState({ currentRoot: { field: 900n }, credentialCount: 100n }),
    );
    const registryExecutor = makeRegistryExecutor();
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [],
    });

    const result = await publisher.publishOnce();
    expect(result).toEqual({ published: false, reason: 'no-referenda-configured' });
    expect(registryExecutor.attestRegistryRoot).not.toHaveBeenCalled();
  });

  it('publishes an under-sized batch when a referendum enrollment deadline is imminent', async () => {
    const now = 0;
    const reader = makeReader(
      () => registryState({ currentRoot: { field: 1_000n }, credentialCount: 2n }),
      { [referendumAddressA]: () => referendumState({ enrollmentClosesAtUnix: 500n }) },
    );
    const registryExecutor = makeRegistryExecutor();
    const referendumExecutor = makeReferendumExecutor(referendumAddressA);
    const publisher = new CredentialRootPublisher({
      registryExecutor,
      registryContractAddress: registryAddress,
      reader,
      referenda: [target(referendumAddressA, referendumExecutor)],
      minBatchSize: 16,
      maxWaitMs: 900_000,
      now: () => now,
    });

    const result = await publisher.publishOnce();
    expect(result).toMatchObject({ published: true, batchSize: 2, belowMinimum: true });
  });

  describe('what each consultation is still owed', () => {
    const root = 1_100n;
    const registry = () => registryState({ currentRoot: { field: root }, credentialCount: 16n });
    const admits = (...fields: bigint[]) =>
      referendumState({ acceptedCredentialRoots: fields.map((field) => ({ field })) });
    const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

    it('sends nothing after a restart when every consultation already holds the root', async () => {
      const registryExecutor = makeRegistryExecutor();
      const referendumExecutor = makeReferendumExecutor(referendumAddressA);
      const publisher = new CredentialRootPublisher({
        registryExecutor,
        registryContractAddress: registryAddress,
        reader: makeReader(registry, { [referendumAddressA]: () => admits(root) }),
        referenda: [target(referendumAddressA, referendumExecutor)],
        minBatchSize: 1,
      });

      await expect(publisher.publishOnce()).resolves.toEqual({
        published: false,
        reason: 'nothing-to-admit',
        referenda: [{ contractAddress: referendumAddressA, status: 'already-admitted' }],
      });
      await expect(publisher.publishOnce()).resolves.toEqual({
        published: false,
        reason: 'unchanged',
      });
      // No attestation either: a restart must not cost a transaction.
      expect(registryExecutor.attestRegistryRoot).not.toHaveBeenCalled();
      expect(referendumExecutor.publishCredentialRoot).not.toHaveBeenCalled();
    });

    it('publishes only to the consultations that still lack the root', async () => {
      const executorA = makeReferendumExecutor(referendumAddressA);
      const executorB = makeReferendumExecutor(referendumAddressB);
      const publisher = new CredentialRootPublisher({
        registryExecutor: makeRegistryExecutor(),
        registryContractAddress: registryAddress,
        reader: makeReader(registry, {
          [referendumAddressA]: () => admits(root),
          [referendumAddressB]: () => admits(900n),
        }),
        referenda: [target(referendumAddressA, executorA), target(referendumAddressB, executorB)],
        minBatchSize: 1,
      });

      const result = await publisher.publishOnce();
      expect(result).toMatchObject({
        published: true,
        referenda: [
          { contractAddress: referendumAddressA, status: 'already-admitted' },
          { contractAddress: referendumAddressB, status: 'published' },
        ],
      });
      expect(executorA.publishCredentialRoot).not.toHaveBeenCalled();
      expect(executorB.publishCredentialRoot).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['its enrolment was closed', referendumState({ enrollmentClosed: true })],
      ['its enrolment deadline has passed', referendumState({ enrollmentClosesAtUnix: 1_000n })],
      ['its answers are over', referendumState({ phase: 'REVEAL', closed: true })],
      ['it revoked this root', referendumState({ revokedCredentialRoots: [{ field: root }] })],
    ])('offers nothing to a consultation when %s', async (_why, state) => {
      const registryExecutor = makeRegistryExecutor();
      const referendumExecutor = makeReferendumExecutor(referendumAddressA);
      const publisher = new CredentialRootPublisher({
        registryExecutor,
        registryContractAddress: registryAddress,
        reader: makeReader(registry, { [referendumAddressA]: () => state }),
        referenda: [target(referendumAddressA, referendumExecutor)],
        minBatchSize: 1,
        now: () => 2_000_000,
      });

      await expect(publisher.publishOnce()).resolves.toEqual({
        published: false,
        reason: 'nothing-to-admit',
        referenda: [{ contractAddress: referendumAddressA, status: 'enrollment-closed' }],
      });
      expect(registryExecutor.attestRegistryRoot).not.toHaveBeenCalled();
      expect(referendumExecutor.publishCredentialRoot).not.toHaveBeenCalled();
    });

    it('offers the root to a consultation it cannot read, as before', async () => {
      const referendumExecutor = makeReferendumExecutor(referendumAddressA);
      const publisher = new CredentialRootPublisher({
        registryExecutor: makeRegistryExecutor(),
        registryContractAddress: registryAddress,
        // No state configured: the read throws.
        reader: makeReader(registry),
        referenda: [target(referendumAddressA, referendumExecutor)],
        minBatchSize: 1,
        logger: quiet,
      });

      await expect(publisher.publishOnce()).resolves.toMatchObject({ published: true });
      expect(referendumExecutor.publishCredentialRoot).toHaveBeenCalledTimes(1);
    });

    it('offers a failed consultation the same root again, without a second attestation', async () => {
      const registryExecutor = makeRegistryExecutor();
      const executorA = makeReferendumExecutor(referendumAddressA);
      const executorB = makeReferendumExecutor(referendumAddressB);
      executorB.publishCredentialRoot.mockRejectedValueOnce(new Error('submission error 170'));
      // The indexer has not caught up: A still reads as lacking the root.
      const publisher = new CredentialRootPublisher({
        registryExecutor,
        registryContractAddress: registryAddress,
        reader: makeReader(registry, {
          [referendumAddressA]: () => admits(900n),
          [referendumAddressB]: () => admits(900n),
        }),
        referenda: [target(referendumAddressA, executorA), target(referendumAddressB, executorB)],
        minBatchSize: 1,
        logger: quiet,
      });

      const first = await publisher.publishOnce();
      expect(first).toMatchObject({
        published: true,
        referenda: [
          { contractAddress: referendumAddressA, status: 'published' },
          { contractAddress: referendumAddressB, status: 'failed', error: 'submission error 170' },
        ],
      });
      // The batch is still pending: someone is waiting on consultation B.
      expect(publisher.getStatus().pendingSinceMs).not.toBeNull();

      const second = await publisher.publishOnce();
      expect(second).toMatchObject({
        published: true,
        attestationTransactionId: 'attest-tx',
        referenda: [
          { contractAddress: referendumAddressA, status: 'already-admitted' },
          { contractAddress: referendumAddressB, status: 'published' },
        ],
      });
      expect(registryExecutor.attestRegistryRoot).toHaveBeenCalledTimes(1);
      expect(executorA.publishCredentialRoot).toHaveBeenCalledTimes(1);
      expect(executorB.publishCredentialRoot).toHaveBeenCalledTimes(2);
      expect(publisher.getStatus().pendingSinceMs).toBeNull();
      await expect(publisher.publishOnce()).resolves.toEqual({
        published: false,
        reason: 'unchanged',
      });
    });

    it('stops offering one root after five failures, and tries again with the next root', async () => {
      let currentRoot = root;
      let count = 16n;
      const registryExecutor = makeRegistryExecutor();
      const referendumExecutor = makeReferendumExecutor(referendumAddressA);
      referendumExecutor.publishCredentialRoot.mockRejectedValue(new Error('not the publisher'));
      const publisher = new CredentialRootPublisher({
        registryExecutor,
        registryContractAddress: registryAddress,
        reader: makeReader(
          () => registryState({ currentRoot: { field: currentRoot }, credentialCount: count }),
          { [referendumAddressA]: () => admits(900n) },
        ),
        referenda: [target(referendumAddressA, referendumExecutor)],
        minBatchSize: 1,
        logger: quiet,
      });

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await expect(publisher.publishOnce()).resolves.toMatchObject({
          published: false,
          reason: 'publish-failed',
          referenda: [{ contractAddress: referendumAddressA, status: 'failed' }],
        });
      }
      await expect(publisher.publishOnce()).resolves.toMatchObject({
        published: false,
        reason: 'publish-failed',
        referenda: [{ contractAddress: referendumAddressA, status: 'gave-up' }],
      });
      await expect(publisher.publishOnce()).resolves.toEqual({
        published: false,
        reason: 'unchanged',
      });
      expect(referendumExecutor.publishCredentialRoot).toHaveBeenCalledTimes(5);
      expect(registryExecutor.attestRegistryRoot).toHaveBeenCalledTimes(1);

      // Another pass: a new root, a new attestation, and the consultation is asked again.
      currentRoot = 1_200n;
      count = 17n;
      referendumExecutor.publishCredentialRoot.mockResolvedValueOnce(
        publishReceipt(referendumAddressA, 'later-publish'),
      );
      await expect(publisher.publishOnce()).resolves.toMatchObject({
        published: true,
        rootField: '1200',
        batchSize: 1,
        referenda: [{ contractAddress: referendumAddressA, status: 'published' }],
      });
      expect(registryExecutor.attestRegistryRoot).toHaveBeenCalledTimes(2);
    });

    it('retries a failed attestation in the next cycle', async () => {
      const registryExecutor = makeRegistryExecutor();
      registryExecutor.attestRegistryRoot.mockRejectedValueOnce(new Error('no DUST'));
      const referendumExecutor = makeReferendumExecutor(referendumAddressA);
      const publisher = new CredentialRootPublisher({
        registryExecutor,
        registryContractAddress: registryAddress,
        reader: makeReader(registry, { [referendumAddressA]: () => admits(900n) }),
        referenda: [target(referendumAddressA, referendumExecutor)],
        minBatchSize: 1,
        logger: quiet,
      });

      await expect(publisher.publishOnce()).resolves.toEqual({
        published: false,
        reason: 'attestation-failed',
      });
      await expect(publisher.publishOnce()).resolves.toMatchObject({ published: true });
      expect(registryExecutor.attestRegistryRoot).toHaveBeenCalledTimes(2);
      expect(referendumExecutor.publishCredentialRoot).toHaveBeenCalledTimes(1);
    });
  });

  describe('sharing one wallet with the issuer', () => {
    const registry = () => registryState({ currentRoot: { field: 1_300n }, credentialCount: 16n });

    it('sends each transaction through the shared queue, one per turn', async () => {
      const turns: string[] = [];
      let inside = 0;
      const registryExecutor = makeRegistryExecutor({ onAttest: () => turns.push('attest') });
      const executorA = makeReferendumExecutor(referendumAddressA);
      const executorB = makeReferendumExecutor(referendumAddressB);
      for (const [name, executor] of [
        ['publish A', executorA],
        ['publish B', executorB],
      ] as const) {
        executor.publishCredentialRoot.mockImplementation(async () => {
          expect(inside).toBe(1);
          turns.push(name);
          return publishReceipt(referendumAddressA, name);
        });
      }
      const publisher = new CredentialRootPublisher({
        registryExecutor,
        registryContractAddress: registryAddress,
        reader: makeReader(registry),
        referenda: [target(referendumAddressA, executorA), target(referendumAddressB, executorB)],
        minBatchSize: 1,
        walletMutation: async (operation) => {
          inside += 1;
          turns.push('turn');
          try {
            return await operation();
          } finally {
            inside -= 1;
          }
        },
      });

      await publisher.publishOnce();
      expect(turns).toEqual(['turn', 'attest', 'turn', 'publish A', 'turn', 'publish B']);
    });

    it('sets its own registry state before every attestation', async () => {
      let field = 1_300n;
      let count = 16n;
      const registryExecutor = makeRegistryExecutor();
      const publisher = new CredentialRootPublisher({
        registryExecutor,
        registryContractAddress: registryAddress,
        reader: makeReader(() => registryState({ currentRoot: { field }, credentialCount: count })),
        referenda: [target(referendumAddressA, makeReferendumExecutor(referendumAddressA))],
        minBatchSize: 1,
      });

      await publisher.publishOnce();
      // The issuer joined the registry with a person's claims in between.
      field = 1_400n;
      count = 17n;
      await publisher.publishOnce();

      expect(registryExecutor.attestRegistryRoot).toHaveBeenCalledTimes(2);
      expect(registryExecutor.join).toHaveBeenCalledTimes(2);
      for (const [address, state] of vi.mocked(registryExecutor.join).mock.calls) {
        expect(address).toBe(registryAddress);
        // The attestation needs no authority, and is given none.
        expect(state.issuerSecret).toEqual(new Uint8Array(32));
      }
    });

    it('runs a cycle at once when triggered, and logs a failure instead of throwing', async () => {
      const errors: string[] = [];
      let fail = true;
      const referendumExecutor = makeReferendumExecutor(referendumAddressA);
      const publisher = new CredentialRootPublisher({
        registryExecutor: makeRegistryExecutor(),
        registryContractAddress: registryAddress,
        reader: {
          readRegistry: vi.fn(async () => {
            if (fail) throw new Error('indexer unavailable');
            return registry();
          }),
          readReferendum: vi.fn(async () => referendumState()),
        },
        referenda: [target(referendumAddressA, referendumExecutor)],
        minBatchSize: 1,
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: (message, details) => errors.push(`${message} ${String(details?.message)}`),
        },
      });

      publisher.trigger();
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(errors[0]).toContain('indexer unavailable');

      fail = false;
      publisher.trigger();
      await vi.waitFor(() =>
        expect(referendumExecutor.publishCredentialRoot).toHaveBeenCalledTimes(1),
      );
    });
  });

  describe('getStatus', () => {
    it('reports the batch as unobserved before the first cycle rather than as empty', () => {
      const publisher = new CredentialRootPublisher({
        registryExecutor: makeRegistryExecutor(),
        registryContractAddress: registryAddress,
        reader: makeReader(() => registryState({})),
        referenda: [target(referendumAddressA, makeReferendumExecutor(referendumAddressA))],
        minBatchSize: 16,
        maxWaitMs: 900_000,
        now: () => 1_000,
      });

      const status = publisher.getStatus();
      // Null, not 0. "We have not looked" and "nothing has happened" are
      // different facts, and only the second one is reassuring.
      expect(status.pendingCount).toBeNull();
      expect(status.pendingSinceMs).toBeNull();
      expect(status.publishesNoLaterThanMs).toBeNull();
      expect(status.lastPublishedAtMs).toBeNull();
      expect(status).toMatchObject({ minBatchSize: 16, maxWaitMs: 900_000, observedAtMs: 1_000 });
    });

    it('exposes the pending batch and the deadline it is bounded by', async () => {
      const now = 5_000;
      const publisher = new CredentialRootPublisher({
        registryExecutor: makeRegistryExecutor(),
        registryContractAddress: registryAddress,
        reader: makeReader(() =>
          registryState({ currentRoot: { field: 700n }, credentialCount: 3n }),
        ),
        referenda: [target(referendumAddressA, makeReferendumExecutor(referendumAddressA))],
        minBatchSize: 16,
        maxWaitMs: 900_000,
        now: () => now,
      });

      await publisher.publishOnce();
      const status = publisher.getStatus();

      expect(status.pendingCount).toBe(3);
      expect(status.pendingSinceMs).toBe(5_000);
      // The wait is bounded and the bound is knowable, which is the whole point.
      expect(status.publishesNoLaterThanMs).toBe(905_000);
    });

    it('drains the batch and records the publish time once a root goes out', async () => {
      let now = 0;
      const publisher = new CredentialRootPublisher({
        registryExecutor: makeRegistryExecutor(),
        registryContractAddress: registryAddress,
        reader: makeReader(() =>
          registryState({ currentRoot: { field: 800n }, credentialCount: 20n }),
        ),
        referenda: [target(referendumAddressA, makeReferendumExecutor(referendumAddressA))],
        minBatchSize: 16,
        maxWaitMs: 900_000,
        now: () => now,
      });

      now = 42_000;
      const result = await publisher.publishOnce();
      expect(result.published).toBe(true);

      const status = publisher.getStatus();
      expect(status.pendingCount).toBe(0);
      expect(status.pendingSinceMs).toBeNull();
      expect(status.publishesNoLaterThanMs).toBeNull();
      expect(status.lastPublishedAtMs).toBe(42_000);
    });
  });
});
