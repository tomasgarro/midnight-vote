/**
 * A dress rehearsal of the whole journey a person makes, without a passport
 * and without touching the registry people use.
 *
 *     node scripts/rehearse-with-stand-in-verifier.mjs prepare [passes answers counting]
 *     node scripts/rehearse-with-stand-in-verifier.mjs journey [YES|NO|ABSTAIN] [alpha-3 country]
 *     node scripts/rehearse-with-stand-in-verifier.mjs operate
 *     node scripts/rehearse-with-stand-in-verifier.mjs count
 *     node scripts/rehearse-with-stand-in-verifier.mjs forget-confirmation
 *
 * | Variable | Effect |
 * | --- | --- |
 * | `REHEARSAL_RUN=<label>` | Another run, with a registry and a consultation of its own. A consultation's deadlines are fixed, so each run needs one |
 * | `REHEARSAL_DEVICE=<label>` | Another device, so another person. The same label again is the same device |
 * | `REHEARSAL_DROP=issuing` | `journey` ends while the pass is being issued, as a phone drops a page. `journey` again is the page coming back |
 * | `REHEARSAL_DOCUMENT=<label>` | The document that is scanned. Without it each device scans a document of its own. The same label on two devices is one person on two devices |
 * | `REHEARSAL_RENEW=1` | `journey` asks for a new pass although the device holds one, as when a pass has expired |
 *
 * `forget-confirmation` puts the device's answer back to "sealing", as on a
 * device that never saw its answer confirmed. `journey` must then find the
 * answer on chain and refuse to seal a second one.
 *
 * What runs for real: the credential service and the relayer of this
 * repository, as processes on this machine, configured as on the server; the
 * app's own HTTP ports, credential adapter and action adapter; the proofs;
 * every transaction, on Midnight Preview.
 *
 * What stands in:
 *
 * | Stand-in | For | Consequence |
 * | --- | --- | --- |
 * | A verifier on loopback that answers "verified" | The passport verifier and the RariMe scan | No document is read. The pass it leads to proves nothing about anybody |
 * | Midnight's proof server on this machine | The proof a phone builds in the browser | Proving time says nothing about a phone |
 * | A session object | Midnight Passport sign-in | The sign-in is not exercised |
 *
 * Because the pass is not a person's, the rehearsal has a registry of its
 * own. `prepare` deploys that registry and one consultation on it, and the
 * script refuses to run against the registry named in consultations.json. The
 * stand-in verifier listens on loopback only, and the credential service
 * accepts a plain-HTTP verifier on loopback only, so a service on a server
 * cannot be pointed at it.
 *
 * `prepare` prints how to start the two services. `journey` then enrols a
 * pass through the credential service, waits for its root to be admitted, and
 * seals an answer through the relay with a capability the credential service
 * signed. `operate` closes the consultation once answers are over and
 * finalizes it once counting is over. `count` counts the sealed answer.
 *
 * The credential service is given the operator's funded wallet. Do not run
 * `operate` while `journey` is running: two processes must not spend from one
 * wallet at the same moment.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { loadConsultations } from './consultations.mjs';
import { catalogEntry, fileBallotVault, readPublicState } from './rehearsal-lib.mjs';

globalThis.WebSocket ??= WebSocket;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A consultation's deadlines are fixed when it is deployed, so a rehearsal can
// be run once. REHEARSAL_RUN names another run, with a registry, a
// consultation and service files of its own.
const RUN = process.env.REHEARSAL_RUN?.trim() ?? '';
if (RUN && !/^[a-z0-9-]+$/u.test(RUN)) {
  console.error('REHEARSAL_RUN is letters, digits and dashes');
  process.exit(1);
}
const SLUG = RUN ? `rehearsal-dress-${RUN}` : 'rehearsal-dress';
const DEPLOY_ENV = `.env.v2.preview.${SLUG}`;
const MANIFEST = `deploy/passport-v2/preview.${SLUG}.manifest.json`;
const CICO_ENV = `.env.cico-dress${RUN ? `-${RUN}` : ''}.local`;
const CICO_STATE = `.state/cico-dress${RUN ? `-${RUN}` : ''}`;
// One file is one device. A second journey is a second person: give it its own
// device with REHEARSAL_DEVICE, and name the same device again to count.
const DEVICE = process.env.REHEARSAL_DEVICE?.trim() ?? '';
if (DEVICE && !/^[a-z0-9-]+$/u.test(DEVICE)) {
  console.error('REHEARSAL_DEVICE is letters, digits and dashes');
  process.exit(1);
}
const ON_DEVICE = `${SLUG}${DEVICE ? `.${DEVICE}` : ''}`;
const VAULT = `.state/rehearsal-vault.${ON_DEVICE}.json`;
// What the browser keeps in its encrypted vault: the pass, and a verification
// in progress. As files, so that a second process is the same device with a
// page that started again.
const PASS_FILE = `.state/rehearsal-pass.${ON_DEVICE}.json`;
const ATTEMPT_FILE = `.state/rehearsal-attempt.${ON_DEVICE}.json`;
// The device's holder secret. It outlives every pass the device is issued.
const HOLDER_FILE = `.state/rehearsal-holder.${ON_DEVICE}.json`;
const VERIFIER_FILE = `.state/stand-in-verifier.${SLUG}.json`;
// The document a scan stands for. The stand-in verifier turns it into the
// nullifier a real proof would show: the same for one document under one event.
const DOCUMENT = process.env.REHEARSAL_DOCUMENT?.trim() || `document-of-${DEVICE || 'the-device'}`;
if (!/^[a-z0-9-]+$/u.test(DOCUMENT)) {
  console.error('REHEARSAL_DOCUMENT is letters, digits and dashes');
  process.exit(1);
}
const RENEW = process.env.REHEARSAL_RENEW?.trim() === '1';
// REHEARSAL_DROP=issuing ends the process while the pass is being issued, as a
// phone drops a page. Running "journey" again is the page coming back.
const DROP = process.env.REHEARSAL_DROP?.trim() ?? '';
const APP_ORIGIN = 'https://midnight.vote';
const VERIFIER_PORT = 28_090;
const VERIFIER_URL = `http://127.0.0.1:${VERIFIER_PORT}`;
// Where the real verifier publishes proof parameters. The stand-in only names
// it: nothing fetches the address during a rehearsal.
const PROOF_PARAMS_ORIGIN = 'https://rarimo.midnight.vote';
const CICO_URL = process.env.REHEARSAL_CICO_URL?.trim() || 'http://127.0.0.1:8791';

const [command = '', ...rest] = process.argv.slice(2);
const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};
const inRoot = (path) => resolve(ROOT, path);
const readManifest = () =>
  existsSync(inRoot(MANIFEST)) ? JSON.parse(readFileSync(inRoot(MANIFEST), 'utf8')) : null;
const elapsed = (since) => `${Math.round((Date.now() - since) / 1000)} s`;

/** The registry people's passes live in. A rehearsal never runs against it. */
function peopleRegistry() {
  const file = loadConsultations();
  const source = JSON.parse(readFileSync(inRoot(file.registryManifest), 'utf8'));
  return source.registry.contractAddress;
}

