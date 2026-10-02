/**
 * What the rehearsal scripts share: the catalogue entry the app would build
 * for a consultation, a device vault kept in a file, and one read of a
 * consultation's public state.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const hex = (bytes) => Buffer.from(bytes).toString('hex');

function bytes32(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/iu.test(value)) {
    throw new TypeError(`${label} must be 32 bytes of hexadecimal`);
  }
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

/** The entry the app builds from its configuration, here built from a deployment manifest. */
export function catalogEntry(api, manifest) {
  const deployed = manifest.referenda?.[0];
  if (!deployed?.contractAddress) throw new Error('The consultation is not deployed yet');
  const registryContractAddress = manifest.registry.contractAddress;
  return {
    referendumId: deployed.referendumId,
    contractAddress: deployed.contractAddress,
    config: {
      registry: {
        registryContractAddress,
        registryContractBinding: api.deriveRegistryContractBinding(registryContractAddress),
        registryId: bytes32(manifest.registry.registryIdHex, 'registry id'),
        issuerId: bytes32(manifest.registry.issuerIdHex, 'issuer id'),
        credentialEpoch: BigInt(manifest.registry.credentialEpoch),
        // An open registry: the consultation is pinned to the root it started from.
        frozenRoot: { field: BigInt(deployed.initialRootField) },
      },
      eventId: bytes32(deployed.eventIdHex, 'event id'),
      organizerKey: bytes32(deployed.organizerKeyHex, 'organizer key'),
      rootPublisherKey: bytes32(deployed.rootPublisherKeyHex, 'root publisher key'),
      opensAtUnix: BigInt(deployed.opensAtUnix),
      enrollmentClosesAtUnix: BigInt(deployed.enrollmentClosesAtUnix),
      closesAtUnix: BigInt(deployed.closesAtUnix),
      revealClosesAtUnix: BigInt(deployed.revealClosesAtUnix),
      countryPolicy: deployed.countryPolicy
        ? api.padBytes32(deployed.countryPolicy)
        : new Uint8Array(32),
      countryPolicyEnabled: deployed.countryPolicy !== null,
      minimumAssurance: BigInt(deployed.minimumAssurance),
      requireAdult: deployed.requireAdult,
      validityReference: BigInt(deployed.validityReference),
      network: 'preview',
      explorerBaseUrl: 'https://explorer.preview.midnight.network/tx',
    },
  };
}

/**
 * The device vault, as a file. It holds a sealed answer and its salt until the
 * answer is counted, as the browser's vault does.
 */
export function fileBallotVault(vaultPath) {
  const read = () =>
    existsSync(vaultPath)
      ? JSON.parse(readFileSync(vaultPath, 'utf8')).map((opening) => ({
          ...opening,
          voteSalt: Uint8Array.from(Buffer.from(opening.voteSalt, 'hex')),
          ballotCommitment: Uint8Array.from(Buffer.from(opening.ballotCommitment, 'hex')),
        }))
      : [];
  const write = (openings) => {
    mkdirSync(dirname(vaultPath), { recursive: true });
    const temporary = `${vaultPath}.${process.pid}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify(
        openings.map((opening) => ({
          ...opening,
          voteSalt: hex(opening.voteSalt),
          ballotCommitment: hex(opening.ballotCommitment),
        })),
      ),
      { encoding: 'utf8', mode: 0o600 },
    );
    renameSync(temporary, vaultPath);
  };
  return {
    list: async (referendumId) => read().filter((opening) => opening.referendumId === referendumId),
    save: async (opening) => {
      const commitment = hex(opening.ballotCommitment);
      write([...read().filter((held) => hex(held.ballotCommitment) !== commitment), opening]);
    },
    clear: async (referendumId) =>
      write(read().filter((opening) => opening.referendumId !== referendumId)),
  };
}

/** A consultation's public state, as anybody can read it from the indexer. */
export async function readPublicState(api, publicDataProvider, contractAddress) {
  const canonical = await publicDataProvider.queryContractState(contractAddress);
  if (!canonical) throw new Error('The consultation has no state on the indexer');
  const state = api.parseReferendumV2(canonical.data);
  return {
    phase: state.phase,
    closed: state.closed,
    sealedAnswers: state.issuedVotes.toString(),
    tally: Object.fromEntries([...state.tally].map(([key, value]) => [key, value.toString()])),
    acceptedRoots: state.acceptedCredentialRoots.length,
  };
}
