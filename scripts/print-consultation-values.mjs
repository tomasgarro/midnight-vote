/**
 * Prints the values that change when a consultation is deployed, for the two
 * Hostinger projects and for the app build. All of them are public.
 *
 *     node scripts/print-consultation-values.mjs [--write-app-env] [manifest ...]
 *
 * With --write-app-env it also writes ui/.env.preview.local, the complete
 * public configuration of the app on Preview. Build it with
 * `npm run build:preview --workspace midnight-referendum-ui`.
 *
 * Give the manifests whose consultations should be live. With none, it reads
 * the manifest of every consultation in deploy/passport-v2/consultations.json
 * that has been deployed from this machine. A consultation whose counting is
 * over is left out of the server values: nothing more can be done in it.
 *
 * | Printed | Goes to |
 * | --- | --- |
 * | RELAYER_V2_ALLOWED_CONTRACTS | project midnight-civic-relay |
 * | CICO_ACTION_ALLOWED_CONTRACTS, CICO_REFERENDA_JSON | project midnight-rarimo-nfc |
 * | VITE_* | ui/.env.preview.local, read by `vite build --mode preview` |
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConsultations, manifestPathFor, translationsOf } from './consultations.mjs';

const known = loadConsultations();

const writeAppEnv = process.argv.includes('--write-app-env');
const paths = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
if (paths.length === 0) {
  paths.push(
    ...Object.keys(known.consultations)
      // A rehearsal carries a fixture answer. It never reaches the app or the servers.
      .filter((slug) => !slug.startsWith('rehearsal'))
      .map(manifestPathFor)
      .filter(existsSync),
  );
}
if (paths.length === 0) throw new Error('No consultation has been deployed from this machine');

const manifests = paths.map((path) => {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.networkId !== 'preview') throw new Error(`${path} is not a Preview manifest`);
  if (!manifest.registry?.contractAddress) throw new Error(`${path} has no deployed registry`);
  return manifest;
});
const [first] = manifests;
for (const manifest of manifests) {
  if (manifest.registry.contractAddress !== first.registry.contractAddress) {
    throw new Error('The manifests name different registries; one app build serves one registry');
  }
}

const now = Math.floor(Date.now() / 1000);
const deployed = manifests
  .flatMap((manifest) => manifest.referenda)
  .filter((referendum) => referendum.contractAddress);
if (deployed.length === 0) throw new Error('No consultation in these manifests is deployed yet');
// A consultation leaves the server values once its counting window is over.
const live = deployed.filter((referendum) => Number(referendum.revealClosesAtUnix) > now);
const addresses = live.map((referendum) => referendum.contractAddress).join(',');

// A manifest holds one language. The other languages of a consultation are in
// the consultations file, and travel to the app only.
const copy = Object.fromEntries(
  Object.values(known.consultations)
    .map((consultation) => [consultation.referendumId, translationsOf(consultation)])
    .filter(([, translations]) => translations),
);

const forPublisher = live.map((referendum) => ({
  contractAddress: referendum.contractAddress,
  eventIdHex: referendum.eventIdHex,
  organizerKeyHex: referendum.organizerKeyHex,
  rootPublisherKeyHex: referendum.rootPublisherKeyHex,
  initialRootField: referendum.initialRootField,
  countryPolicy: referendum.countryPolicy,
  minimumAssurance: referendum.minimumAssurance,
  requireAdult: referendum.requireAdult,
  validityReference: referendum.validityReference,
  opensAtUnix: referendum.opensAtUnix,
  enrollmentClosesAtUnix: referendum.enrollmentClosesAtUnix,
  closesAtUnix: referendum.closesAtUnix,
  revealClosesAtUnix: referendum.revealClosesAtUnix,
}));

const forApp = deployed.map((referendum) => ({
  referendumId: referendum.referendumId,
  contractAddress: referendum.contractAddress,
  registryContractBindingHex: referendum.registryContractBindingHex,
  registryContractAddress: referendum.registryContractAddress,
  eventIdHex: referendum.eventIdHex,
  organizerKeyHex: referendum.organizerKeyHex,
  rootPublisherKeyHex: referendum.rootPublisherKeyHex,
  initialRootField: referendum.initialRootField,
  acceptedRoots: referendum.acceptedRoots,
  opensAtUnix: referendum.opensAtUnix,
  enrollmentClosesAtUnix: referendum.enrollmentClosesAtUnix,
  closesAtUnix: referendum.closesAtUnix,
  revealClosesAtUnix: referendum.revealClosesAtUnix,
  countryPolicy: referendum.countryPolicy,
  minimumAssurance: referendum.minimumAssurance,
  requireAdult: referendum.requireAdult,
  validityReference: referendum.validityReference,
  title: referendum.title,
  question: referendum.question,
  ...(referendum.description ? { description: referendum.description } : {}),
  ...(copy[referendum.referendumId] ? { translations: copy[referendum.referendumId] } : {}),
}));

const section = (title, lines) => console.log(`\n# ${title}\n${lines.join('\n')}`);

section('Project midnight-civic-relay', [`RELAYER_V2_ALLOWED_CONTRACTS=${addresses}`]);
section('Project midnight-rarimo-nfc', [
  `CICO_ACTION_ALLOWED_CONTRACTS=${addresses}`,
  `CICO_REFERENDA_JSON=${JSON.stringify(forPublisher)}`,
]);
const appLines = [
  `VITE_PASSPORT_V2_API_URL=${first.runtime.apiUrl}`,
  `VITE_MIDNIGHT_NETWORK=${first.network}`,
  `VITE_CICO_ISSUER_ID=${first.registry.issuerId}`,
  `VITE_CICO_CREDENTIAL_EPOCH=${first.registry.credentialEpoch}`,
  `VITE_CICO_CREDENTIAL_TTL_MS=${first.runtime.credentialTtlMs}`,
  `VITE_RARIMO_UNIQUENESS_TIMESTAMP_UPPER_BOUND=${first.runtime.uniquenessTimestampUpperBoundUnixSeconds}`,
  `VITE_CICO_REGISTRY_ADDRESS=${first.registry.contractAddress}`,
  `VITE_CICO_REGISTRY_CONTRACT_BINDING_HEX=${first.registry.registryContractBindingHex}`,
  `VITE_CICO_REGISTRY_ID_HEX=${first.registry.registryIdHex}`,
  `VITE_CICO_ISSUER_ID_HEX=${first.registry.issuerIdHex}`,
  `VITE_CICO_FROZEN_ROOT_FIELD=${first.registry.frozenRootField ?? ''}`,
  `VITE_CICO_ENROLLMENT_MODEL=${first.registry.enrollmentModel}`,
  `VITE_CICO_REFERENDA_JSON=${JSON.stringify(forApp)}`,
];
section('App build (ui/.env.preview.local)', appLines);

if (writeAppEnv) {
  const out = 'ui/.env.preview.local';
  writeFileSync(
    out,
    [
      `# Written ${new Date().toISOString()} by scripts/print-consultation-values.mjs`,
      `# from ${paths.join(', ')}. Public values only.`,
      'VITE_APP_MODE=preview',
      // The contract of the first prototype. Passport v2 consultations are
      // listed in VITE_CICO_REFERENDA_JSON instead.
      'VITE_MIDNIGHT_CONTRACT_ADDRESS=',
      `VITE_MIDNIGHT_INDEXER_URL=${first.endpoints.indexerHttp}`,
      `VITE_MIDNIGHT_INDEXER_WS_URL=${first.endpoints.indexerWs}`,
      `VITE_MIDNIGHT_EXPLORER_BASE_URL=${first.endpoints.explorer}`,
      'VITE_RELAYER_URL=https://relay.midnight.vote',
      'VITE_HOSTED_PROOF_SERVER_URL=',
      'VITE_ASSISTANT_API_URL=/Switzerland/api',
      'VITE_PASSPORT_ORIGIN=https://midnightpassport.com',
      'VITE_PASSPORT_NETWORK=stagenet',
      ...appLines,
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`\nwrote ${out}`);
}
