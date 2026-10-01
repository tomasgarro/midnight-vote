/**
 * Prints the values that change when a consultation is deployed, for the two
 * Hostinger projects and for the app build. All of them are public.
 *
 *     node scripts/print-consultation-values.mjs [manifest ...]
 *
 * Give every manifest whose consultations should be live. With none, it reads
 * the test consultation's manifest. Closed consultations are left out of the
 * server values: nothing can be sealed in them, and counting needs no pass.
 *
 * | Printed | Goes to |
 * | --- | --- |
 * | RELAYER_V2_ALLOWED_CONTRACTS | project midnight-civic-relay |
 * | CICO_ACTION_ALLOWED_CONTRACTS, CICO_REFERENDA_JSON | project midnight-rarimo-nfc |
 * | VITE_* | ui/.env.preview.local, read by `vite build --mode preview` |
 */
import { readFileSync } from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length === 0) paths.push('deploy/passport-v2/preview.test.manifest.json');

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
}));

const section = (title, lines) => console.log(`\n# ${title}\n${lines.join('\n')}`);

section('Project midnight-civic-relay', [`RELAYER_V2_ALLOWED_CONTRACTS=${addresses}`]);
section('Project midnight-rarimo-nfc', [
  `CICO_ACTION_ALLOWED_CONTRACTS=${addresses}`,
  `CICO_REFERENDA_JSON=${JSON.stringify(forPublisher)}`,
]);
section('App build (ui/.env.preview.local)', [
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
]);
