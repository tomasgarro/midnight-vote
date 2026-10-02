import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type {
  ChargedState,
  MerkleTreeDigest,
  MerkleTreePath,
} from '@midnight-ntwrk/compact-runtime';
import * as GeneratedRegistry from '../generated/credential-registry-v1/index.js';
import * as GeneratedReferendumV2 from '../generated/referendum-v2/index.js';
import { deriveRegistryContractBinding } from './crypto.js';
import { CivicCredentialError, type VoteChoice } from './types.js';
import { credentialRegistryV1Witnesses, referendumV2Witnesses } from './witnesses.js';

export { choiceToGenerated } from './witnesses.js';

export const CREDENTIAL_REGISTRY_V1_PRIVATE_STATE_ID = 'credentialRegistryV1PrivateState' as const;
export const REFERENDUM_V2_PRIVATE_STATE_ID = 'referendumV2PrivateState' as const;

export interface CredentialRegistryV1PrivateState {
  readonly issuerSecret: Uint8Array;
  readonly holderBinding: Uint8Array;
  readonly credentialBlind: Uint8Array;
  readonly credentialCountry: Uint8Array;
  readonly credentialAgeClass: bigint;
  readonly credentialAssurance: bigint;
  readonly credentialClaimEpoch: bigint;
  readonly credentialValidUntil: bigint;
}

export interface ReferendumV2PrivateState {
  readonly role: 'voter' | 'organizer';
  readonly organizerSecret?: Uint8Array;
  readonly rootPublisherSecret?: Uint8Array;
  readonly voterSecret?: Uint8Array;
  readonly holderBinding?: Uint8Array;
  readonly holderBlind?: Uint8Array;
  readonly credentialBlind?: Uint8Array;
  readonly credentialCountry?: Uint8Array;
  readonly credentialAgeClass?: bigint;
  readonly credentialAssurance?: bigint;
  readonly credentialClaimEpoch?: bigint;
  readonly credentialValidUntil?: bigint;
  readonly voterPath?: MerkleTreePath<Uint8Array>;
  readonly voterChoice?: VoteChoice;
  readonly voteSalt?: Uint8Array;
  readonly revealPath?: MerkleTreePath<Uint8Array>;
}

export interface CredentialRegistryV1State {
  readonly registryId: Uint8Array;
  readonly issuerId: Uint8Array;
  readonly credentialEpoch: bigint;
  /** Current canonical tree root, which may differ from frozenRoot before freeze. */
  readonly currentRoot: MerkleTreeDigest;
  readonly frozenRoot: MerkleTreeDigest;
  readonly frozen: boolean;
  readonly credentialCount: bigint;
}

export interface ReferendumV2State {
  readonly registryId: Uint8Array;
  readonly issuerId: Uint8Array;
  readonly credentialEpoch: bigint;
  /** Sealed provenance root observed at deployment; not necessarily still accepted. */
  readonly initialCredentialRoot: MerkleTreeDigest;
  /** Every registry root this referendum currently accepts voters against. */
  readonly acceptedCredentialRoots: readonly MerkleTreeDigest[];
  /** Roots the organizer has revoked; a revoked root no longer admits new votes. */
  readonly revokedCredentialRoots: readonly MerkleTreeDigest[];
  /** True once the organizer has permanently closed enrollment. */
  readonly enrollmentClosed: boolean;
  readonly registryContractBinding: Uint8Array;
  /** Raw registry contract address bytes, as recorded on the referendum ledger. */
  readonly registryContract: Uint8Array;
  readonly eventId: Uint8Array;
  readonly organizerKey: Uint8Array;
  /** Public key authorized to publish/revoke accepted credential roots. */
  readonly rootPublisherKey: Uint8Array;
  readonly opensAtUnix: bigint;
  readonly enrollmentClosesAtUnix: bigint;
  readonly closesAtUnix: bigint;
  readonly revealClosesAtUnix: bigint;
  readonly phase: 'COMMIT' | 'REVEAL' | 'FINALIZED';
  readonly closed: boolean;
  /** Number of accepted commitments; this is separate from revealed tally. */
  readonly issuedVotes: bigint;
  readonly countryPolicy: Uint8Array;
  readonly countryPolicyEnabled: boolean;
  readonly minimumAssurance: bigint;
  readonly requireAdult: boolean;
  readonly validityReference: bigint;
  readonly tally: ReadonlyMap<VoteChoice, bigint>;
}

/** Canonical, public registry data that a referendum deployment must pin. */
export interface FrozenCredentialRegistryReference {
  readonly registryContractAddress: string;
  readonly registryContractBinding: Uint8Array;
  readonly registryId: Uint8Array;
  readonly issuerId: Uint8Array;
  readonly credentialEpoch: bigint;
  readonly frozenRoot: MerkleTreeDigest;
}

