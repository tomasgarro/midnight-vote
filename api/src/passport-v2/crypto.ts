import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentCommit,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import type { CivicCredentialClaims, CredentialAgeClass, CredentialAssurance } from './types.js';

const bytes32 = new CompactTypeBytes(32);
const vector2 = new CompactTypeVector(2, bytes32);
const vector3 = new CompactTypeVector(3, bytes32);
const vector8 = new CompactTypeVector(8, bytes32);
const textEncoder = new TextEncoder();

export const HOLDER_MATERIAL_BYTES = 32;

export interface CredentialLeafInput {
  readonly holderBinding: Uint8Array;
  readonly claims: CivicCredentialClaims;
  readonly credentialBlind: Uint8Array;
}

export interface RawCredentialLeafInput {
  readonly holderBinding: Uint8Array;
  readonly issuerId: Uint8Array;
  readonly country: Uint8Array;
  readonly ageClass: bigint;
  readonly assurance: bigint;
  readonly credentialEpoch: bigint;
  readonly validUntil: bigint;
  readonly credentialBlind: Uint8Array;
}

/** Mirrors referendum-v2.compact holderBindingFromVoter exactly. */
export function deriveHolderBinding(voterSecret: Uint8Array, holderBlind: Uint8Array): Uint8Array {
  assertBytes32(voterSecret, 'voterSecret');
  assertBytes32(holderBlind, 'holderBlind');
  return persistentCommit(vector2, [padBytes32('cico:holder-bind:v1'), voterSecret], holderBlind);
}

/**
 * Mirrors CredentialRegistryV1 and referendum-v2 credentialLeaf exactly.
 *
 * `validFrom` is intentionally not part of the v1 commitment. Existing
 * CredentialRegistryV1 deployments use this leaf schema and changing it
 * would require a new registry/circuit version and migration. The issuer
 * boundary validates the complete validity window; the deployed contract
 * enforces the committed `validUntil` cutoff during voting.
 */
export function deriveCredentialLeaf(input: CredentialLeafInput): Uint8Array {
  return deriveRawCredentialLeaf({
    holderBinding: input.holderBinding,
    issuerId: padBytes32(input.claims.issuerId),
    country: padBytes32(input.claims.country),
    ageClass: ageClassCode(input.claims.ageClass),
    assurance: assuranceCode(input.claims.assurance),
    credentialEpoch: BigInt(input.claims.credentialEpoch),
    validUntil: isoTimestampSeconds(input.claims.validUntil, 'validUntil'),
    credentialBlind: input.credentialBlind,
  });
}

export function deriveRawCredentialLeaf(input: RawCredentialLeafInput): Uint8Array {
  assertBytes32(input.holderBinding, 'holderBinding');
  assertBytes32(input.issuerId, 'issuerId');
  assertBytes32(input.country, 'country');
  assertBytes32(input.credentialBlind, 'credentialBlind');
  return persistentCommit(
    vector8,
    [
      padBytes32('cico:credential:v1'),
      input.holderBinding,
      input.issuerId,
      input.country,
      uintBytes(input.ageClass),
      uintBytes(input.assurance),
      uintBytes(input.credentialEpoch),
      uintBytes(input.validUntil),
    ],
    input.credentialBlind,
  );
}

/** Mirrors referendum-v2.compact ballotCommitment exactly. */
export function deriveBallotCommitment(
  eventId: Uint8Array,
  choice: 'YES' | 'NO' | 'ABSTAIN',
  voteSalt: Uint8Array,
): Uint8Array {
  assertBytes32(eventId, 'eventId');
  assertBytes32(voteSalt, 'voteSalt');
  const choiceCode = choice === 'YES' ? 0n : choice === 'NO' ? 1n : 2n;
  return persistentCommit(vector2, [eventId, uintBytes(choiceCode)], voteSalt);
}

/** Mirrors referendum-v2.compact voteNullifier exactly. */
export function deriveVoteNullifier(voterSecret: Uint8Array, eventId: Uint8Array): Uint8Array {
  assertBytes32(voterSecret, 'voterSecret');
  assertBytes32(eventId, 'eventId');
  return persistentHash(vector3, [padBytes32('cico:ref-v2:vote-nullifier:'), voterSecret, eventId]);
}

export function deriveRoleKey(domain: string, secret: Uint8Array): Uint8Array {
  assertBytes32(secret, 'role secret');
  return persistentHash(vector2, [padBytes32(domain), secret]);
}