function runDeploy() {
  const result = spawnSync(
    process.execPath,
    [
      '--env-file-if-exists=relayer/.env',
      '--env-file-if-exists=.env.v2.preview',
      `--env-file-if-exists=${DEPLOY_ENV}`,
      'scripts/deploy-passport-v2.mjs',
    ],
    { stdio: 'inherit', cwd: ROOT },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Reads one value from an operator file without printing it. */
function fromFile(path, name) {
  const match = readFileSync(inRoot(path), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!match?.[1]?.trim()) fail(`${name} is not set in ${path}`);
  return match[1].trim();
}

function prepare() {
  if (!existsSync(inRoot(DEPLOY_ENV))) {
    const minutes = rest.length === 3 ? rest.map(Number) : [45, 60, 90];
    if (
      minutes.some((value) => !Number.isFinite(value)) ||
      !(minutes[0] < minutes[1] && minutes[1] < minutes[2])
    ) {
      fail('Give three rising numbers of minutes: passes until, answers close, counting until');
    }
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(
      inRoot(DEPLOY_ENV),
      [
        '# Written by scripts/rehearse-with-stand-in-verifier.mjs. No secrets here.',
        "# A registry of its own: a pass from the stand-in verifier is nobody's.",
        `V2_REGISTRY_ID_HEX=${randomBytes(32).toString('hex')}`,
        `V2_REFERENDUM_ID=${SLUG}-${new Date().toISOString().slice(0, 10)}`,
        `V2_EVENT_ID_HEX=${randomBytes(32).toString('hex')}`,
        `V2_MANIFEST_PATH=${MANIFEST}`,
        'V2_EVIDENCE_PHASE=prepare',
        'V2_OPERATOR_SYNC_WAIT_MS=10800000',
        `V2_OPENS_AT_UNIX=${now}`,
        `V2_ENROLLMENT_CLOSES_AT_UNIX=${now + minutes[0] * 60}`,
        `V2_CLOSES_AT_UNIX=${now + minutes[1] * 60}`,
        `V2_REVEAL_CLOSES_AT_UNIX=${now + minutes[2] * 60}`,
        'V2_REFERENDUM_TITLE=Dress rehearsal with a stand-in verifier',
        'V2_REFERENDUM_QUESTION=Does the whole journey run, from a pass to a counted answer?',
        'V2_REFERENDUM_DESCRIPTION=A rehearsal by the operator on a registry of its own. No document was read and no person answered. It is not shown in the app.',
        '',
      ].join('\n'),
      'utf8',
    );
    console.log(`wrote ${DEPLOY_ENV}`);
  } else {
    console.log(`${DEPLOY_ENV} is kept: this rehearsal was prepared before.`);
  }
  runDeploy();

  const manifest = readManifest();
  const deployed = manifest?.referenda?.[0];
  if (!deployed?.contractAddress) fail('The deployment did not produce a consultation');
  if (manifest.registry.contractAddress === peopleRegistry()) {
    fail('The rehearsal landed on the registry people use. Nothing more is done.');
  }

  const printed = execFileSync(
    process.execPath,
    ['scripts/print-consultation-values.mjs', MANIFEST],
    {
      encoding: 'utf8',
      cwd: ROOT,
    },
  );
  const printedValue = (name) => {
    const match = printed.match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (!match) fail(`${name} was not printed`);
    return match[1].trim();
  };
  mkdirSync(inRoot(CICO_STATE), { recursive: true });
  // The same wallet as the operator's, so its saved state spares a replay.
  if (existsSync(inRoot('.state/operator-wallet.preview.json'))) {
    copyFileSync(
      inRoot('.state/operator-wallet.preview.json'),
      inRoot(`${CICO_STATE}/issuer-wallet-state.json`),
    );
  }
  writeFileSync(
    inRoot(CICO_ENV),
    [
      '# Written by scripts/rehearse-with-stand-in-verifier.mjs. Holds secrets.',
      'CICO_HOST=127.0.0.1',
      `CICO_PORT=${new URL(CICO_URL).port || 8791}`,
      `CICO_ALLOWED_ORIGINS=${APP_ORIGIN}`,
      `CICO_RARIMO_BASE_URL=${VERIFIER_URL}`,
      `CICO_RARIMO_PROOF_PARAMS_ORIGINS=${PROOF_PARAMS_ORIGIN}`,
      `CICO_ISSUER_ID=${manifest.registry.issuerId}`,
      `CICO_ISSUER_ID_HEX=${manifest.registry.issuerIdHex}`,
      `CICO_CREDENTIAL_EPOCH=${manifest.registry.credentialEpoch}`,
      `CICO_ISSUER_WALLET_SEED=${fromFile('.env.v2.preview', 'V2_OPERATOR_FEE_SEED_HEX')}`,
      `CICO_ISSUER_ROLE_SECRET=${fromFile('.env.v2.preview', 'V2_ISSUER_ROLE_SECRET_HEX')}`,
      `CICO_ROOT_PUBLISHER_SECRET_HEX=${fromFile('.env.v2.preview', 'V2_ROOT_PUBLISHER_ROLE_SECRET_HEX')}`,
      'CICO_ZK_CONFIG_PATH=contracts/credential-registry-v1/managed/credential-registry-v1',
      'CICO_REFERENDUM_ZK_CONFIG_PATH=contracts/referendum-v2/managed/referendum-v2',
      `CICO_REGISTRY_CONTRACT_ADDRESS=${manifest.registry.contractAddress}`,
      `CICO_REGISTRY_ID_HEX=${manifest.registry.registryIdHex}`,
      `CICO_REFERENDA_JSON=${printedValue('CICO_REFERENDA_JSON')}`,
      'CICO_ROOT_PUBLISH_MIN_BATCH=1',
      `CICO_ACTION_CAPABILITY_SECRET=${fromFile('relayer/.env', 'RELAYER_V2_CAPABILITY_SECRET')}`,
      'CICO_ACTION_ALLOWED_NETWORKS=preview',
      `CICO_ACTION_ALLOWED_CONTRACTS=${deployed.contractAddress}`,
      'CICO_ACTION_ALLOWED_CIRCUITS=castVote,revealVote',
      `CICO_STATE_DIRECTORY=${CICO_STATE}`,
      'CICO_PROOF_SERVER_URL=http://localhost:6300',
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  );
  console.log(`\nwrote ${CICO_ENV} (it holds secrets and is not in the repository)\n`);
  console.log('Start the two services, each in its own terminal, then run "journey":\n');
  console.log(`  node --env-file=${CICO_ENV} cico-service/dist/server.js`);
  console.log(
    `  cd relayer && RELAYER_WALLET_STATE_PATH=.state/wallet-state.preview.json RELAYER_ALLOWED_ORIGINS=${APP_ORIGIN} RELAYER_V2_ALLOWED_CIRCUITS=castVote,revealVote RELAYER_V2_ALLOWED_CONTRACTS=${deployed.contractAddress} node --env-file-if-exists=.env dist/server.js\n`,
  );
}

/**
 * The stand-in for the passport verifier. It speaks the four routes the
 * credential service calls, and says "verified" once `scan` was called: that
 * call stands for a person scanning a document with RariMe.
 */
function startStandInVerifier() {
  // Kept in a file: the verifier is a service of its own, and it must still
  // know a scan when the page that asked for it has been dropped.
  const kept = existsSync(inRoot(VERIFIER_FILE))
    ? JSON.parse(readFileSync(inRoot(VERIFIER_FILE), 'utf8'))
    : { requests: [], latest: null };
  const requests = new Map(kept.requests);
  let latest = kept.latest;
  const keep = () => {
    mkdirSync(dirname(inRoot(VERIFIER_FILE)), { recursive: true });
    writeFileSync(
      inRoot(VERIFIER_FILE),
      JSON.stringify({ requests: [...requests], latest }),
      'utf8',
    );
  };
  const json = (response, status, body) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    response.writeHead(
      status,
      body === undefined ? {} : { 'content-type': 'application/vnd.api+json' },
    );
    response.end(text);
  };
  const decimal = (hexValue) => BigInt(hexValue).toString(10);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', VERIFIER_URL);
    const base = '/integrations/verificator-svc';
    try {
      if (request.method === 'POST' && url.pathname === `${base}/v2/private/verification-link`) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { data } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const userHash = randomBytes(16).toString('hex');
        requests.set(data.id, { attributes: data.attributes, userHash, scanned: null });
        latest = data.id;
        keep();
        json(response, 200, {
          data: {
            id: data.id,
            type: 'verification_link',
            attributes: {
              get_proof_params: `${PROOF_PARAMS_ORIGIN}${base}/public/proof-params/${userHash}`,
            },
          },
        });
        return;
      }
      const status = url.pathname.match(/\/private\/verification-status\/([^/]+)$/u);
      if (request.method === 'GET' && status) {
        const id = decodeURIComponent(status[1]);
        const held = requests.get(id);
        if (!held) return json(response, 404, { errors: [{ title: 'Not Found' }] });
        json(response, 200, {
          data: {
            id,
            type: 'user_status',
            attributes: { status: held.scanned ? 'verified' : 'not_verified' },
          },
        });
        return;
      }
      const proof = url.pathname.match(/\/private\/proof\/([^/]+)$/u);
      if (request.method === 'GET' && proof) {
        const held = requests.get(decodeURIComponent(proof[1]));
        if (!held?.scanned) return json(response, 404, { errors: [{ title: 'Not Found' }] });
        const a = held.attributes;
        // The public signals of a query proof, at the positions the service reads.
        const signals = Array.from({ length: 23 }, () => '0');
        // What a real proof shows of the document: a number that is the same
        // whenever this document is proven under this event, and says nothing
        // else about it.
        signals[0] = BigInt(
          `0x${createHash('sha256')
            .update(`stand-in-nullifier:${held.document}:${a.event_id}`)
            .digest('hex')
            .slice(0, 62)}`,
        ).toString(10);
        signals[6] = BigInt(`0x${Buffer.from(held.scanned, 'ascii').toString('hex')}`).toString(10);
        signals[9] = String(a.event_id);
        signals[10] = decimal(a.event_data);
        signals[12] = String(a.selector);
        signals[15] = String(a.timestamp_upper_bound);
        signals[17] = String(a.identity_counter_upper_bound);
        signals[19] = decimal(a.birth_date_upper_bound);
        signals[20] = decimal(a.expiration_date_lower_bound);
        json(response, 200, {
          data: {
            id: held.userHash,
            type: 'get_proof',
            attributes: {
              proof: {
                // Not a proof. The real verifier checks one; this one checked nothing.
                proof: {
                  pi_a: ['0', '0', '0'],
                  pi_b: [
                    ['0', '0'],
                    ['0', '0'],
                    ['0', '0'],
                  ],
                  pi_c: ['0', '0', '0'],
                  protocol: 'groth16',
                },
                pub_signals: signals,
              },
            },
          },
        });
        return;
      }
      const user = url.pathname.match(/\/private\/user\/([^/]+)$/u);
      if (request.method === 'DELETE' && user) {
        requests.delete(decodeURIComponent(user[1]));
        keep();
        json(response, 204);
        return;
      }
      json(response, 404, { errors: [{ title: 'Not Found' }] });
    } catch (error) {
      json(response, 500, { errors: [{ title: String(error?.message ?? error) }] });
    }
  });
  return new Promise((ready, refuse) => {
    server.once('error', refuse);
    server.listen(VERIFIER_PORT, '127.0.0.1', () =>
      ready({
        /** A person scans this document, of this country. */
        scan(alpha3, document) {
          const held = latest ? requests.get(latest) : null;
          if (!held) throw new Error('Nobody asked the verifier for anything');
          held.scanned = alpha3;
          held.document = document;
          keep();
        },
        close: () => server.close(),
      }),
    );
  });
}

