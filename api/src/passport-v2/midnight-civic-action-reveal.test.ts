import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  deriveBallotCommitment,
  deriveCredentialLeaf,
  deriveHolderBinding,
  deriveRegistryContractBinding,
} from './crypto.js';
import {
  MidnightCivicActionAdapter,
  type MidnightCivicActionStateResolver,
  type ReferendumV2CatalogEntry,
  type RevealContext,
} from './midnight-civic-action-adapter.js';
import type { ReferendumV2PrivateState } from './midnight-v2.js';
import type { ReferendumV2Executor, ReferendumV2Providers } from './midnight-v2-executors.js';
import type { WalletlessActionScope } from './midnight-v2-relayer-providers.js';
import type {
  BallotOpening,
  BallotOpeningVaultPort,
  CivicCredentialPort,
  CivicCredentialPrivateMaterial,
  CivicCredentialPrivateStatePort,
} from './ports.js';
import { type CanonicalReceipt, isoNumericCountry, type VoteChoice } from './types.js';

const credentialPath = { __credentialPath: true } as unknown as MerkleTreePath<Uint8Array>;
const ballotPath = { __ballotPath: true } as unknown as MerkleTreePath<Uint8Array>;
const authorization = { kind: 'civic-credential' as const, handle: 'issuance-handle' };

const claims = {
  issuerId: 'cico-rarimo-preview',
  country: isoNumericCountry('250'),
  ageClass: '18-plus' as const,
  assurance: 'document-nfc' as const,
  credentialEpoch: 7,
  validFrom: '2026-10-01T12:00:00.000Z',
  validUntil: '2026-12-31T12:00:00.000Z',
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
  referendumId: 'world:open-pulse',
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

function receiptFor(circuit: 'castVote' | 'revealVote'): CanonicalReceipt {
  return {
    status: 'confirmed',
    action: 'vote',
    network: 'preview',
    transactionId: `${circuit}-transaction-id`,
    transactionHash: `${circuit}-transaction-hash`,
    contractAddress: entry.contractAddress,
    circuit,
    blockHeight: 42,
    blockHash: 'block-hash',
    blockTimestamp: '2026-10-12T18:05:00.000Z',
  };
}

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
  async getActionAuthorization(): Promise<typeof authorization | null> {
    return authorization;
  }
  async getPrivateCredentialMaterial() {
    return material;
  }
  async clearCredential(): Promise<void> {}
}

/** A pass that has expired: it authorizes nothing any more. */
class ExpiredCredential extends FakeCredential {
  override async getActionAuthorization() {
    return null;
  }
}

