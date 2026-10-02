/**
 * Asks the Preview services, from outside, whether a person could answer a
 * consultation now, and says what to change when they could not.
 *
 *     node scripts/check-preview-services.mjs [--json]
 *     npm run check:preview
 *
 * It reads only what is public: the relay's readiness, the credential
 * service's status, the consultations on the chain, and the published app. It
 * needs no secret and changes nothing. Run it after the hPanel sitting, and
 * again before a phone run.
 *
 * The consultations it expects are those of deploy/passport-v2/consultations.json
 * that were deployed from this machine and are still within their counting
 * time. Rehearsals are left out, as everywhere.
 *
 * | Option | Default |
 * | --- | --- |
 * | `--relay <url>` | `https://relay.midnight.vote` |
 * | `--cico <url>` | `apiUrl` of the consultations file |
 * | `--origin <url>` | `https://midnight.vote`, the app |
 *
 * It ends with status 1 when something would stop a person, 0 otherwise.
 */
import { existsSync, readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { loadConsultations, manifestPathFor } from './consultations.mjs';
import { evaluatePreviewServices, summarize } from './preview-checks.mjs';

globalThis.WebSocket ??= WebSocket;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1].replace(/\/+$/u, '') : fallback;
};
const file = loadConsultations();
const relayUrl = option('relay', 'https://relay.midnight.vote');
const cicoUrl = option('cico', file.apiUrl.replace(/\/+$/u, ''));
const appOrigin = option('origin', 'https://midnight.vote');
const asJson = args.includes('--json');

const now = Math.floor(Date.now() / 1000);
const consultations = [];
let registryAddress = null;
let registryEpoch = null;
for (const slug of Object.keys(file.consultations)) {
  if (slug.startsWith('rehearsal') || !existsSync(manifestPathFor(slug))) continue;
  const manifest = JSON.parse(readFileSync(manifestPathFor(slug), 'utf8'));
  if (!registryAddress && manifest.registry?.contractAddress) {
    registryAddress = manifest.registry.contractAddress;
    registryEpoch = manifest.registry.credentialEpoch ?? null;
  }
  for (const referendum of manifest.referenda ?? []) {
    if (referendum.contractAddress && Number(referendum.revealClosesAtUnix) > now) {
      consultations.push({ slug, contractAddress: referendum.contractAddress });
    }
  }
}
if (consultations.length === 0) {
  console.error('No consultation deployed from this machine is still running.');
  process.exit(1);
}

/** One request. A network failure is an observation too, not a crash. */
async function ask(url, init = {}) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    let body = null;
    const type = response.headers.get('content-type') ?? '';
    if (init.method !== 'HEAD' && type.includes('json')) {
      body = await response.json().catch(() => null);
    }
    return {
      status: response.status,
      body,
      html: type.includes('text/html'),
      allowOrigin: response.headers.get('access-control-allow-origin'),
    };
  } catch (error) {
    return { error: error?.cause?.code ?? error?.name ?? 'request failed' };
  }
}

const fromApp = { headers: { origin: appOrigin } };

async function readChain() {
  try {
    const api = await import('../api/dist/index.js');
    const { indexerPublicDataProvider } = await import(
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
    );
    const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
    setNetworkId('preview');
    const provider = indexerPublicDataProvider(
      'https://indexer.preview.midnight.network/api/v4/graphql',
      'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    );
    const registryState = registryAddress
      ? await provider.queryContractState(registryAddress)
      : null;
    const currentRoot = registryState
      ? api.parseCredentialRegistryV1(registryState.data).currentRoot
      : null;
    const rows = [];
    for (const item of consultations) {
      const state = await provider.queryContractState(item.contractAddress);
      if (!state) {
        rows.push({ ...item, missing: true });
        continue;
      }
      const referendum = api.parseReferendumV2(state.data);
      rows.push({
        ...item,
        phase: referendum.phase,
        closed: referendum.closed,
        sealedAnswers: referendum.issuedVotes.toString(),
        enrollmentOpen:
          !referendum.enrollmentClosed && BigInt(now) < referendum.enrollmentClosesAtUnix,
        currentRootAdmitted: currentRoot
          ? api.admitsCredentialRoot(referendum, currentRoot)
          : false,
      });
    }
    return {
      consultations: rows,
      // The event the app asks for verifications under. The service must say the same.
      documentEventId:
        registryAddress && registryEpoch !== null
          ? api.deriveRarimoEventId(registryAddress, Number(registryEpoch))
          : null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'could not be read' };
  }
}

async function readApp() {
  const page = await ask(`${appOrigin}/`);
  if (page.error) return page;
  // What a device fetches to build a proof. The host answers a missing file
  // with the app's own page, so a page here counts as a missing file.
  const paths = [
    '/managed/referendum-v2/keys/castVote.prover',
    '/managed/referendum-v2/keys/revealVote.prover',
    '/managed/referendum-v2/zkir/castVote.bzkir',
    '/zk-params/bls_midnight_2p15',
  ];
  const assets = [];
  for (const path of paths) {
    const answer = await ask(`${appOrigin}${path}`, { method: 'HEAD' });
    assets.push({ path, status: answer.error || answer.html ? 404 : answer.status });
  }
  return { status: page.status, assets };
}

const [relay, cico, chain, app, assistant] = await Promise.all([
  ask(`${relayUrl}/ready`, fromApp),
  ask(`${cicoUrl}/v1/service/status`, fromApp),
  readChain(),
  readApp(),
  ask(`${appOrigin}/Switzerland/api/health`),
]);

const rows = evaluatePreviewServices({
  consultations,
  appOrigin,
  relay,
  cico,
  chain,
  app,
  assistant,
});
const summary = summarize(rows);

if (asJson) {
  console.log(
    JSON.stringify({ relayUrl, cicoUrl, appOrigin, consultations, rows, summary }, null, 2),
  );
} else {
  const mark = { ok: ' ok ', wait: 'WAIT', fail: 'FAIL', unknown: ' ?  ' };
  console.log(`relay ${relayUrl}\ncredential service ${cicoUrl}\napp ${appOrigin}\n`);
  for (const item of rows) {
    console.log(`[${mark[item.verdict]}] ${item.check}: ${item.detail}`);
    if (item.todo) console.log(`         → ${item.todo}`);
  }
  console.log(`\n${summary.line}`);
}
process.exit(summary.failed > 0 ? 1 : 0);
