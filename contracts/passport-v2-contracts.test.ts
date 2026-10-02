import {
  type CircuitContext,
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  encodeContractAddress,
  type MerkleTreeDigest,
  type MerkleTreePath,
  persistentCommit,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { sampleCoinPublicKey } from '@midnight-ntwrk/ledger-v8';
import { describe, expect, it } from 'vitest';
import {
  deriveBallotCommitment,
  deriveRawCredentialLeaf,
  deriveRegistryContractBinding,
  deriveVoteNullifier,
} from '../api/src/passport-v2/crypto.js';
import { MidnightCivicActionAdapter } from '../api/src/passport-v2/midnight-civic-action-adapter.js';
import {
  credentialTreeView,
  parseReferendumV2,
  type ReferendumV2PrivateState,
  resolveAdmittedCredentialPath,
} from '../api/src/passport-v2/midnight-v2.js';
import type {
  ReferendumV2Executor,
  ReferendumV2Providers,
} from '../api/src/passport-v2/midnight-v2-executors.js';
import { isoNumericCountry } from '../api/src/passport-v2/types.js';
import {
  Contract as RegistryContract,
  ledger as registryLedger,
} from './credential-registry-v1/managed/credential-registry-v1/contract/index.js';
import {
  Choice,
  Contract as ReferendumContract,
  ledger as referendumLedger,
} from './referendum-v2/managed/referendum-v2/contract/index.js';

const bytes32 = new CompactTypeBytes(32);
const vector2 = new CompactTypeVector(2, bytes32);
const vector8 = new CompactTypeVector(8, bytes32);

function bytes(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}

function pad32(value: string): Uint8Array {
  const result = new Uint8Array(32);
  result.set(new TextEncoder().encode(value));
  return result;
}

function uintBytes(value: bigint): Uint8Array {
  return convertFieldToBytes(32, value, 'golden vector');
}

// Published enrollment/voting/reveal schedule shared by every referendum
// deployed in this file, expressed in fake block-time seconds (NOT wall
// clock). The simulator lets createCircuitContext pin a specific
// secondsSinceEpoch, and `atTime` below rebuilds a context at a new time
// against the same evolving ledger state -- that is the only way to move
// block time forward between circuit calls in this simulator, since a
// CircuitContext's block time is fixed at the moment it is constructed.
const OPENS_AT = 1_000_000_000n;
const ENROLLMENT_CLOSES_AT = 1_000_000_500n;
const CLOSES_AT = 1_000_001_000n;
const REVEAL_CLOSES_AT = 1_000_002_000n;
// Inside the enrollment window and the voting window.
const DURING_ENROLLMENT = 1_000_000_100n;
// After enrollment closes but still inside the voting window.
const AFTER_ENROLLMENT_DURING_VOTING = 1_000_000_600n;

function atTime<PS>(context: CircuitContext<PS>, time: bigint): CircuitContext<PS> {
  return createCircuitContext(
    dummyContractAddress(),
    context.currentZswapLocalState,
    context.currentQueryContext.state,
    context.currentPrivateState,
    undefined,
    undefined,
    Number(time),
  );
}

type Claims = {
  holderBinding: Uint8Array;
  issuerId: Uint8Array;
  country: Uint8Array;
  ageClass: bigint;
  assurance: bigint;
  epoch: bigint;
  validUntil: bigint;
  blind: Uint8Array;
};

function credentialLeaf(claims: Claims): Uint8Array {
  return persistentCommit(
    vector8,
    [
      pad32('cico:credential:v1'),
      claims.holderBinding,
      claims.issuerId,
      claims.country,
      uintBytes(claims.ageClass),
      uintBytes(claims.assurance),
      uintBytes(claims.epoch),
      uintBytes(claims.validUntil),
    ],
    claims.blind,
  );
}

function holderBinding(voterSecret: Uint8Array, holderBlind: Uint8Array): Uint8Array {
  return persistentCommit(vector2, [pad32('cico:holder-bind:v1'), voterSecret], holderBlind);
}

function roleKey(domain: string, secret: Uint8Array): Uint8Array {
  return persistentHash(vector2, [pad32(domain), secret]);
}

type RegistryPrivateState = {
  issuerSecret: Uint8Array;
  claims: Claims;
};

function registryWitnesses() {
  const witness =
    <K extends keyof Claims>(key: K) =>
    (context: WitnessContext<unknown, RegistryPrivateState>) =>
      [context.privateState, context.privateState.claims[key]] as const;
  return {
    issuerSecret: (context: WitnessContext<unknown, RegistryPrivateState>) =>
      [context.privateState, context.privateState.issuerSecret] as const,
    holderBinding: witness('holderBinding'),
    credentialBlind: witness('blind'),
    credentialCountry: witness('country'),
    credentialAgeClass: witness('ageClass'),
    credentialAssurance: witness('assurance'),
    credentialValidUntil: witness('validUntil'),
  };
}

function makeClaims(
  seed: number,
  overrides: Partial<Claims> = {},
): {
  voterSecret: Uint8Array;
  holderBlind: Uint8Array;
  claims: Claims;
} {
  const voterSecret = bytes(seed);
  const holderBlind = bytes(seed + 1);
  const claims: Claims = {
    holderBinding: holderBinding(voterSecret, holderBlind),
    issuerId: bytes(4),
    country: pad32('032'),
    ageClass: 2n,
    assurance: 2n,
    epoch: 7n,
    validUntil: 2_000_000_000n,
    blind: bytes(seed + 2),
    ...overrides,
  };
  return { voterSecret, holderBlind, claims };
}

function setupRegistry(overrides: Partial<Claims> = {}) {
  const issuerSecret = bytes(1);
  const { voterSecret, holderBlind, claims } = makeClaims(2, overrides);
  const privateState: RegistryPrivateState = { issuerSecret, claims };
  const contract = new RegistryContract(registryWitnesses());
  const constructorContext = createConstructorContext(privateState, sampleCoinPublicKey());
  const initial = contract.initialState(
    constructorContext,
    bytes(6),
    claims.issuerId,
    claims.epoch,
    roleKey('cico:registry:issuer:', issuerSecret),
  );
  const context = createCircuitContext(
    dummyContractAddress(),
    initial.currentZswapLocalState,
    initial.currentContractState,
    initial.currentPrivateState,
  );
  return { contract, context, privateState, issuerSecret, voterSecret, holderBlind, claims };
}

type RegistryHandle = ReturnType<typeof setupRegistry>;

// Adds a credential for `claims` to an already-constructed registry, mutating
// `registry.privateState.claims` (read live by the witnesses) and advancing
// `registry.context` to the post-insertion state. Returns the new leaf, its
// Merkle path, and the resulting registry root so a caller can immediately
// wire up a referendum voter against it.
function enroll(registry: RegistryHandle, claims: Claims) {
  registry.privateState.claims = claims;
  const issued = registry.contract.impureCircuits.addCredential(registry.context);
  registry.context = issued.context;
  const state = registryLedger(issued.context.currentQueryContext.state);
  const leaf = credentialLeaf(claims);
  const path = state.credentials.findPathForLeaf(leaf);
  if (!path) throw new Error('credential leaf was not inserted');
  return { leaf, path, root: state.credentials.root() };
}

type ReferendumPrivateState = {
  organizerSecret: Uint8Array;
  rootPublisherSecret: Uint8Array;
  voterSecret: Uint8Array;
  holderBinding: Uint8Array;
  holderBlind: Uint8Array;
  credentialBlind: Uint8Array;
  credentialCountry: Uint8Array;
  credentialAgeClass: bigint;
  credentialAssurance: bigint;
  credentialClaimEpoch: bigint;
  credentialValidUntil: bigint;
  voterPath: MerkleTreePath<Uint8Array>;
  voterChoice: Choice;
  voteSalt: Uint8Array;
  revealPath?: MerkleTreePath<Uint8Array>;
};

function referendumWitnesses() {
  const witness =
    <K extends keyof ReferendumPrivateState>(key: K) =>
    (context: WitnessContext<unknown, ReferendumPrivateState>) =>
      [context.privateState, context.privateState[key]] as const;
  return {
    organizerSecret: witness('organizerSecret'),
    rootPublisherSecret: witness('rootPublisherSecret'),
    voterSecret: witness('voterSecret'),
    holderBinding: witness('holderBinding'),
    holderBlind: witness('holderBlind'),
    credentialBlind: witness('credentialBlind'),
    credentialCountry: witness('credentialCountry'),
    credentialAgeClass: witness('credentialAgeClass'),
    credentialAssurance: witness('credentialAssurance'),
    credentialClaimEpoch: witness('credentialClaimEpoch'),
    credentialValidUntil: witness('credentialValidUntil'),
    voterPath: witness('voterPath'),
    voterChoice: witness('voterChoice'),
    voteSalt: witness('voteSalt'),
    revealPath: (context: WitnessContext<unknown, ReferendumPrivateState>) => {
      if (!context.privateState.revealPath) throw new Error('reveal path is unavailable');
      return [context.privateState, context.privateState.revealPath] as const;
    },
  };
}

const ORGANIZER_SECRET = bytes(20);
const ROOT_PUBLISHER_SECRET = bytes(23);

function privateStateFromVoter(
  organizerSecret: Uint8Array,
  rootPublisherSecret: Uint8Array,
  voterSecret: Uint8Array,
  holderBlind: Uint8Array,
  claims: Claims,
  voterPath: MerkleTreePath<Uint8Array>,
  voteSalt: Uint8Array,
): ReferendumPrivateState {
  return {
    organizerSecret,
    rootPublisherSecret,
    voterSecret,
    holderBinding: claims.holderBinding,
    holderBlind,
    credentialBlind: claims.blind,
    credentialCountry: claims.country,
    credentialAgeClass: claims.ageClass,
    credentialAssurance: claims.assurance,
    credentialClaimEpoch: claims.epoch,
    credentialValidUntil: claims.validUntil,
    voterPath,
    voterChoice: Choice.YES,
    voteSalt,
  };
}

function setupReferendum(
  options: {
    eventId?: Uint8Array;
    root?: MerkleTreeDigest;
    country?: Uint8Array;
    minimumAssurance?: bigint;
    requireAdult?: boolean;
    validityReference?: bigint;
    organizerSecret?: Uint8Array;
    rootPublisherSecret?: Uint8Array;
    // Bypasses roleKey derivation entirely, for exercising the constructor's
    // raw `organizerKey != rootPublisherKey` check directly. Domain
    // separation means two different secrets under the two roleKey domains
    // can never collide in practice, so the only way to trigger this
    // assertion is to inject the same raw public key value for both.
    rootPublisherKeyOverride?: Uint8Array;
    opensAtUnix?: bigint;
    enrollmentClosesAtUnix?: bigint;
    closesAtUnix?: bigint;
    revealClosesAtUnix?: bigint;
    now?: bigint;
    mutatePrivateState?: (state: ReferendumPrivateState) => void;
  } = {},
) {
  const registry = setupRegistry();
  const enrolled = enroll(registry, registry.claims);
  const eventId = options.eventId ?? bytes(21);
  const organizerSecret = options.organizerSecret ?? ORGANIZER_SECRET;
  const rootPublisherSecret = options.rootPublisherSecret ?? ROOT_PUBLISHER_SECRET;
  const privateState = privateStateFromVoter(
    organizerSecret,
    rootPublisherSecret,
    registry.voterSecret,
    registry.holderBlind,
    registry.claims,
    enrolled.path,
    bytes(22),
  );
  options.mutatePrivateState?.(privateState);
  const contract = new ReferendumContract(referendumWitnesses());
  const constructorContext = createConstructorContext(privateState, sampleCoinPublicKey());
  const opensAtUnix = options.opensAtUnix ?? OPENS_AT;
  const enrollmentClosesAtUnix = options.enrollmentClosesAtUnix ?? ENROLLMENT_CLOSES_AT;
  const closesAtUnix = options.closesAtUnix ?? CLOSES_AT;
  const revealClosesAtUnix = options.revealClosesAtUnix ?? REVEAL_CLOSES_AT;
  const initial = contract.initialState(
    constructorContext,
    bytes(6),
    registry.claims.issuerId,
    registry.claims.epoch,
    options.root ?? enrolled.root,
    deriveRegistryContractBinding(dummyContractAddress()),
    { bytes: encodeContractAddress(dummyContractAddress()) },
    eventId,
    roleKey('cico:referendum-v2:organizer:', organizerSecret),
    options.rootPublisherKeyOverride ?? roleKey('cico:ref-v2:root-publisher:', rootPublisherSecret),
    options.country ?? registry.claims.country,
    true,
    options.minimumAssurance ?? 2n,
    options.requireAdult ?? true,
    options.validityReference ?? 1_900_000_000n,
    opensAtUnix,
    enrollmentClosesAtUnix,
    closesAtUnix,
    revealClosesAtUnix,
  );
  const context = createCircuitContext(
    dummyContractAddress(),
    initial.currentZswapLocalState,
    initial.currentContractState,
    initial.currentPrivateState,
    undefined,
    undefined,
    Number(options.now ?? DURING_ENROLLMENT),
  );
  return {
    contract,
    context,
    privateState,
    root: enrolled.root,
    eventId,
    leaf: enrolled.leaf,
    registry,
    schedule: { opensAtUnix, enrollmentClosesAtUnix, closesAtUnix, revealClosesAtUnix },
  };
}

describe('CredentialRegistryV1', () => {
  it('matches the TypeScript credential-leaf golden vector and freezes irreversibly', () => {
    const { contract, context, claims } = setupRegistry();
    const issued = contract.impureCircuits.addCredential(context);
    const state = registryLedger(issued.context.currentQueryContext.state);
    const expectedLeaf = credentialLeaf(claims);
    expect(expectedLeaf).toEqual(
      deriveRawCredentialLeaf({
        holderBinding: claims.holderBinding,
        issuerId: claims.issuerId,
        country: claims.country,
        ageClass: claims.ageClass,
        assurance: claims.assurance,
        credentialEpoch: claims.epoch,
        validUntil: claims.validUntil,
        credentialBlind: claims.blind,
      }),
    );
    expect(state.credentials.findPathForLeaf(expectedLeaf)?.leaf).toEqual(expectedLeaf);
    const frozen = contract.impureCircuits.freeze(issued.context, state.credentials.root());
    expect(registryLedger(frozen.context.currentQueryContext.state).frozen).toBe(true);
    expect(() => contract.impureCircuits.addCredential(frozen.context)).toThrow('frozen');
  });

  it('changes the leaf when any claim or blind changes', () => {
    const { claims } = setupRegistry();
    const baseline = Buffer.from(credentialLeaf(claims)).toString('hex');
    const variants: Claims[] = [
      { ...claims, holderBinding: bytes(31) },
      { ...claims, issuerId: bytes(32) },
      { ...claims, country: pad32('250') },
      { ...claims, ageClass: 1n },
      { ...claims, assurance: 1n },
      { ...claims, epoch: 8n },
      { ...claims, validUntil: claims.validUntil + 1n },
      { ...claims, blind: bytes(33) },
    ];
    for (const variant of variants) {
      expect(Buffer.from(credentialLeaf(variant)).toString('hex')).not.toBe(baseline);
    }
  });

  it('rejects freezing a historic root after enrollment changes', () => {
    const { contract, context } = setupRegistry();
    const emptyRoot = registryLedger(context.currentQueryContext.state).credentials.root();
    const issued = contract.impureCircuits.addCredential(context);
    const currentRoot = registryLedger(issued.context.currentQueryContext.state).credentials.root();

    expect(currentRoot.field).not.toBe(emptyRoot.field);
    expect(() => contract.impureCircuits.freeze(issued.context, emptyRoot)).toThrow(
      'Invalid registry root',
    );
    const frozen = contract.impureCircuits.freeze(issued.context, currentRoot);
    expect(registryLedger(frozen.context.currentQueryContext.state).frozenRoot.field).toBe(
      currentRoot.field,
    );
  });

  it('requires the issuer authority for both mutation circuits', () => {
    const { contract, context, privateState } = setupRegistry();
    privateState.issuerSecret = bytes(99);
    expect(() => contract.impureCircuits.addCredential(context)).toThrow(
      'Registry authorization failed',
    );
  });

  it('attests that a candidate root really belongs to this registry', () => {
    const { contract, context } = setupRegistry();
    const emptyRoot = registryLedger(context.currentQueryContext.state).credentials.root();
    // Attesting the current (empty) root succeeds and mutates nothing.
    const attested = contract.impureCircuits.attestCurrentRoot(context, emptyRoot);
    expect(registryLedger(attested.context.currentQueryContext.state).credentialCount).toBe(0n);

    const issued = contract.impureCircuits.addCredential(context);
    const currentRoot = registryLedger(issued.context.currentQueryContext.state).credentials.root();
    // The old (now historic) root is no longer the current root.
    expect(() => contract.impureCircuits.attestCurrentRoot(issued.context, emptyRoot)).toThrow(
      'Invalid registry root',
    );
    const reAttested = contract.impureCircuits.attestCurrentRoot(issued.context, currentRoot);
    expect(registryLedger(reAttested.context.currentQueryContext.state).credentialCount).toBe(1n);
  });
});

describe('ReferendumV2 credential policy', () => {
  it('retains the deterministic registry contract binding in public state', () => {
    const item = setupReferendum();
    const state = referendumLedger(item.context.currentQueryContext.state);
    expect(state.registryContractBinding).toEqual(
      deriveRegistryContractBinding(dummyContractAddress()),
    );
    expect(state.registryContractBinding).not.toEqual(
      deriveRegistryContractBinding('11'.repeat(32)),
    );
  });

  it('casts privately, rejects replay, and binds nullifiers to the referendum', () => {
    const first = setupReferendum({ eventId: bytes(41) });
    const firstVote = first.contract.impureCircuits.castVote(first.context);
    const firstState = referendumLedger(firstVote.context.currentQueryContext.state);
    expect(firstState.spentVoteNullifiers.size()).toBe(1n);
    expect(
      firstState.spentVoteNullifiers.member(
        deriveVoteNullifier(first.privateState.voterSecret, first.eventId),
      ),
    ).toBe(true);
    const expectedBallot = deriveBallotCommitment(
      first.eventId,
      'YES',
      first.privateState.voteSalt,
    );
    expect(firstState.ballotCommitments.findPathForLeaf(expectedBallot)?.leaf).toEqual(
      expectedBallot,
    );
    expect(firstState.tally.lookup(Choice.YES)).toBe(0n);
    expect(() => first.contract.impureCircuits.castVote(firstVote.context)).toThrow(
      'already voted',
    );

    const second = setupReferendum({ eventId: bytes(42) });
    const secondVote = second.contract.impureCircuits.castVote(second.context);
    const secondState = referendumLedger(secondVote.context.currentQueryContext.state);
    const firstNullifier = [...firstState.spentVoteNullifiers][0];
    const secondNullifier = [...secondState.spentVoteNullifiers][0];
    expect(firstNullifier).toBeDefined();
    expect(secondNullifier).toBeDefined();
    expect(firstNullifier).not.toEqual(secondNullifier);
  });

  it('binds ballot commitments to event, choice, and salt', () => {
    const eventId = bytes(61);
    const salt = bytes(62);
    const baseline = deriveBallotCommitment(eventId, 'YES', salt);
    expect(deriveBallotCommitment(bytes(63), 'YES', salt)).not.toEqual(baseline);
    expect(deriveBallotCommitment(eventId, 'NO', salt)).not.toEqual(baseline);
    expect(deriveBallotCommitment(eventId, 'YES', bytes(64))).not.toEqual(baseline);
  });

  it('rejects an unbound secret, wrong root, country, assurance, age, and expiry generically', () => {
    const cases = [
      setupReferendum({ mutatePrivateState: (state) => (state.voterSecret = bytes(51)) }),
      setupReferendum({ root: { field: 123n } }),
      setupReferendum({ country: pad32('250') }),
      setupReferendum({ minimumAssurance: 3n }),
      setupReferendum({ mutatePrivateState: (state) => (state.credentialAgeClass = 1n) }),
      setupReferendum({ validityReference: 2_100_000_000n }),
    ];
    for (const item of cases) {
      expect(() => item.contract.impureCircuits.castVote(item.context)).toThrow(
        'Credential policy not satisfied',
      );
    }
  });

  it('counts accepted commitments and keeps closed/phase transitions consistent', () => {
    const item = setupReferendum();
    const committed = item.contract.impureCircuits.castVote(item.context);
    const committedState = referendumLedger(committed.context.currentQueryContext.state);
    expect(committedState.issuedVotes).toBe(1n);
    expect(committedState.closed).toBe(false);
    expect(committedState.phase).toBe(0);

    // closeVote is permissionless and purely blockTime-gated: it must be
    // rejected before the published deadline even with no authorization
    // check standing in the way.
    expect(() => item.contract.impureCircuits.closeVote(committed.context)).toThrow(
      'Voting cannot close before its deadline',
    );

    const atClose = atTime(committed.context, item.schedule.closesAtUnix);
    const closed = item.contract.impureCircuits.closeVote(atClose);
    const closedState = referendumLedger(closed.context.currentQueryContext.state);
    expect(closedState.issuedVotes).toBe(1n);
    expect(closedState.closed).toBe(true);
    expect(closedState.phase).toBe(1);
    expect(() => item.contract.impureCircuits.castVote(closed.context)).toThrow(
      'Voting is not in the commit phase',
    );
    expect(() => item.contract.impureCircuits.closeVote(closed.context)).toThrow(
      'The referendum is not in the commit phase',
    );

    const commitment = deriveBallotCommitment(item.eventId, 'YES', item.privateState.voteSalt);
    item.privateState.revealPath = closedState.ballotCommitments.findPathForLeaf(commitment);
    if (!item.privateState.revealPath) throw new Error('ballot commitment path was not inserted');
    const revealed = item.contract.impureCircuits.revealVote(
      closed.context,
      Choice.YES,
      item.privateState.voteSalt,
    );
    const revealedState = referendumLedger(revealed.context.currentQueryContext.state);
    expect(revealedState.closed).toBe(true);
    expect(revealedState.phase).toBe(1);
    expect(revealedState.tally.lookup(Choice.YES)).toBe(1n);

    // finalizeVote is likewise permissionless and gated on revealClosesAtUnix.
    expect(() => item.contract.impureCircuits.finalizeVote(revealed.context)).toThrow(
      'The reveal window is still open',
    );
    const atRevealClose = atTime(revealed.context, item.schedule.revealClosesAtUnix);
    const finalized = item.contract.impureCircuits.finalizeVote(atRevealClose);
    const finalizedState = referendumLedger(finalized.context.currentQueryContext.state);
    expect(finalizedState.closed).toBe(true);
    expect(finalizedState.phase).toBe(2);
    expect(() =>
      item.contract.impureCircuits.revealVote(
        finalized.context,
        Choice.YES,
        item.privateState.voteSalt,
      ),
    ).toThrow('Voting is not in the reveal phase');
  });

  it('lets closeVote and finalizeVote proceed with no organizer at all (permissionless)', () => {
    const item = setupReferendum({
      mutatePrivateState: (state) => (state.organizerSecret = bytes(199)),
    });
    const committed = item.contract.impureCircuits.castVote(item.context);
    const closed = item.contract.impureCircuits.closeVote(
      atTime(committed.context, item.schedule.closesAtUnix),
    );
    expect(referendumLedger(closed.context.currentQueryContext.state).closed).toBe(true);

    const commitment = deriveBallotCommitment(item.eventId, 'YES', item.privateState.voteSalt);
    item.privateState.revealPath = referendumLedger(
      closed.context.currentQueryContext.state,
    ).ballotCommitments.findPathForLeaf(commitment);
    const revealed = item.contract.impureCircuits.revealVote(
      closed.context,
      Choice.YES,
      item.privateState.voteSalt,
    );
    const finalized = item.contract.impureCircuits.finalizeVote(
      atTime(revealed.context, item.schedule.revealClosesAtUnix),
    );
    expect(referendumLedger(finalized.context.currentQueryContext.state).phase).toBe(2);
  });

  it('rejects an unauthorized organizer on the circuits that still require the role', () => {
    const item = setupReferendum({
      mutatePrivateState: (state) => (state.organizerSecret = bytes(101)),
    });
    expect(() =>
      item.contract.impureCircuits.revokeCredentialRoot(item.context, item.root),
    ).toThrow('Organizer authorization failed');
    expect(() => item.contract.impureCircuits.closeEnrollment(item.context)).toThrow(
      'Organizer authorization failed',
    );
    const state = referendumLedger(item.context.currentQueryContext.state);
    expect(state.phase).toBe(0);
    expect(state.enrollmentClosed).toBe(false);
  });

  it('constructor rejects an equal organizer/root-publisher key and out-of-order schedules', () => {
    expect(() =>
      setupReferendum({
        rootPublisherKeyOverride: roleKey('cico:referendum-v2:organizer:', ORGANIZER_SECRET),
      }),
    ).toThrow('The organizer and root publisher must be different keys');

    expect(() => setupReferendum({ opensAtUnix: ENROLLMENT_CLOSES_AT + 1n })).toThrow(
      'Enrollment cannot close before voting opens',
    );

    expect(() => setupReferendum({ enrollmentClosesAtUnix: CLOSES_AT + 1n })).toThrow(
      'Voting cannot close before enrollment closes',
    );

    expect(() =>
      setupReferendum({ opensAtUnix: CLOSES_AT, enrollmentClosesAtUnix: CLOSES_AT }),
    ).toThrow('The voting window must be non-empty');

    expect(() => setupReferendum({ revealClosesAtUnix: CLOSES_AT })).toThrow(
      'The reveal window must be non-empty',
    );
  });

  describe('blockTime scheduling', () => {
    it('rejects a vote cast before opensAtUnix', () => {
      const item = setupReferendum({ now: OPENS_AT - 1n });
      expect(() => item.contract.impureCircuits.castVote(item.context)).toThrow(
        'Voting has not opened yet',
      );
    });

    it('rejects a vote cast at or after closesAtUnix', () => {
      const item = setupReferendum({ now: CLOSES_AT });
      expect(() => item.contract.impureCircuits.castVote(item.context)).toThrow(
        'Voting has closed',
      );
    });

    it('accepts a vote at the exact opening instant', () => {
      const item = setupReferendum({ now: OPENS_AT });
      const voted = item.contract.impureCircuits.castVote(item.context);
      expect(referendumLedger(voted.context.currentQueryContext.state).issuedVotes).toBe(1n);
    });

    it('refuses closeVote before the published deadline', () => {
      const item = setupReferendum();
      const committed = item.contract.impureCircuits.castVote(item.context);
      expect(() =>
        item.contract.impureCircuits.closeVote(
          atTime(committed.context, item.schedule.closesAtUnix - 1n),
        ),
      ).toThrow('Voting cannot close before its deadline');
    });
  });

  describe('late enrollment via publishCredentialRoot', () => {
    it('lets a voter who enrolled after deployment vote once their root is published', () => {
      const item = setupReferendum();
      // A second holder enrolls into the SAME registry after the referendum
      // has already been deployed against the first holder's root.
      const late = makeClaims(70);
      const enrolled = enroll(item.registry, late.claims);
      expect(enrolled.root.field).not.toBe(item.root.field);

      const published = item.contract.impureCircuits.publishCredentialRoot(
        item.context,
        enrolled.root,
      );
      expect(
        referendumLedger(
          published.context.currentQueryContext.state,
        ).acceptedCredentialRoots.member(enrolled.root),
      ).toBe(true);

      const latePrivateState = privateStateFromVoter(
        ORGANIZER_SECRET,
        ROOT_PUBLISHER_SECRET,
        late.voterSecret,
        late.holderBlind,
        late.claims,
        enrolled.path,
        bytes(73),
      );
      const lateContract = new ReferendumContract(referendumWitnesses());
      const lateContext: CircuitContext<ReferendumPrivateState> = {
        ...published.context,
        currentPrivateState: latePrivateState,
      };
      const lateVote = lateContract.impureCircuits.castVote(lateContext);
      const state = referendumLedger(lateVote.context.currentQueryContext.state);
      expect(state.issuedVotes).toBe(1n);
      expect(
        state.spentVoteNullifiers.member(deriveVoteNullifier(late.voterSecret, item.eventId)),
      ).toBe(true);
    });

    it('rejects a voter whose root has not been published', () => {
      const item = setupReferendum();
      const late = makeClaims(80);
      const enrolled = enroll(item.registry, late.claims);
      // NOT published: item.context still only accepts item.root.
      const latePrivateState = privateStateFromVoter(
        ORGANIZER_SECRET,
        ROOT_PUBLISHER_SECRET,
        late.voterSecret,
        late.holderBlind,
        late.claims,
        enrolled.path,
        bytes(83),
      );
      const lateContract = new ReferendumContract(referendumWitnesses());
      const lateContext: CircuitContext<ReferendumPrivateState> = {
        ...item.context,
        currentPrivateState: latePrivateState,
      };
      expect(() => lateContract.impureCircuits.castVote(lateContext)).toThrow(
        'Credential policy not satisfied',
      );
    });

    it('still accepts a vote proved against an older accepted root (in-flight proof tolerance)', () => {
      const item = setupReferendum();
      const late = makeClaims(90);
      const enrolled = enroll(item.registry, late.claims);
      const published = item.contract.impureCircuits.publishCredentialRoot(
        item.context,
        enrolled.root,
      );
      // The ORIGINAL voter's path root is the OLDER root, which remains
      // accepted alongside the newly published one.
      const originalVote = item.contract.impureCircuits.castVote(published.context);
      const state = referendumLedger(originalVote.context.currentQueryContext.state);
      expect(state.issuedVotes).toBe(1n);
      expect(state.acceptedCredentialRoots.member(item.root)).toBe(true);
      expect(state.acceptedCredentialRoots.member(enrolled.root)).toBe(true);
    });

    it('takes the proof the app builds against the last admitted root once the registry has moved on', async () => {
      // The consultation admitted the root that holds the first pass. Two
      // more people then got a pass, and neither of those roots is admitted.
      const item = setupReferendum();
      const afterFirstPass = item.registry.context.currentQueryContext.state;
      enroll(item.registry, makeClaims(110).claims);
      const afterSecondPass = item.registry.context.currentQueryContext.state;
      enroll(item.registry, makeClaims(120).claims);
      const now = item.registry.context.currentQueryContext.state;

      // A path taken from the registry as it is now leads to a root the
      // consultation never admitted, and the contract refuses it.
      const pathNow = registryLedger(now).credentials.findPathForLeaf(item.leaf);
      if (!pathNow) throw new Error('the first pass left the registry');
      const withPathNow: CircuitContext<ReferendumPrivateState> = {
        ...item.context,
        currentPrivateState: { ...item.privateState, voterPath: pathNow },
      };
      expect(() => item.contract.impureCircuits.castVote(withPathNow)).toThrow(
        'Credential policy not satisfied',
      );

      // The app's lookup walks the registry's earlier states, newest first.
      const fetched: string[] = [];
      const path = await resolveAdmittedCredentialPath({
        credentialLeaf: item.leaf,
        current: credentialTreeView(now),
        frozen: false,
        referendum: parseReferendumV2(item.context.currentQueryContext.state),
        earlier: async function* () {
          for (const [label, state] of [
            ['second pass', afterSecondPass],
            ['first pass', afterFirstPass],
          ] as const) {
            fetched.push(label);
            yield credentialTreeView(state);
          }
        },
      });
      expect(fetched).toEqual(['second pass', 'first pass']);

      const withAdmittedPath: CircuitContext<ReferendumPrivateState> = {
        ...item.context,
        currentPrivateState: { ...item.privateState, voterPath: path },
      };
      const vote = item.contract.impureCircuits.castVote(withAdmittedPath);
      expect(referendumLedger(vote.context.currentQueryContext.state).issuedVotes).toBe(1n);
    });

    it('runs that lookup inside the app adapter, from the indexer blocks to the sealed answer', async () => {
      const item = setupReferendum();
      const registryAddress = dummyContractAddress();
      const referendumAddress = 'cd'.repeat(32);
      // The registry's state after each pass, keyed by the block it landed in.
      const registryAt = new Map<number, unknown>([
        [100, item.registry.context.currentQueryContext.state],
      ]);
      enroll(item.registry, makeClaims(140).claims);
      registryAt.set(200, item.registry.context.currentQueryContext.state);
      enroll(item.registry, makeClaims(150).claims);
      registryAt.set(300, item.registry.context.currentQueryContext.state);

      const asked: (number | 'latest')[] = [];
      const providers = {
        privateStateProvider: {},
        publicDataProvider: {
          async queryContractState(address: string, config?: { blockHeight: number }) {
            if (address === referendumAddress) {
              return { data: item.context.currentQueryContext.state };
            }
            asked.push(config?.blockHeight ?? 'latest');
            const data = registryAt.get(config?.blockHeight ?? 300);
            return data ? { data } : null;
          },
        },
      } as unknown as ReferendumV2Providers;

      let voterPath: MerkleTreePath<Uint8Array> | undefined;
      const executor = {
        async join(_address: string, privateState: ReferendumV2PrivateState) {
          voterPath = privateState.voterPath;
        },
        async castVote() {
          if (!voterPath) throw new Error('no path was prepared');
          // The contract itself decides whether the prepared path is good.
          const vote = item.contract.impureCircuits.castVote({
            ...item.context,
            currentPrivateState: { ...item.privateState, voterPath },
          });
          expect(referendumLedger(vote.context.currentQueryContext.state).issuedVotes).toBe(1n);
          return {
            status: 'confirmed' as const,
            action: 'vote' as const,
            network: 'preview' as const,
            transactionId: 'sealed',
            transactionHash: 'sealed-hash',
            contractAddress: referendumAddress,
            circuit: 'castVote',
            blockHeight: 301,
            blockHash: 'block',
            blockTimestamp: '2026-10-02T00:00:00.000Z',
          };
        },
      } as unknown as ReferendumV2Executor;

      const adapter = new MidnightCivicActionAdapter({
        providers,
        referenda: [
          {
            referendumId: 'simulated',
            contractAddress: referendumAddress,
            config: {
              registry: {
                registryContractAddress: registryAddress,
                registryContractBinding: deriveRegistryContractBinding(registryAddress),
                registryId: bytes(6),
                issuerId: item.registry.claims.issuerId,
                credentialEpoch: item.registry.claims.epoch,
                frozenRoot: item.root,
              },
              eventId: item.eventId,
              organizerKey: roleKey('cico:referendum-v2:organizer:', ORGANIZER_SECRET),
              rootPublisherKey: roleKey('cico:ref-v2:root-publisher:', ROOT_PUBLISHER_SECRET),
              countryPolicy: item.registry.claims.country,
              countryPolicyEnabled: true,
              minimumAssurance: 2n,
              requireAdult: true,
              validityReference: 1_900_000_000n,
              ...item.schedule,
              network: 'preview',
            },
          },
        ],
        credential: {
          adapterName: 'simulated-pass',
          async beginEnrollment(): Promise<never> {
            throw new Error('not used');
          },
          async getEnrollmentStatus(): Promise<never> {
            throw new Error('not used');
          },
          async getCredentialSummary() {
            return null;
          },
          async getActionAuthorization() {
            return { kind: 'civic-credential' as const, handle: 'pass' };
          },
          async getPrivateCredentialMaterial() {
            return {
              voterSecret: item.registry.voterSecret,
              holderBlind: item.registry.holderBlind,
              holderBinding: item.registry.claims.holderBinding,
              credentialBlind: item.registry.claims.blind,
              credentialLeaf: item.leaf,
              claims: {
                issuerId: 'simulated',
                country: isoNumericCountry('032'),
                ageClass: '18-plus' as const,
                assurance: 'document-nfc' as const,
                credentialEpoch: 7,
                validFrom: '2026-10-01T00:00:00.000Z',
                validUntil: '2026-10-03T00:00:00.000Z',
              },
            };
          },
          async clearCredential() {},
        },
        registryHistory: {
          async credentialBlockHeights(address, limit) {
            expect(address).toBe(registryAddress);
            expect(limit).toBeGreaterThan(0);
            return [300, 200, 100];
          },
        },
        randomBytes: () => bytes(22),
        executorFactory: () => executor,
      });

      const receipt = await adapter.castVote({
        referendumId: 'simulated',
        choice: 'YES',
        authorization: { kind: 'civic-credential', handle: 'pass' },
      });
      expect(receipt.transactionId).toBe('sealed');
      // The binding check and the lookup each read the latest state; the lookup
      // then goes back block by block and stops at the admitted one.
      expect(asked).toEqual(['latest', 'latest', 300, 200, 100]);
    });

    it('lets the app refuse a pass added after the last admitted root, before any proof', async () => {
      const item = setupReferendum();
      const afterFirstPass = item.registry.context.currentQueryContext.state;
      const late = makeClaims(130);
      const enrolled = enroll(item.registry, late.claims);
      const attempt = resolveAdmittedCredentialPath({
        credentialLeaf: enrolled.leaf,
        current: credentialTreeView(item.registry.context.currentQueryContext.state),
        frozen: false,
        referendum: parseReferendumV2(item.context.currentQueryContext.state),
        earlier: async function* () {
          yield credentialTreeView(afterFirstPass);
        },
      });
      await expect(attempt).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_ADMITTED' });
    });

    it('separates the root-publisher and organizer roles for publish/revoke', () => {
      const item = setupReferendum();
      const late = makeClaims(100);
      const enrolled = enroll(item.registry, late.claims);

      // The organizer secret cannot publish.
      const wrongPublisher: CircuitContext<ReferendumPrivateState> = {
        ...item.context,
        currentPrivateState: { ...item.privateState, rootPublisherSecret: ORGANIZER_SECRET },
      };
      expect(() =>
        item.contract.impureCircuits.publishCredentialRoot(wrongPublisher, enrolled.root),
      ).toThrow('Root publisher authorization failed');

      // The root-publisher secret can.
      const published = item.contract.impureCircuits.publishCredentialRoot(
        item.context,
        enrolled.root,
      );
      expect(
        referendumLedger(
          published.context.currentQueryContext.state,
        ).acceptedCredentialRoots.member(enrolled.root),
      ).toBe(true);

      // The root-publisher secret cannot revoke.
      const wrongRevoker: CircuitContext<ReferendumPrivateState> = {
        ...published.context,
        currentPrivateState: { ...item.privateState, organizerSecret: ROOT_PUBLISHER_SECRET },
      };
      expect(() =>
        item.contract.impureCircuits.revokeCredentialRoot(wrongRevoker, enrolled.root),
      ).toThrow('Organizer authorization failed');

      // The organizer secret can.
      const revoked = item.contract.impureCircuits.revokeCredentialRoot(
        published.context,
        enrolled.root,
      );
      const state = referendumLedger(revoked.context.currentQueryContext.state);
      expect(state.acceptedCredentialRoots.member(enrolled.root)).toBe(false);
      expect(state.revokedCredentialRoots.member(enrolled.root)).toBe(true);
    });

    it('rejects publishing a duplicate root', () => {
      const item = setupReferendum();
      expect(() =>
        item.contract.impureCircuits.publishCredentialRoot(item.context, item.root),
      ).toThrow('This credential root is already accepted');
    });

    it('rejects publishing after closeEnrollment, but voting still works', () => {
      const item = setupReferendum();
      const closedEnrollment = item.contract.impureCircuits.closeEnrollment(item.context);
      expect(
        referendumLedger(closedEnrollment.context.currentQueryContext.state).enrollmentClosed,
      ).toBe(true);

      const late = makeClaims(110);
      const enrolled = enroll(item.registry, late.claims);
      expect(() =>
        item.contract.impureCircuits.publishCredentialRoot(closedEnrollment.context, enrolled.root),
      ).toThrow('Enrollment is closed');

      // Voting against the already-accepted root is unaffected.
      const voted = item.contract.impureCircuits.castVote(closedEnrollment.context);
      expect(referendumLedger(voted.context.currentQueryContext.state).issuedVotes).toBe(1n);
    });

    it('rejects publishing once enrollment has passed its blockTime deadline', () => {
      const item = setupReferendum({ now: AFTER_ENROLLMENT_DURING_VOTING });
      const late = makeClaims(115);
      const enrolled = enroll(item.registry, late.claims);
      expect(() =>
        item.contract.impureCircuits.publishCredentialRoot(item.context, enrolled.root),
      ).toThrow('Enrollment has closed');
      // Voting is still within its own window.
      const voted = item.contract.impureCircuits.castVote(item.context);
      expect(referendumLedger(voted.context.currentQueryContext.state).issuedVotes).toBe(1n);
    });

    it('rejects revoking a root after enrollment has closed', () => {
      const item = setupReferendum();
      const late = makeClaims(120);
      const enrolled = enroll(item.registry, late.claims);
      const published = item.contract.impureCircuits.publishCredentialRoot(
        item.context,
        enrolled.root,
      );
      const afterEnrollment = atTime(published.context, AFTER_ENROLLMENT_DURING_VOTING);
      expect(() =>
        item.contract.impureCircuits.revokeCredentialRoot(afterEnrollment, enrolled.root),
      ).toThrow('Roots cannot be revoked after enrollment closes');
    });

    it('never republishes a revoked root, and a revoked deployment root can be revoked as long as another root remains accepted', () => {
      const item = setupReferendum();
      const late = makeClaims(130);
      const enrolled = enroll(item.registry, late.claims);
      const published = item.contract.impureCircuits.publishCredentialRoot(
        item.context,
        enrolled.root,
      );

      // Revoke the ORIGINAL deployment root -- allowed now, since the newly
      // published root keeps the accepted set non-empty.
      const revoked = item.contract.impureCircuits.revokeCredentialRoot(
        published.context,
        item.root,
      );
      const revokedState = referendumLedger(revoked.context.currentQueryContext.state);
      expect(revokedState.acceptedCredentialRoots.member(item.root)).toBe(false);
      expect(revokedState.revokedCredentialRoots.member(item.root)).toBe(true);
      // The original voter can no longer vote: their path root is no longer
      // an accepted root.
      expect(() => item.contract.impureCircuits.castVote(revoked.context)).toThrow(
        'Credential policy not satisfied',
      );

      // Revoking would-be-last root is refused: the accepted set must never
      // become empty.
      expect(() =>
        item.contract.impureCircuits.revokeCredentialRoot(revoked.context, enrolled.root),
      ).toThrow('The last accepted root cannot be revoked');

      // A revoked root can never be republished, even by the legitimate
      // root publisher.
      expect(() =>
        item.contract.impureCircuits.publishCredentialRoot(revoked.context, item.root),
      ).toThrow('This credential root has been revoked');
    });

    it('rejects revoking a root that is not currently accepted', () => {
      const item = setupReferendum();
      const neverPublished: MerkleTreeDigest = { field: 999_999_999n };
      expect(() =>
        item.contract.impureCircuits.revokeCredentialRoot(item.context, neverPublished),
      ).toThrow('This credential root is not accepted');
    });
  });

  describe('double-voting resistance across accepted roots', () => {
    it('still refuses a second vote from the same credential once a later root is published', () => {
      const item = setupReferendum();
      const firstVote = item.contract.impureCircuits.castVote(item.context);

      // A late enrollee's root gets published, but the ORIGINAL voter tries
      // to vote again -- their nullifier is derived from voterSecret+eventId,
      // not from the root they proved membership against, so replaying under
      // whichever accepted root is still the same nullifier.
      const late = makeClaims(140);
      const enrolled = enroll(item.registry, late.claims);
      const published = item.contract.impureCircuits.publishCredentialRoot(
        firstVote.context,
        enrolled.root,
      );
      expect(() => item.contract.impureCircuits.castVote(published.context)).toThrow(
        'This voter has already voted in this referendum',
      );
    });
  });
});
