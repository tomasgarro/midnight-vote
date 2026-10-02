/**
 * Rehearses a person's journey on Midnight Preview without a passport: seal an
 * answer, and later count it, through the code the app runs.
 *
 *     node --env-file-if-exists=relayer/.env --env-file-if-exists=.env.v2.preview \
 *       scripts/rehearse-citizen-journey.mjs <slug> status|seal|count [YES|NO|ABSTAIN]
 *
 * It exists to find what breaks before a person stands there with a passport.
 * It drives `MidnightCivicActionAdapter`, the adapter the browser uses: the
 * check of the consultation against the chain, the membership path, the proof,
 * the relay, the opening kept on the device, and the count by its owner.
 *
 * What is not real, and is said wherever the result is shown:
 *
 * - The pass is the operator's fixture pass, issued when the registry was
 *   deployed. No document was read for it.
 * - The relay's capability is signed here with the operator's own secret. In
 *   production the credential service signs it, and only for a pass it issued.
 *
 * For those two reasons it runs only on a consultation whose slug starts with
 * `rehearsal`. A consultation that people answer never receives a fixture
 * answer: its count must mean people.
 *
 * It needs a relayer on this machine (`npm run start --workspace
 * midnight-referendum-relayer`) that allows the consultation's contract and
 * both citizen circuits, and a proof server on port 6300.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { loadConsultations, manifestPathFor } from './consultations.mjs';

globalThis.WebSocket ??= WebSocket;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [slug, command = 'status', choiceArgument = 'YES'] = process.argv.slice(2);

const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required`);
  return value;
};
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const bytes32 = (value, label) => {
  if (!/^[0-9a-f]{64}$/iu.test(value)) fail(`${label} must be 32 bytes of hexadecimal`);
  return Uint8Array.from(Buffer.from(value, 'hex'));
};

const file = loadConsultations();
const consultation = slug ? file.consultations[slug] : undefined;
if (!consultation)
  fail(`Unknown consultation. Known: ${Object.keys(file.consultations).join(', ')}`);
if (!slug.startsWith('rehearsal')) {
  fail(
    `"${slug}" is a consultation for people. A fixture answer would be counted beside theirs.\n` +
      'Rehearse on a consultation whose slug starts with "rehearsal".',
  );
}
if (!['status', 'seal', 'count'].includes(command)) fail('The command is status, seal or count');
if (!['YES', 'NO', 'ABSTAIN'].includes(choiceArgument)) fail('The answer is YES, NO or ABSTAIN');

const manifestPath = resolve(ROOT, manifestPathFor(slug));
if (!existsSync(manifestPath))
  fail(`${manifestPathFor(slug)} is missing: deploy the consultation first`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const deployed = manifest.referenda[0];
if (!deployed?.contractAddress) fail('The consultation is not deployed yet');

const api = await import('../api/dist/index.js');
const { NodeZkConfigProvider } = await import(
  '@midnight-ntwrk/midnight-js-node-zk-config-provider'
);
const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
const { loadConfig } = await import('../relayer/dist/config.js');
const { signV2Capability } = await import('../relayer/dist/v2-capability.js');

setNetworkId('preview');
const relayer = loadConfig();
if (relayer.networkId !== 'preview') fail('relayer/.env is not for Preview');
if (relayer.v2CapabilitySecret.length < 32) fail('RELAYER_V2_CAPABILITY_SECRET is not set');
const relayUrl = `http://${relayer.host}:${relayer.port}`;

// The same entry the app builds from its configuration.
const registryContractAddress = manifest.registry.contractAddress;
const entry = {
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

// The operator's fixture pass. Its private material is read from the
// environment and is never written anywhere by this script.
const holderSecret = bytes32(required('V2_FIXTURE_HOLDER_SECRET_HEX'), 'holder secret');
const holderBlind = bytes32(required('V2_FIXTURE_HOLDER_BLIND_HEX'), 'holder blind');
const credentialBlind = bytes32(required('V2_FIXTURE_CREDENTIAL_BLIND_HEX'), 'credential blind');
const claims = {
  issuerId: manifest.registry.issuerId,
  country: api.isoNumericCountry(process.env.V2_FIXTURE_COUNTRY?.trim() || '032'),
  ageClass: process.env.V2_FIXTURE_AGE_CLASS?.trim() || '18-plus',
  assurance: process.env.V2_FIXTURE_ASSURANCE?.trim() || 'document-nfc',
  credentialEpoch: Number(manifest.registry.credentialEpoch),
  validFrom: required('V2_FIXTURE_VALID_FROM'),
  validUntil: required('V2_FIXTURE_VALID_UNTIL'),
};
const holderBinding = api.deriveHolderBinding(holderSecret, holderBlind);
const material = {
  voterSecret: holderSecret,
  holderBlind,
  holderBinding,
  credentialBlind,
  credentialLeaf: api.deriveCredentialLeaf({ holderBinding, claims, credentialBlind }),
  claims,
};
const authorization = { kind: 'civic-credential', handle: `fixture:${deployed.referendumId}` };
const credential = {
  getActionAuthorization: async () => authorization,
  getPrivateCredentialMaterial: async () => material,
};

// The device vault, as a file. It holds the fixture answer and its salt until
// the answer is counted. A second fixture pass is a second person, so it gets
// its own device: name it with REHEARSAL_DEVICE.
const device = process.env.REHEARSAL_DEVICE?.trim() ?? '';
if (device && !/^[a-z0-9-]+$/u.test(device)) fail('REHEARSAL_DEVICE is letters, digits and dashes');
const vaultPath = resolve(ROOT, `.state/rehearsal-vault.${slug}${device ? `.${device}` : ''}.json`);
const readVault = () =>
  existsSync(vaultPath)
    ? JSON.parse(readFileSync(vaultPath, 'utf8')).map((opening) => ({
        ...opening,
        voteSalt: Uint8Array.from(Buffer.from(opening.voteSalt, 'hex')),
        ballotCommitment: Uint8Array.from(Buffer.from(opening.ballotCommitment, 'hex')),
      }))
    : [];
const writeVault = (openings) => {
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
const ballotOpenings = {
  list: async (referendumId) =>
    readVault().filter((opening) => opening.referendumId === referendumId),
  save: async (opening) => {
    const commitment = hex(opening.ballotCommitment);
    writeVault([
      ...readVault().filter((held) => hex(held.ballotCommitment) !== commitment),
      opening,
    ]);
  },
  clear: async (referendumId) =>
    writeVault(readVault().filter((opening) => opening.referendumId !== referendumId)),
};

// Signs what the credential service signs in production, with the operator's
// secret, for this consultation's contract and the two citizen circuits only.
const capabilityIssuer = {
  issuerOrigin: 'http://127.0.0.1',
  async issue(request) {
    if (
      request?.network !== 'preview' ||
      request.contractAddress !== deployed.contractAddress ||
      !['castVote', 'revealVote'].includes(request.circuit) ||
      request.action !== 'vote' ||
      request.credentialAuthorization !== authorization.handle
    ) {
      throw new Error('the rehearsal issuer refuses this capability request');
    }
    return signV2Capability(
      {
        actionId: request.actionId,
        idempotencyKey: request.idempotencyKey,
        network: 'preview',
        contractAddress: deployed.contractAddress,
        circuit: request.circuit,
        action: 'vote',
        requestHash: String(request.requestHash).toLowerCase(),
        expiresAt: Math.floor(Date.now() / 1_000) + 600,
      },
      relayer.v2CapabilitySecret,
    );
  },
};

const runtime = await api.createReferendumV2WalletlessProviders({
  relayUrl,
  proofServerUri: relayer.provingServerUrl,
  networkId: 'preview',
  indexerUri: relayer.indexerHttpUrl,
  indexerWsUri: relayer.indexerWsUrl,
  capabilityIssuer,
  zkConfigProvider: new NodeZkConfigProvider(
    resolve(ROOT, 'contracts/referendum-v2/managed/referendum-v2'),
  ),
});
const adapter = new api.MidnightCivicActionAdapter({
  providers: runtime.providers,
  credential,
  referenda: [entry],
  randomBytes: (length) => Uint8Array.from(randomBytes(length)),
  actionExecutionContext: runtime.actionContext,
  ballotOpenings,
  registryHistory: api.createIndexerRegistryHistory({ indexerUri: relayer.indexerHttpUrl }),
});

async function publicState() {
  const canonical = await runtime.providers.publicDataProvider.queryContractState(
    deployed.contractAddress,
  );
  if (!canonical) fail('The consultation has no state on the indexer');
  const state = api.parseReferendumV2(canonical.data);
  return {
    phase: state.phase,
    closed: state.closed,
    sealedAnswers: state.issuedVotes.toString(),
    tally: Object.fromEntries([...state.tally].map(([key, value]) => [key, value.toString()])),
    acceptedRoots: state.acceptedCredentialRoots.length,
  };
}

const started = Date.now();
const seconds = () => `${Math.round((Date.now() - started) / 1000)} s`;
console.log(`consultation ${deployed.referendumId} at ${deployed.contractAddress}`);
console.log('before:', JSON.stringify(await publicState()));

let refused = false;
try {
  if (command === 'seal') {
    const receipt = await adapter.castVote({
      referendumId: deployed.referendumId,
      choice: choiceArgument,
      authorization,
    });
    console.log(`sealed in ${seconds()}: transaction ${receipt.transactionId}`);
    console.log('receipt:', JSON.stringify({ ...receipt, choice: undefined }));
  } else if (command === 'count') {
    const receipt = await adapter.revealVote({
      referendumId: deployed.referendumId,
      authorization,
    });
    console.log(`counted in ${seconds()}: transaction ${receipt.transactionId}`);
  } else {
    console.log('this device:', await adapter.getSealedAnswerStatus(deployed.referendumId));
  }
} catch (error) {
  // A refusal the app would show to a person is a result of the rehearsal,
  // not a crash. Anything else is.
  if (!api.isCivicCredentialError(error)) throw error;
  refused = true;
  console.log(
    `refused after ${seconds()}: ${error.code}${error.retryable ? ' (worth retrying)' : ''}: ${error.message}`,
  );
}

console.log('after: ', JSON.stringify(await publicState()));
process.exit(refused ? 2 : 0);