export interface ReferendumV2RegistryBinding {
  readonly registryId: Uint8Array;
  readonly issuerId: Uint8Array;
  readonly credentialEpoch: bigint;
  /** Sealed provenance root the referendum was deployed against. */
  readonly initialCredentialRoot: MerkleTreeDigest;
  readonly registryContractBinding: Uint8Array;
}

export function createCompiledCredentialRegistryV1() {
  return CompiledContract.make<
    GeneratedRegistry.Contract<CredentialRegistryV1PrivateState>,
    CredentialRegistryV1PrivateState
  >('credential-registry-v1', GeneratedRegistry.Contract).pipe(
    CompiledContract.withWitnesses(credentialRegistryV1Witnesses),
    CompiledContract.withCompiledFileAssets('managed/credential-registry-v1'),
  );
}

export function createCompiledReferendumV2() {
  return CompiledContract.make<
    GeneratedReferendumV2.Contract<ReferendumV2PrivateState>,
    ReferendumV2PrivateState
  >('referendum-v2', GeneratedReferendumV2.Contract).pipe(
    CompiledContract.withWitnesses(referendumV2Witnesses),
    CompiledContract.withCompiledFileAssets('managed/referendum-v2'),
  );
}

export function parseCredentialRegistryV1(data: ChargedState): CredentialRegistryV1State {
  const ledger = GeneratedRegistry.ledger(data);
  return {
    registryId: ledger.registryId,
    issuerId: ledger.issuerId,
    credentialEpoch: ledger.credentialEpoch,
    currentRoot: ledger.credentials.root(),
    frozenRoot: ledger.frozenRoot,
    frozen: ledger.frozen,
    credentialCount: ledger.credentialCount,
  };
}

export function findCredentialPath(
  data: ChargedState,
  credentialLeaf: Uint8Array,
): MerkleTreePath<Uint8Array> {
  const path = GeneratedRegistry.ledger(data).credentials.findPathForLeaf(credentialLeaf);
  if (!path) throw new Error('Credential is not present in the canonical registry');
  return path;
}

/** Resolves the public path of a ballot commitment in the referendum's ballot tree. */
export function findBallotPath(
  data: ChargedState,
  ballotCommitment: Uint8Array,
): MerkleTreePath<Uint8Array> {
  const path =
    GeneratedReferendumV2.ledger(data).ballotCommitments.findPathForLeaf(ballotCommitment);
  if (!path) throw new Error('Ballot commitment is not present in the canonical referendum');
  return path;
}

/**
 * True once a ballot commitment has been counted. Used by the voter's own
 * device to recognise a count that landed before the device could record it.
 */
export function isBallotRevealed(data: ChargedState, ballotCommitment: Uint8Array): boolean {
  return GeneratedReferendumV2.ledger(data).revealedCommitments.member(ballotCommitment);
}

export function parseReferendumV2(data: ChargedState): ReferendumV2State {
  const ledger = GeneratedReferendumV2.ledger(data);
  const phase = ['COMMIT', 'REVEAL', 'FINALIZED'][Number(ledger.phase)] as
    | ReferendumV2State['phase']
    | undefined;
  if (!phase) throw new Error('Canonical referendum has an unknown phase');
  return {
    registryId: ledger.registryId,
    issuerId: ledger.issuerId,
    credentialEpoch: ledger.credentialEpoch,
    initialCredentialRoot: ledger.initialCredentialRoot,
    acceptedCredentialRoots: [...ledger.acceptedCredentialRoots],
    revokedCredentialRoots: [...ledger.revokedCredentialRoots],
    enrollmentClosed: ledger.enrollmentClosed,
    registryContractBinding: ledger.registryContractBinding,
    registryContract: ledger.registryContract.bytes,
    eventId: ledger.eventId,
    organizerKey: ledger.organizerKey,
    rootPublisherKey: ledger.rootPublisherKey,
    opensAtUnix: ledger.opensAtUnix,
    enrollmentClosesAtUnix: ledger.enrollmentClosesAtUnix,
    closesAtUnix: ledger.closesAtUnix,
    revealClosesAtUnix: ledger.revealClosesAtUnix,
    phase,
    closed: ledger.closed,
    issuedVotes: ledger.issuedVotes,
    countryPolicy: ledger.countryPolicy,
    countryPolicyEnabled: ledger.countryPolicyEnabled,
    minimumAssurance: ledger.minimumAssurance,
    requireAdult: ledger.requireAdult,
    validityReference: ledger.validityReference,
    tally: new Map<VoteChoice, bigint>([
      ['YES', ledger.tally.lookup(GeneratedReferendumV2.Choice.YES)],
      ['NO', ledger.tally.lookup(GeneratedReferendumV2.Choice.NO)],
      ['ABSTAIN', ledger.tally.lookup(GeneratedReferendumV2.Choice.ABSTAIN)],
    ]),
  };
}

