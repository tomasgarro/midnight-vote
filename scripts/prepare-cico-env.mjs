/**
 * Writes `cico-service/.env` from a completed Preview deployment manifest.
 *
 *     node scripts/prepare-cico-env.mjs [manifestPath]
 *
 * Two things here are easy to get wrong by hand, and both fail quietly:
 *
 * 1. **The role secrets are not free choices.** The deploy commits
 *    `deriveRoleKey('cico:registry:issuer:', V2_ISSUER_ROLE_SECRET_HEX)` into
 *    the registry (scripts/deploy-passport-v2.mjs). CICO derives the same key
 *    from CICO_ISSUER_ROLE_SECRET, so the two values must be identical or
 *    credential insertion is rejected by a registry we deployed ourselves.
 *    This script copies them; it never generates them.
 *
 * 2. **CICO_REFERENDA_JSON is left empty on purpose.** createRootPublisher()
 *    returns undefined when no referenda are configured (cico-service/src/
 *    server.ts), and the root publisher is the only thing in CICO that submits
 *    a transaction. With it off, CICO issues credentials without ever touching
 *    the chain, so CICO_ISSUER_WALLET_SEED needs no funding — the credential
 *    root is published by the already-funded operator wallet instead. Set
 *    referenda only when you have a third funded, DUST-registered wallet.
 *
 * The issuer wallet seed IS generated fresh: config requires it to be
 * independent of both role secrets, and it holds nothing.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const manifestPath = process.argv[2] ?? 'deploy/passport-v2/preview.manifest.json';
const OUT = 'cico-service/.env';

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (cause) {
  throw new Error(
    `Cannot read ${manifestPath}. A Preview deployment has to land first:
  npm run deploy:preview
Pass a different path as the first argument if the manifest lives elsewhere.`,
    { cause },
  );
}
if (manifest.networkId !== 'preview') {
  throw new Error(`${manifestPath} is for ${manifest.networkId}, not preview`);
}
const registryAddress = manifest.registry?.contractAddress;
if (!registryAddress) {
  throw new Error(
    `${manifestPath} has no registry.contractAddress — the deploy has not landed yet.\n` +
      'Run `npm run deploy:preview` first; a manifest with a null address means nothing is on chain.',
  );
}

/** Reads a value from .env.v2.preview without echoing it. */
const deployEnv = readFileSync('.env.v2.preview', 'utf8');
const fromDeploy = (name) => {
  const match = deployEnv.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!match?.[1]?.trim()) throw new Error(`${name} is not set in .env.v2.preview`);
  return match[1].trim();
};

const issuerRoleSecret = fromDeploy('V2_ISSUER_ROLE_SECRET_HEX');
const rootPublisherSecret = fromDeploy('V2_ROOT_PUBLISHER_ROLE_SECRET_HEX');
const issuerWalletSeed = randomBytes(32).toString('hex');
if (issuerWalletSeed === issuerRoleSecret || issuerWalletSeed === rootPublisherSecret) {
  throw new Error('generated issuer wallet seed collided with a role secret; rerun');
}

const lines = [
  `# Generated ${new Date().toISOString()} by scripts/prepare-cico-env.mjs`,
  `# from ${manifestPath} (commit ${manifest.source?.commit ?? 'unknown'}).`,
  '# Contains secrets. Never commit; never copy into a VITE_* variable.',
  '',
  'CICO_NETWORK=preview',
  'CICO_HOST=127.0.0.1',
  'CICO_PORT=8791',
  'CICO_ALLOWED_ORIGINS=http://localhost:4173,http://localhost:5200',
  'CICO_STATE_DIRECTORY=.cico-state',
  '',
  '# Self-hosted verifier on the local Docker network (the patched derivative).',
  'CICO_RARIMO_BASE_URL=http://127.0.0.1:18080',
  'CICO_RARIMO_PRIVATE_HEADERS_JSON={}',
  '',
  '# Registry binding — from the manifest. Do not edit by hand.',
  `CICO_ISSUER_ID=${manifest.registry.issuerId}`,
  `CICO_ISSUER_ID_HEX=${manifest.registry.issuerIdHex}`,
  `CICO_CREDENTIAL_EPOCH=${manifest.registry.credentialEpoch}`,
  `CICO_REGISTRY_CONTRACT_ADDRESS=${registryAddress}`,
  `CICO_REGISTRY_ID_HEX=${manifest.registry.registryIdHex}`,
  '',
  '# Must equal the deploy values, or the derived role key will not match.',
  `CICO_ISSUER_ROLE_SECRET=${issuerRoleSecret}`,
  `CICO_ROOT_PUBLISHER_SECRET_HEX=${rootPublisherSecret}`,
  '# Independent, and deliberately unfunded — see the header.',
  `CICO_ISSUER_WALLET_SEED=${issuerWalletSeed}`,
  '',
  '# Empty: keeps the root publisher off so CICO submits nothing.',
  'CICO_REFERENDA_JSON=',
  '',
  'CICO_ZK_CONFIG_PATH=../contracts/credential-registry-v1/managed/credential-registry-v1',
  'CICO_REFERENDUM_ZK_CONFIG_PATH=../contracts/referendum-v2/managed/referendum-v2',
  'CICO_PROOF_SERVER_URL=http://localhost:6300',
  `CICO_NODE_URL=${manifest.endpoints.nodeRpc}`,
  `CICO_INDEXER_HTTP_URL=${manifest.endpoints.indexerHttp}`,
  `CICO_INDEXER_WS_URL=${manifest.endpoints.indexerWs}`,
  `CICO_EXPLORER_BASE_URL=${manifest.endpoints.explorer}`,
  '',
  `CICO_CREDENTIAL_TTL_MS=${manifest.runtime?.credentialTtlMs ?? 86400000}`,
  'CICO_MAXIMUM_ISSUANCE_DELAY_MS=600000',
  '',
  `CICO_ACTION_CAPABILITY_SECRET=${randomBytes(32).toString('hex')}`,
  'CICO_ACTION_CAPABILITY_TTL_SECONDS=120',
  'CICO_ACTION_ALLOWED_NETWORKS=preview',
  // Every referendum in the manifest, not only the first: a pass must be able
  // to seal and count an answer in each consultation that is deployed.
  `CICO_ACTION_ALLOWED_CONTRACTS=${(manifest.referenda ?? [])
    .map((referendum) => referendum.contractAddress)
    .filter(Boolean)
    .join(',')}`,
  // castVote seals an answer; revealVote lets the same device count it (ADR-009).
  'CICO_ACTION_ALLOWED_CIRCUITS=castVote,revealVote',
  '',
];

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`wrote ${OUT} from ${manifestPath}`);
console.log(`  registry   ${registryAddress}`);
console.log(`  referendum ${manifest.referenda?.[0]?.contractAddress ?? '(none in manifest)'}`);
console.log('\nRole secrets were copied from .env.v2.preview, not regenerated.');
console.log('CICO_ACTION_CAPABILITY_SECRET must also be set on the relayer as');
console.log('RELAYER_V2_CAPABILITY_SECRET, or walletless votes will be rejected.');
