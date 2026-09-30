/**
 * Witness implementations for the two Compact contracts.
 *
 * A witness is the only way private data enters a circuit. Each function below
 * returns one value from the caller's private state and hands that state back
 * unchanged. Nothing here reads the network, writes storage or logs: the values
 * stay in the process that builds the proof.
 *
 * | Contract                 | Source                                                        |
 * | ------------------------ | ------------------------------------------------------------- |
 * | `credential-registry-v1` | `contracts/credential-registry-v1/credential-registry-v1.compact` |
 * | `referendum-v2`          | `contracts/referendum-v2/referendum-v2.compact`               |
 *
 * The registry witnesses are used by the issuer. The referendum witnesses are
 * used by three different roles (voter, organizer, root publisher), so every
 * value is optional in the private state and each witness fails closed when
 * the role that is proving did not supply it.
 */
import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import type * as GeneratedRegistry from '../generated/credential-registry-v1/index.js';
import * as GeneratedReferendumV2 from '../generated/referendum-v2/index.js';
import type { CredentialRegistryV1PrivateState, ReferendumV2PrivateState } from './midnight-v2.js';
import type { VoteChoice } from './types.js';

/** Issuer-side witnesses for `addCredential` and `freeze`. */
export const credentialRegistryV1Witnesses: GeneratedRegistry.Witnesses<CredentialRegistryV1PrivateState> =
  {
    issuerSecret: (context) => [context.privateState, context.privateState.issuerSecret],
    holderBinding: (context) => [context.privateState, context.privateState.holderBinding],
    credentialBlind: (context) => [context.privateState, context.privateState.credentialBlind],
    credentialCountry: (context) => [context.privateState, context.privateState.credentialCountry],
    credentialAgeClass: (context) => [
      context.privateState,
      context.privateState.credentialAgeClass,
    ],
    credentialAssurance: (context) => [
      context.privateState,
      context.privateState.credentialAssurance,
    ],
    credentialValidUntil: (context) => [
      context.privateState,
      context.privateState.credentialValidUntil,
    ],
  };

/** Voter, organizer and root-publisher witnesses for every referendum circuit. */
export const referendumV2Witnesses: GeneratedReferendumV2.Witnesses<ReferendumV2PrivateState> = {
  organizerSecret: (context) => [
    context.privateState,
    requireBytes(context.privateState, 'organizerSecret'),
  ],
  rootPublisherSecret: (context) => [
    context.privateState,
    requireBytes(context.privateState, 'rootPublisherSecret'),
  ],
  voterSecret: (context) => [
    context.privateState,
    requireBytes(context.privateState, 'voterSecret'),
  ],
  holderBinding: (context) => [
    context.privateState,
    requireBytes(context.privateState, 'holderBinding'),
  ],
  holderBlind: (context) => [
    context.privateState,
    requireBytes(context.privateState, 'holderBlind'),
  ],
  credentialBlind: (context) => [
    context.privateState,
    requireBytes(context.privateState, 'credentialBlind'),
  ],
  credentialCountry: (context) => [
    context.privateState,
    requireBytes(context.privateState, 'credentialCountry'),
  ],
  credentialAgeClass: (context) => [
    context.privateState,
    requireBigInt(context.privateState, 'credentialAgeClass'),
  ],
  credentialAssurance: (context) => [
    context.privateState,
    requireBigInt(context.privateState, 'credentialAssurance'),
  ],
  credentialClaimEpoch: (context) => [
    context.privateState,
    requireBigInt(context.privateState, 'credentialClaimEpoch'),
  ],
  credentialValidUntil: (context) => [
    context.privateState,
    requireBigInt(context.privateState, 'credentialValidUntil'),
  ],
  voterPath: (context) => [context.privateState, requirePath(context.privateState, 'voterPath')],
  voterChoice: (context) => [
    context.privateState,
    choiceToGenerated(requireChoice(context.privateState)),
  ],
  voteSalt: (context) => [context.privateState, requireBytes(context.privateState, 'voteSalt')],
  revealPath: (context) => [context.privateState, requirePath(context.privateState, 'revealPath')],
};

export function choiceToGenerated(choice: VoteChoice): GeneratedReferendumV2.Choice {
  return GeneratedReferendumV2.Choice[choice];
}

function requireBytes(
  state: ReferendumV2PrivateState,
  key:
    | 'organizerSecret'
    | 'rootPublisherSecret'
    | 'voterSecret'
    | 'holderBinding'
    | 'holderBlind'
    | 'credentialBlind'
    | 'credentialCountry'
    | 'voteSalt',
): Uint8Array {
  const value = state[key];
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`Required ${key} witness is unavailable`);
  }
  return value;
}

function requireBigInt(
  state: ReferendumV2PrivateState,
  key:
    | 'credentialAgeClass'
    | 'credentialAssurance'
    | 'credentialClaimEpoch'
    | 'credentialValidUntil',
): bigint {
  const value = state[key];
  if (typeof value !== 'bigint') throw new Error(`Required ${key} witness is unavailable`);
  return value;
}

function requirePath(
  state: ReferendumV2PrivateState,
  key: 'voterPath' | 'revealPath',
): MerkleTreePath<Uint8Array> {
  const value = state[key];
  if (!value) throw new Error(`Required ${key} witness is unavailable`);
  return value;
}

function requireChoice(state: ReferendumV2PrivateState): VoteChoice {
  if (
    state.voterChoice !== 'YES' &&
    state.voterChoice !== 'NO' &&
    state.voterChoice !== 'ABSTAIN'
  ) {
    throw new Error('Required voterChoice witness is unavailable');
  }
  return state.voterChoice;
}