export function createFrozenCredentialRegistryReference(
  registryContractAddress: string,
  state: CredentialRegistryV1State,
): FrozenCredentialRegistryReference {
  const registryContractBinding = deriveRegistryContractBinding(registryContractAddress);
  if (!state.frozen) throw new Error('Credential registry must be canonically frozen');
  if (state.frozenRoot.field !== state.currentRoot.field) {
    throw new Error('Credential registry must freeze its current canonical root');
  }
  return {
    registryContractAddress,
    registryContractBinding,
    registryId: new Uint8Array(state.registryId),
    issuerId: new Uint8Array(state.issuerId),
    credentialEpoch: state.credentialEpoch,
    frozenRoot: { field: state.frozenRoot.field },
  };
}

/**
 * The registry reference of a consultation whose registry keeps enrolling.
 *
 * Such a registry never freezes, so it has no frozen root to pin. The root
 * here is the one the consultation recorded when it was deployed. The
 * registry's own root moves on with every pass that is issued.
 */
export function createOpenCredentialRegistryReference(
  registryContractAddress: string,
  state: CredentialRegistryV1State,
  initialCredentialRoot: MerkleTreeDigest,
): FrozenCredentialRegistryReference {
  if (state.frozen) {
    throw new Error('Credential registry is frozen; its frozen root must be pinned instead');
  }
  return {
    registryContractAddress,
    registryContractBinding: deriveRegistryContractBinding(registryContractAddress),
    registryId: new Uint8Array(state.registryId),
    issuerId: new Uint8Array(state.issuerId),
    credentialEpoch: state.credentialEpoch,
    frozenRoot: { field: initialCredentialRoot.field },
  };
}

/** What a consultation says on chain about its registry and the roots it admits. */
export type ReferendumV2AdmissionState = ReferendumV2RegistryBinding &
  Pick<ReferendumV2State, 'acceptedCredentialRoots' | 'revokedCredentialRoots'>;

/**
 * Checked on the person's device before a proof is built: the consultation on
 * chain is bound to the registry the catalogue names, and it admits the passes
 * that registry holds now.
 *
 * A frozen registry is pinned by its frozen root. An open one is pinned by its
 * address, its ID, its issuer and its epoch, and the consultation must have
 * admitted the registry's current root: a pass issued after the last admitted
 * root cannot be proven yet, and a proof built now would be refused on chain.
 */
export function assertCanonicalReferendumBinding(
  catalogRegistry: FrozenCredentialRegistryReference,
  registry: CredentialRegistryV1State,
  referendum: ReferendumV2AdmissionState,
): void {
  const reference = registry.frozen
    ? createFrozenCredentialRegistryReference(catalogRegistry.registryContractAddress, registry)
    : createOpenCredentialRegistryReference(
        catalogRegistry.registryContractAddress,
        registry,
        referendum.initialCredentialRoot,
      );
  assertReferendumRegistryBinding(reference, {
    registryContractBinding: catalogRegistry.registryContractBinding,
    registryId: catalogRegistry.registryId,
    issuerId: catalogRegistry.issuerId,
    credentialEpoch: catalogRegistry.credentialEpoch,
    initialCredentialRoot: catalogRegistry.frozenRoot,
  });
  assertReferendumRegistryBinding(reference, referendum);
  if (registry.frozen) return;

  const current = registry.currentRoot.field;
  const admitted =
    referendum.acceptedCredentialRoots.some((root) => root.field === current) &&
    !referendum.revokedCredentialRoots.some((root) => root.field === current);
  if (!admitted) {
    throw new CivicCredentialError(
      'CREDENTIAL_NOT_ADMITTED',
      'This consultation has not admitted the latest passes yet. Try again in a few minutes.',
      true,
    );
  }
}

/** Prevents deploying a referendum against an arbitrary or stale registry root. */
export function assertReferendumRegistryBinding(
  reference: FrozenCredentialRegistryReference,
  binding: ReferendumV2RegistryBinding,
): void {
  if (!equalBytes(reference.registryId, binding.registryId)) {
    throw new Error('Referendum registry ID does not match the frozen registry');
  }
  if (!equalBytes(reference.issuerId, binding.issuerId)) {
    throw new Error('Referendum issuer ID does not match the frozen registry');
  }
  if (reference.credentialEpoch !== binding.credentialEpoch) {
    throw new Error('Referendum credential epoch does not match the frozen registry');
  }
  if (reference.frozenRoot.field !== binding.initialCredentialRoot.field) {
    throw new Error('Referendum root does not match the canonical frozen registry root');
  }
  const expectedRegistryContractBinding = deriveRegistryContractBinding(
    reference.registryContractAddress,
  );
  if (!equalBytes(expectedRegistryContractBinding, binding.registryContractBinding)) {
    throw new Error('Referendum registry contract binding does not match the frozen registry');
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