/**
 * Binds a referendum deployment to the exact registry contract address used
 * by the operator. Compact's referendum ledger stores this public digest
 * alongside registryId/root; keeping the address out of the circuit state
 * avoids coupling the vote policy to SDK address wrappers while retaining a
 * deterministic, domain-separated address binding.
 */
export function deriveRegistryContractBinding(registryContractAddress: string): Uint8Array {
  const normalized = registryContractAddress.trim().replace(/^0x/u, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new TypeError('Registry contract address must be exactly 32-byte hexadecimal data');
  }
  return persistentHash(vector2, [
    padBytes32('cico:registry:address:v1'),
    Uint8Array.from(normalized.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)),
  ]);
}

/**
 * The Rarimo event every verification for one registry epoch is made under.
 *
 * A passport proof carries a nullifier that depends on the document and on
 * the event. Under one fixed event a document always shows the same
 * nullifier, so the issuer can tell that a document already has a pass
 * without learning which document it is. Under a fresh event per attempt,
 * which is what the app used to ask for, one document could be verified again
 * and again and collect a pass each time.
 *
 * The event follows from the registry's address and its epoch, both public,
 * so the app and the issuer derive it without telling each other. A new
 * registry or a new epoch is a new event, and every document starts afresh.
 */
export function deriveRarimoEventId(
  registryContractAddress: string,
  credentialEpoch: bigint | number,
): string {
  const epoch = BigInt(credentialEpoch);
  if (epoch < 0n) throw new TypeError('credentialEpoch must not be negative');
  const digest = persistentHash(vector3, [
    padBytes32('cico:rarimo:event:v1'),
    deriveRegistryContractBinding(registryContractAddress),
    convertFieldToBytes(32, epoch, 'credential epoch'),
  ]);
  // Rarimo encodes event_id as a BN254 scalar: 31 bytes are always in range.
  let value = 0n;
  for (const byte of digest.slice(1)) value = (value << 8n) | BigInt(byte);
  return (value === 0n ? 1n : value).toString(10);
}

/** Binds a Rarimo proof request to the exact enrollment and public holder commitment. */
export function deriveRarimoIssuanceEventData(
  enrollmentId: string,
  holderBinding: Uint8Array,
): Uint8Array {
  if (!/^[0-9a-f]{32}$/iu.test(enrollmentId)) {
    throw new TypeError('Rarimo enrollmentId must be exactly 16 bytes of hexadecimal data');
  }
  assertBytes32(holderBinding, 'holderBinding');
  const enrollmentBytes = Uint8Array.from(enrollmentId.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  const paddedEnrollment = new Uint8Array(32);
  paddedEnrollment.set(enrollmentBytes);
  const binding = persistentHash(vector3, [
    padBytes32('cico:rarimo:issuance:v1'),
    paddedEnrollment,
    holderBinding,
  ]);
  // Rarimo encodes event_data as a BN254 scalar. A 31-byte projection is
  // always in range while retaining 248 bits of collision resistance.
  return binding.slice(1);
}

export function ageClassCode(value: CredentialAgeClass): bigint {
  switch (value) {
    case 'unknown':
      return 0n;
    case 'under-18':
      return 1n;
    case '18-plus':
      return 2n;
  }
}

export function assuranceCode(value: CredentialAssurance): bigint {
  switch (value) {
    case 'self-asserted':
      return 0n;
    case 'document':
      return 1n;
    case 'document-nfc':
      return 2n;
    case 'passport-native':
      return 3n;
  }
}

export function isoTimestampSeconds(value: string, label: string): bigint {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds % 1_000 !== 0) {
    throw new TypeError(`${label} must be an ISO timestamp at whole-second precision`);
  }
  const seconds = milliseconds / 1_000;
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new TypeError(`${label} is outside the supported timestamp range`);
  }
  return BigInt(seconds);
}

export function padBytes32(value: string): Uint8Array {
  const encoded = textEncoder.encode(value);
  if (encoded.length > 32) {
    throw new TypeError('Compact Bytes<32> text value exceeds 32 UTF-8 bytes');
  }
  const result = new Uint8Array(32);
  result.set(encoded);
  return result;
}

function uintBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new TypeError('Compact unsigned value must not be negative');
  return convertFieldToBytes(32, value, 'CICO passport v2 scalar');
}

function assertBytes32(value: Uint8Array, label: string): void {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }
}