/** One record of the device's vault, as a file, encoded as the browser's vault encodes it. */
function fileVault(api, path) {
  return {
    load: async () =>
      existsSync(path) ? api.deserializePrivateStateFromStorage(readFileSync(path, 'utf8')) : null,
    save: async (value) => {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, api.serializePrivateStateForStorage(value), {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporary, path);
    },
    clear: async () => rmSync(path, { force: true }),
  };
}

/** Every request carries the app's origin, as a browser's would. */
const fromApp = (input, init = {}) =>
  fetch(input, { ...init, headers: { ...init.headers, origin: APP_ORIGIN } });

async function connect(manifest) {
  const api = await import('midnight-referendum-api');
  const { NodeZkConfigProvider } = await import(
    '@midnight-ntwrk/midnight-js-node-zk-config-provider'
  );
  const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
  const { loadConfig } = await import('../relayer/dist/config.js');
  setNetworkId('preview');
  const relayer = loadConfig();
  const deployed = manifest.referenda[0];

  const status = await fromApp(`${CICO_URL}/v1/service/status`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (!status) fail(`The credential service does not answer at ${CICO_URL}. Start it first.`);
  if (status.registryContractAddress === peopleRegistry()) {
    fail('That credential service issues into the registry people use. A rehearsal never does.');
  }
  if (
    status.registryContractAddress !== manifest.registry.contractAddress ||
    !status.consultations.includes(deployed.contractAddress)
  ) {
    fail('That credential service is not configured for this rehearsal. Run "prepare" again.');
  }

  const runtime = await api.createReferendumV2WalletlessProviders({
    relayUrl: `http://${relayer.host}:${relayer.port}`,
    proofServerUri: relayer.provingServerUrl,
    networkId: 'preview',
    indexerUri: relayer.indexerHttpUrl,
    indexerWsUri: relayer.indexerWsUrl,
    // The permission to be sponsored comes from the credential service, as in the app.
    capabilityIssuer: new api.HttpWalletlessActionCapabilityIssuer({
      baseUrl: CICO_URL,
      fetchImpl: fromApp,
    }),
    zkConfigProvider: new NodeZkConfigProvider(
      inRoot('contracts/referendum-v2/managed/referendum-v2'),
    ),
    fetchImpl: fromApp,
  });
  return { api, runtime, deployed, relayer, status };
}

async function journey() {
  const [choice = 'YES', alpha3 = 'CHE'] = rest;
  if (!['YES', 'NO', 'ABSTAIN'].includes(choice)) fail('The answer is YES, NO or ABSTAIN');
  if (!/^[A-Z]{3}$/u.test(alpha3)) fail('The country is three capital letters, as in a passport');
  const manifest = readManifest();
  if (!manifest?.referenda?.[0]?.contractAddress) fail('Run "prepare" first');
  const verifier = await startStandInVerifier();
  const { api, runtime, deployed, relayer, status } = await connect(manifest);

  // How the service keeps a document to one holder, and the event the app
  // derives for itself from the registry. They must be the same number.
  const rule = status.documents ?? { onePassPerDocument: 'off', eventId: null };
  const verificationEventId =
    rule.onePassPerDocument === 'off'
      ? undefined
      : api.deriveRarimoEventId(
          manifest.registry.contractAddress,
          Number(manifest.registry.credentialEpoch),
        );
  if (verificationEventId && verificationEventId !== rule.eventId) {
    fail('The app and the credential service derive different events for this registry');
  }
  console.log(`one pass per document: ${rule.onePassPerDocument}`);

  // The app's own ports to the credential service, and its country catalogue.
  const { HttpRarimoVerificationGateway, HttpCivicCredentialIssuerPort } = await import(
    '../ui/src/integration/passport-v2-http-ports.ts'
  );
  const { rarimoIsoCountryMapper } = await import('../ui/src/integration/rarimo-country-mapper.ts');
  const { sealWhenAdmitted } = await import('../ui/src/integration/seal-admission.ts');

  const attempts = fileVault(api, inRoot(ATTEMPT_FILE));
  const credential = new api.RarimoCivicCredentialAdapter({
    gateway: new HttpRarimoVerificationGateway({ baseUrl: CICO_URL, fetcher: fromApp }),
    issuer: new HttpCivicCredentialIssuerPort({ baseUrl: CICO_URL, fetcher: fromApp }),
    issuerId: manifest.registry.issuerId,
    credentialEpoch: Number(manifest.registry.credentialEpoch),
    credentialTtlMs: Number(manifest.runtime.credentialTtlMs),
    countryMapper: rarimoIsoCountryMapper,
    uniquenessTimestampUpperBoundUnixSeconds: Number(
      manifest.runtime.uniquenessTimestampUpperBoundUnixSeconds,
    ),
    vault: fileVault(api, inRoot(PASS_FILE)),
    pendingVault: attempts,
    enrollmentTtlMs: 30 * 60 * 1_000,
    ...(verificationEventId
      ? { verificationEventId, holderKeyVault: fileVault(api, inRoot(HOLDER_FILE)) }
      : {}),
  });
  const actions = new api.MidnightCivicActionAdapter({
    providers: runtime.providers,
    credential,
    referenda: [catalogEntry(api, manifest)],
    randomBytes: (length) => Uint8Array.from(randomBytes(length)),
    actionExecutionContext: runtime.actionContext,
    ballotOpenings: fileBallotVault(inRoot(VAULT)),
    registryHistory: api.createIndexerRegistryHistory({ indexerUri: relayer.indexerHttpUrl }),
  });
  const state = () =>
    readPublicState(api, runtime.providers.publicDataProvider, deployed.contractAddress);

  console.log(`consultation ${deployed.referendumId} at ${deployed.contractAddress}`);
  console.log('before:', JSON.stringify(await state()));

  // 1. Add eligibility: the app asks for a verification, the person scans.
  //    Unless a page was dropped mid-way: then the attempt it left is taken up.
  let step = Date.now();
  const left = await attempts.load();
  const held = left ? null : await credential.getCredentialSummary();
  let enrollmentId = null;
  if (held?.status === 'issued' && !RENEW) {
    // A device that comes back with a pass goes straight to answering.
    console.log(`this device holds a pass, valid until ${held.validUntil}: no verification`);
  } else if (left) {
    enrollmentId = left.enrollmentId;
    console.log(
      `an attempt was under way on this device (${left.issuanceClaims ? 'the pass had been asked for' : 'the scan was awaited'}); taking it up again, with no new scan`,
    );
  } else {
    if (held?.status === 'issued') {
      console.log(
        `this device holds a pass, valid until ${held.validUntil}, and asks for a new one`,
      );
    }
    const enrollment = await credential.beginEnrollment({
      session: {
        sessionId: 'rehearsal',
        origin: APP_ORIGIN,
        network: 'stagenet',
        status: 'connected',
        profile: { displayName: 'Rehearsal' },
        capabilities: ['session', 'profile'],
      },
      policy: { minimumAssurance: 'document-nfc', requireAdult: true },
    });
    enrollmentId = enrollment.enrollmentId;
    console.log(
      `verification requested in ${elapsed(step)}; the link opens ${new URL(enrollment.interaction.uri).origin}`,
    );
    const pending = await credential.getEnrollmentStatus(enrollmentId);
    console.log(`before the scan the pass is: ${pending.status}`);
    verifier.scan(alpha3, DOCUMENT);
    console.log(`stand-in scan: "${DOCUMENT}", a document of ${alpha3}. No document was read.`);
  }

  if (DROP === 'issuing' && !left) {
    // The request to issue the pass leaves, and the page is gone before the
    // answer comes back. The credential service carries on by itself.
    credential.getEnrollmentStatus(enrollmentId).catch(() => undefined);
    await new Promise((wake) => setTimeout(wake, 6_000));
    console.log('the page is dropped while the pass is being issued. Run "journey" again.');
    process.exit(3);
  }

  // 2. The pass is issued on chain by the credential service.
  step = Date.now();
  let issued = enrollmentId ? null : held;
  for (let attempt = 0; attempt < 60 && !issued; attempt += 1) {
    try {
      const snapshot = await credential.getEnrollmentStatus(enrollmentId);
      if (snapshot.status === 'issued') issued = snapshot;
      else if (snapshot.errorCode === 'DOCUMENT_ALREADY_ENROLLED') {
        // A refusal the app would show to a person is a result, not a crash.
        console.log(
          `no pass after ${elapsed(step)}: DOCUMENT_ALREADY_ENROLLED: "${DOCUMENT}" already has a pass on another device`,
        );
        console.log('this device holds:', await credential.getCredentialSummary());
        console.log('after: ', JSON.stringify(await state()));
        verifier.close();
        process.exit(2);
      } else if (snapshot.status !== 'pending') {
        fail(`The pass was not issued: ${snapshot.status} ${snapshot.errorCode ?? ''}`);
      }
    } catch (error) {
      if (!api.isCivicCredentialError(error) || !error.retryable) throw error;
      console.log(`  not yet: ${error.code}`);
    }
    if (!issued) await new Promise((wake) => setTimeout(wake, 3_000));
  }
  if (!issued) fail('The pass was not issued in time');
  const summary = await credential.getCredentialSummary();
  if (enrollmentId) {
    console.log(
      `pass issued in ${elapsed(step)}: country ${summary.country}, ${summary.ageClass}, ${summary.assurance}, valid until ${summary.validUntil}`,
    );
  }

  // 3. Seal an answer. The app waits by itself until the pass is admitted.
  const authorization = await credential.getActionAuthorization();
  if (!authorization) fail('The pass carries no authorization');
  step = Date.now();
  let sealingFrom = step;
  let receipt;
  try {
    receipt = await sealWhenAdmitted({
      seal: () => {
        sealingFrom = Date.now();
        return actions.castVote({ referendumId: deployed.referendumId, choice, authorization });
      },
      admission: () => actions.getPassAdmission(deployed.referendumId),
      onWaiting: (waiting) =>
        console.log(
          waiting
            ? 'the pass is not admitted yet; waiting, as the app does'
            : `the wait for admission ended after ${elapsed(step)}`,
        ),
    });
  } catch (error) {
    // A refusal the app would show to a person is a result, not a crash.
    if (!api.isCivicCredentialError(error)) throw error;
    console.log(`refused after ${elapsed(sealingFrom)}: ${error.code}: ${error.message}`);
    console.log('this device:', await actions.getSealedAnswerStatus(deployed.referendumId));
    console.log('after: ', JSON.stringify(await state()));
    verifier.close();
    process.exit(2);
  }
  console.log(`sealed in ${elapsed(sealingFrom)}: transaction ${receipt.transactionId}`);
  console.log(
    `  block ${receipt.blockHeight}, ${receipt.blockTimestamp}, hash ${receipt.transactionHash}`,
  );
  console.log('after: ', JSON.stringify(await state()));
  verifier.close();
}

async function count() {
  const manifest = readManifest();
  if (!manifest?.referenda?.[0]?.contractAddress) fail('Run "prepare" first');
  const { api, runtime, deployed, relayer } = await connect(manifest);
  // Counting needs no pass: the authorization kept with the sealed answer
  // sponsors it. So the device has none here, as it would weeks later.
  const actions = new api.MidnightCivicActionAdapter({
    providers: runtime.providers,
    credential: {
      getActionAuthorization: async () => null,
      getPrivateCredentialMaterial: async () => null,
    },
    referenda: [catalogEntry(api, manifest)],
    actionExecutionContext: runtime.actionContext,
    ballotOpenings: fileBallotVault(inRoot(VAULT)),
    registryHistory: api.createIndexerRegistryHistory({ indexerUri: relayer.indexerHttpUrl }),
  });
  const state = () =>
    readPublicState(api, runtime.providers.publicDataProvider, deployed.contractAddress);
  console.log('before:', JSON.stringify(await state()));
  const started = Date.now();
  try {
    const receipt = await actions.revealVote({ referendumId: deployed.referendumId });
    console.log(`counted in ${elapsed(started)}: transaction ${receipt.transactionId}`);
    console.log(
      `  block ${receipt.blockHeight}, ${receipt.blockTimestamp}, hash ${receipt.transactionHash}`,
    );
  } catch (error) {
    if (!api.isCivicCredentialError(error)) throw error;
    console.log(`refused after ${elapsed(started)}: ${error.code}: ${error.message}`);
    console.log('after: ', JSON.stringify(await state()));
    process.exit(2);
  }
  console.log('after: ', JSON.stringify(await state()));
}

/**
 * Makes the device forget that its answer was confirmed: the opening goes back
 * to "sealing", as it is on a device whose page was dropped while it waited
 * for the relay. The answer on chain is not touched.
 */
function forgetConfirmation() {
  const path = inRoot(VAULT);
  if (!existsSync(path)) fail('This device holds no answer');
  const openings = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(
    path,
    JSON.stringify(
      openings.map(({ sealedAt: _sealedAt, ...opening }) => ({ ...opening, status: 'sealing' })),
    ),
    { encoding: 'utf8', mode: 0o600 },
  );
  console.log(`${openings.length} answer(s) on this device are back to "sealing"`);
}

if (command === 'prepare') prepare();
else if (command === 'forget-confirmation') forgetConfirmation();
else if (command === 'operate') runDeploy();
else if (command === 'journey') await journey();
else if (command === 'count') await count();
else fail('The command is prepare, journey, operate, count or forget-confirmation');
process.exit(0);