/** Keeps openings per referendum; `save` replaces only an opening with the same commitment. */
class MemoryVault implements BallotOpeningVaultPort {
  readonly openings: BallotOpening[] = [];
  async list(referendumId: string) {
    return this.openings.filter((opening) => opening.referendumId === referendumId);
  }
  async save(opening: BallotOpening) {
    const index = this.openings.findIndex(
      (held) =>
        held.referendumId === opening.referendumId &&
        hex(held.ballotCommitment) === hex(opening.ballotCommitment),
    );
    if (index >= 0) this.openings[index] = opening;
    else this.openings.push(opening);
  }
  async clear(referendumId: string) {
    for (let index = this.openings.length - 1; index >= 0; index -= 1) {
      if (this.openings[index]?.referendumId === referendumId) this.openings.splice(index, 1);
    }
  }
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function opening(choice: VoteChoice, saltByte: number, status: BallotOpening['status']) {
  const voteSalt = new Uint8Array(32).fill(saltByte);
  return {
    referendumId: entry.referendumId,
    contractAddress: entry.contractAddress,
    choice,
    voteSalt,
    ballotCommitment: deriveBallotCommitment(entry.config.eventId, choice, voteSalt),
    status,
  } satisfies BallotOpening;
}

interface Calls {
  joined: ReferendumV2PrivateState[];
  revealed: Array<{ choice: VoteChoice; salt: Uint8Array }>;
  scopes: WalletlessActionScope[];
}

function executorFactory(
  calls: Calls,
  castVote: () => Promise<CanonicalReceipt> = async () => receiptFor('castVote'),
) {
  return (): ReferendumV2Executor => ({
    async deploy() {
      throw new Error('not used');
    },
    async join(_address, privateState) {
      calls.joined.push(privateState);
    },
    castVote,
    async revealVote(choice, salt) {
      calls.revealed.push({ choice, salt });
      return receiptFor('revealVote');
    },
    async closeVote() {
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
}

/** Reports every commitment in `onChain` as cast; the rest never reached the referendum. */
function resolver(
  chain: Pick<RevealContext, 'phase' | 'closed'> & {
    onChain?: readonly Uint8Array[];
    counted?: readonly Uint8Array[];
  },
): MidnightCivicActionStateResolver {
  const has = (list: readonly Uint8Array[] | undefined, value: Uint8Array) =>
    (list ?? []).some((held) => hex(held) === hex(value));
  return {
    async assertCanonicalBinding() {},
    async resolveCredentialPath() {
      return credentialPath;
    },
    async resolveRevealContext(_entry, ballotCommitments) {
      return {
        phase: chain.phase,
        closed: chain.closed,
        ballots: ballotCommitments.map((ballotCommitment) => ({
          ballotCommitment,
          revealPath: has(chain.onChain, ballotCommitment) ? ballotPath : null,
          revealed: has(chain.counted, ballotCommitment),
        })),
      };
    },
  };
}

function adapter(options: {
  vault?: BallotOpeningVaultPort;
  stateResolver: MidnightCivicActionStateResolver;
  calls?: Calls;
  castVote?: () => Promise<CanonicalReceipt>;
  randomBytes?: (length: number) => Uint8Array;
  credential?: FakeCredential;
  /** A connected wallet pays for itself, so nothing is relayed. */
  wallet?: boolean;
}) {
  const calls = options.calls ?? { joined: [], revealed: [], scopes: [] };
  return new MidnightCivicActionAdapter({
    providers: {} as ReferendumV2Providers,
    credential: options.credential ?? new FakeCredential(),
    referenda: [entry],
    randomBytes: options.randomBytes ?? (() => new Uint8Array(32).fill(8)),
    stateResolver: options.stateResolver,
    executorFactory: executorFactory(calls, options.castVote),
    ballotOpenings: options.vault,
    ...(options.wallet
      ? {}
      : {
          actionExecutionContext: {
            async run(scope, operation) {
              calls.scopes.push(scope);
              return operation();
            },
          },
        }),
  });
}

const open = resolver({ phase: 'COMMIT', closed: false });

describe('sealing an answer', () => {
  it('stores the opening before the cast leaves the device and marks it sealed after', async () => {
    const vault = new MemoryVault();
    const seenAtSubmit: BallotOpening[] = [];
    const actions = adapter({
      vault,
      stateResolver: open,
      castVote: async () => {
        seenAtSubmit.push(...vault.openings.map((held) => ({ ...held })));
        return receiptFor('castVote');
      },
    });

    const receipt = await actions.castVote({
      referendumId: entry.referendumId,
      choice: 'NO',
      authorization,
    });

    expect(seenAtSubmit).toHaveLength(1);
    expect(seenAtSubmit[0]).toMatchObject({ choice: 'NO', status: 'sealing' });
    expect(vault.openings).toHaveLength(1);
    expect(vault.openings[0]).toMatchObject({
      referendumId: entry.referendumId,
      contractAddress: entry.contractAddress,
      choice: 'NO',
      status: 'sealed',
      sealedAt: receipt.blockTimestamp,
    });
    expect(hex(vault.openings[0]?.ballotCommitment ?? new Uint8Array())).toBe(
      hex(deriveBallotCommitment(entry.config.eventId, 'NO', new Uint8Array(32).fill(8))),
    );
    expect(JSON.stringify(receipt)).not.toMatch(/choice|salt|commitment/i);
  });

  it('keeps a failed attempt and adds the retry beside it', async () => {
    const vault = new MemoryVault();
    let attempt = 0;
    let salt = 8;
    const actions = adapter({
      vault,
      stateResolver: open,
      randomBytes: () => new Uint8Array(32).fill(salt),
      castVote: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('relay response lost');
        return receiptFor('castVote');
      },
    });
    const request = { referendumId: entry.referendumId, choice: 'YES' as const, authorization };

    await expect(actions.castVote(request)).rejects.toThrow('relay response lost');
    expect(vault.openings.map((held) => held.status)).toEqual(['sealing']);

    salt = 9;
    await actions.castVote(request);
    expect(vault.openings.map((held) => held.status)).toEqual(['sealing', 'sealed']);
    expect(hex(vault.openings[0]?.voteSalt ?? new Uint8Array())).toBe('08'.repeat(32));
    expect(hex(vault.openings[1]?.voteSalt ?? new Uint8Array())).toBe('09'.repeat(32));
  });

  it('refuses a second answer from a device that already sealed one, before any proof', async () => {
    const vault = new MemoryVault();
    await vault.save(opening('YES', 8, 'sealed'));
    const calls: Calls = { joined: [], revealed: [], scopes: [] };
    const actions = adapter({ vault, stateResolver: open, calls });

    await expect(
      actions.castVote({ referendumId: entry.referendumId, choice: 'NO', authorization }),
    ).rejects.toMatchObject({ code: 'ANSWER_ALREADY_SEALED' });
    expect(calls.joined).toHaveLength(0);
    expect(vault.openings).toHaveLength(1);
  });

  it('notices an attempt that landed without the device seeing it, before a second proof', async () => {
    // The page was dropped while it waited for the relay. The vault still says
    // "sealing"; the chain holds the commitment.
    const vault = new MemoryVault();
    const earlier = opening('YES', 8, 'sealing');
    await vault.save(earlier);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };
    const landed = resolver({
      phase: 'COMMIT',
      closed: false,
      onChain: [earlier.ballotCommitment],
    });
    const actions = adapter({ vault, stateResolver: landed, calls });

    await expect(
      actions.castVote({ referendumId: entry.referendumId, choice: 'NO', authorization }),
    ).rejects.toMatchObject({ code: 'ANSWER_ALREADY_SEALED' });
    // No proof, no relay. The first answer stands, and the vault now says so.
    expect(calls.joined).toHaveLength(0);
    expect(calls.scopes).toHaveLength(0);
    expect(vault.openings.map((held) => [held.choice, held.status])).toEqual([['YES', 'sealed']]);
    await expect(actions.getSealedAnswerStatus(entry.referendumId)).resolves.toBe('sealed');
  });

  it('still seals without a vault, as before', async () => {
    const actions = adapter({ stateResolver: open });
    await expect(
      actions.castVote({ referendumId: entry.referendumId, choice: 'YES', authorization }),
    ).resolves.toMatchObject({ circuit: 'castVote' });
  });
});

describe('counting an answer', () => {
  it('counts the device’s own answer through the relay and deletes the opening', async () => {
    const vault = new MemoryVault();
    const sealed = opening('ABSTAIN', 8, 'sealed');
    await vault.save(sealed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };
    const actions = adapter({
      vault,
      calls,
      stateResolver: resolver({
        phase: 'REVEAL',
        closed: true,
        onChain: [sealed.ballotCommitment],
      }),
    });

    const receipt = await actions.revealVote({ referendumId: entry.referendumId, authorization });

    expect(receipt).toMatchObject({ circuit: 'revealVote', action: 'vote', status: 'confirmed' });
    // The count needs only the path; no credential material is loaded for it.
    expect(calls.joined).toEqual([{ role: 'voter', revealPath: ballotPath }]);
    expect(calls.revealed).toHaveLength(1);
    expect(calls.revealed[0]?.choice).toBe('ABSTAIN');
    expect(hex(calls.revealed[0]?.salt ?? new Uint8Array())).toBe('08'.repeat(32));
    expect(calls.scopes).toEqual([
      {
        credentialAuthorization: authorization.handle,
        contractAddress: entry.contractAddress,
        circuit: 'revealVote',
        action: 'vote',
      },
    ]);
    expect(vault.openings).toHaveLength(0);
    expect(JSON.stringify(receipt)).not.toMatch(/choice|salt|commitment/i);
    await expect(actions.getCanonicalReceipt(receipt.transactionId)).resolves.toEqual(receipt);
  });

  it('counts the attempt the chain accepted, not the one that never landed', async () => {
    const vault = new MemoryVault();
    const lost = opening('YES', 8, 'sealing');
    const landed = opening('NO', 9, 'sealing');
    await vault.save(lost);
    await vault.save(landed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };
    const actions = adapter({
      vault,
      calls,
      stateResolver: resolver({
        phase: 'REVEAL',
        closed: true,
        onChain: [landed.ballotCommitment],
      }),
    });

    await actions.revealVote({ referendumId: entry.referendumId, authorization });

    expect(calls.revealed.map((call) => call.choice)).toEqual(['NO']);
    expect(vault.openings).toHaveLength(0);
  });

  it('waits while answers are open and stops once the count has closed', async () => {
    const vault = new MemoryVault();
    const sealed = opening('YES', 8, 'sealed');
    await vault.save(sealed);
    const request = { referendumId: entry.referendumId, authorization };

    await expect(
      adapter({
        vault,
        stateResolver: resolver({
          phase: 'COMMIT',
          closed: false,
          onChain: [sealed.ballotCommitment],
        }),
      }).revealVote(request),
    ).rejects.toMatchObject({ code: 'REVEAL_NOT_OPEN', retryable: true });

    await expect(
      adapter({
        vault,
        stateResolver: resolver({
          phase: 'FINALIZED',
          closed: true,
          onChain: [sealed.ballotCommitment],
        }),
      }).revealVote(request),
    ).rejects.toMatchObject({ code: 'REVEAL_NOT_OPEN', retryable: false });

    // Neither refusal costs the person their opening.
    expect(vault.openings).toHaveLength(1);
  });

  it('fails closed without an opening, without a vault, and with a stale credential', async () => {
    const counting = resolver({ phase: 'REVEAL', closed: true });
    const request = { referendumId: entry.referendumId, authorization };

    await expect(
      adapter({ vault: new MemoryVault(), stateResolver: counting }).revealVote(request),
    ).rejects.toMatchObject({ code: 'BALLOT_OPENING_NOT_FOUND' });

    const neverLanded = new MemoryVault();
    await neverLanded.save(opening('YES', 8, 'sealing'));
    await expect(
      adapter({ vault: neverLanded, stateResolver: counting }).revealVote(request),
    ).rejects.toMatchObject({ code: 'BALLOT_OPENING_NOT_FOUND' });

    await expect(adapter({ stateResolver: counting }).revealVote(request)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });

    await expect(
      adapter({ vault: neverLanded, stateResolver: counting }).revealVote({
        referendumId: entry.referendumId,
        authorization: { kind: 'civic-credential', handle: 'stale-handle' },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });

    await expect(
      adapter({ vault: neverLanded, stateResolver: counting }).revealVote({
        referendumId: 'unknown',
        authorization,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_NOT_SATISFIED' });
  });

  it('ignores an opening sealed for another deployment of the same referendum', async () => {
    const vault = new MemoryVault();
    const foreign = { ...opening('YES', 8, 'sealed'), contractAddress: '99'.repeat(32) };
    await vault.save(foreign);
    await expect(
      adapter({
        vault,
        stateResolver: resolver({
          phase: 'REVEAL',
          closed: true,
          onChain: [foreign.ballotCommitment],
        }),
      }).revealVote({ referendumId: entry.referendumId, authorization }),
    ).rejects.toMatchObject({ code: 'BALLOT_OPENING_NOT_FOUND' });
  });

  it('recognises a count that landed before the device could record it', async () => {
    const vault = new MemoryVault();
    const sealed = opening('YES', 8, 'sealed');
    await vault.save(sealed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };
    const counted = resolver({
      phase: 'REVEAL',
      closed: true,
      onChain: [sealed.ballotCommitment],
      counted: [sealed.ballotCommitment],
    });

    await expect(
      adapter({ vault, calls, stateResolver: counted }).revealVote({
        referendumId: entry.referendumId,
        authorization,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(calls.revealed).toHaveLength(0);
    expect(vault.openings).toHaveLength(0);
  });

  it('shares one count between two callers', async () => {
    const vault = new MemoryVault();
    const sealed = opening('NO', 8, 'sealed');
    await vault.save(sealed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };
    const actions = adapter({
      vault,
      calls,
      stateResolver: resolver({
        phase: 'REVEAL',
        closed: true,
        onChain: [sealed.ballotCommitment],
      }),
    });
    const request = { referendumId: entry.referendumId, authorization };

    const [first, second] = await Promise.all([
      actions.revealVote(request),
      actions.revealVote(request),
    ]);

    expect(first).toEqual(second);
    expect(calls.revealed).toHaveLength(1);
  });
});

describe('where a sealed answer stands', () => {
  it('reports none, sealed and counted from the vault and the chain', async () => {
    const empty = adapter({
      vault: new MemoryVault(),
      stateResolver: resolver({ phase: 'COMMIT', closed: false }),
    });
    await expect(empty.getSealedAnswerStatus(entry.referendumId)).resolves.toBe('none');
    await expect(empty.getSealedAnswerStatus('unknown')).resolves.toBe('none');

    const vault = new MemoryVault();
    const sealed = opening('YES', 8, 'sealed');
    await vault.save(sealed);

    const notLanded = adapter({
      vault,
      stateResolver: resolver({ phase: 'COMMIT', closed: false }),
    });
    await expect(notLanded.getSealedAnswerStatus(entry.referendumId)).resolves.toBe('none');

    const landed = adapter({
      vault,
      stateResolver: resolver({
        phase: 'COMMIT',
        closed: false,
        onChain: [sealed.ballotCommitment],
      }),
    });
    await expect(landed.getSealedAnswerStatus(entry.referendumId)).resolves.toBe('sealed');
    expect(vault.openings).toHaveLength(1);

    const counted = adapter({
      vault,
      stateResolver: resolver({
        phase: 'REVEAL',
        closed: true,
        onChain: [sealed.ballotCommitment],
        counted: [sealed.ballotCommitment],
      }),
    });
    await expect(counted.getSealedAnswerStatus(entry.referendumId)).resolves.toBe('counted');
    expect(vault.openings).toHaveLength(0);
  });

  it('never asks the chain when the device holds nothing', async () => {
    const resolveRevealContext = vi.fn();
    const actions = adapter({
      vault: new MemoryVault(),
      stateResolver: {
        async assertCanonicalBinding() {},
        async resolveCredentialPath() {
          return credentialPath;
        },
        resolveRevealContext,
      },
    });
    await actions.getSealedAnswerStatus(entry.referendumId);
    expect(resolveRevealContext).not.toHaveBeenCalled();
  });
});

describe('counting after the pass has expired', () => {
  const counting = (sealed: BallotOpening) =>
    resolver({ phase: 'REVEAL', closed: true, onChain: [sealed.ballotCommitment] });

  it('keeps, with the sealed answer, the authorization that sponsored it', async () => {
    const vault = new MemoryVault();
    await adapter({ vault, stateResolver: open }).castVote({
      referendumId: entry.referendumId,
      choice: 'YES',
      authorization,
    });

    expect(vault.openings).toHaveLength(1);
    expect(vault.openings[0]).toMatchObject({
      status: 'sealed',
      countAuthorization: authorization.handle,
    });
  });

  it('sponsors the count with the kept authorization, without a current pass', async () => {
    const vault = new MemoryVault();
    const sealed = { ...opening('NO', 8, 'sealed'), countAuthorization: 'handle-at-seal' };
    await vault.save(sealed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };

    const receipt = await adapter({
      vault,
      calls,
      credential: new ExpiredCredential(),
      stateResolver: counting(sealed),
    }).revealVote({ referendumId: entry.referendumId });

    expect(receipt).toMatchObject({ circuit: 'revealVote', status: 'confirmed' });
    expect(calls.scopes).toEqual([
      {
        credentialAuthorization: 'handle-at-seal',
        contractAddress: entry.contractAddress,
        circuit: 'revealVote',
        action: 'vote',
      },
    ]);
    expect(calls.revealed[0]?.choice).toBe('NO');
    expect(vault.openings).toHaveLength(0);
  });

  it('prefers the current pass while it is valid', async () => {
    const vault = new MemoryVault();
    const sealed = { ...opening('NO', 8, 'sealed'), countAuthorization: 'handle-at-seal' };
    await vault.save(sealed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };

    await adapter({ vault, calls, stateResolver: counting(sealed) }).revealVote({
      referendumId: entry.referendumId,
      authorization,
    });

    expect(calls.scopes[0]?.credentialAuthorization).toBe(authorization.handle);
  });

  it('asks for a new pass when nothing can sponsor the count, and keeps the answer', async () => {
    const vault = new MemoryVault();
    const sealed = opening('NO', 8, 'sealed');
    await vault.save(sealed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };

    await expect(
      adapter({
        vault,
        calls,
        credential: new ExpiredCredential(),
        stateResolver: counting(sealed),
      }).revealVote({ referendumId: entry.referendumId }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });

    expect(calls.revealed).toHaveLength(0);
    expect(vault.openings).toHaveLength(1);
  });

  it('lets a wallet count without any authorization, because it pays for itself', async () => {
    const vault = new MemoryVault();
    const sealed = opening('YES', 8, 'sealed');
    await vault.save(sealed);
    const calls: Calls = { joined: [], revealed: [], scopes: [] };

    const receipt = await adapter({
      vault,
      calls,
      wallet: true,
      credential: new ExpiredCredential(),
      stateResolver: counting(sealed),
    }).revealVote({ referendumId: entry.referendumId });

    expect(receipt).toMatchObject({ circuit: 'revealVote', status: 'confirmed' });
    expect(calls.scopes).toHaveLength(0);
    expect(vault.openings).toHaveLength(0);
  });

  it('still refuses an authorization that is not the current pass', async () => {
    const vault = new MemoryVault();
    const sealed = { ...opening('NO', 8, 'sealed'), countAuthorization: 'handle-at-seal' };
    await vault.save(sealed);

    await expect(
      adapter({ vault, stateResolver: counting(sealed) }).revealVote({
        referendumId: entry.referendumId,
        authorization: { kind: 'civic-credential', handle: 'someone-else' },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    expect(vault.openings).toHaveLength(1);
  });
});
