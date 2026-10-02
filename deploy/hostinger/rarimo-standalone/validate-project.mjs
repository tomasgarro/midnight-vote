import { readFile } from 'node:fs/promises';

const compose = await readFile(new URL('./docker-compose.hostinger.yml', import.meta.url), 'utf8');
const registryCompose = await readFile(
  new URL('./docker-compose.hostinger.registry.yml', import.meta.url),
  'utf8',
);
const cutoverCompose = await readFile(
  new URL('./docker-compose.hostinger.cutover.yml', import.meta.url),
  'utf8',
);
const previewCompose = await readFile(
  new URL('./docker-compose.hostinger.preview.yml', import.meta.url),
  'utf8',
);

const servicesSection = (value) => value.slice(value.indexOf('services:'));

const checks = [
  [compose.includes('name: midnight-rarimo-nfc'), 'isolated project name is missing'],
  [compose.includes('127.0.0.1:18080:8000'), 'private verifier is not loopback-only'],
  [compose.includes('127.0.0.1:18081:8080'), 'gateway is not loopback-only'],
  [
    !compose.includes('"80:80"') && !compose.includes('"443:443"'),
    'public ports must stay closed before DNS approval',
  ],
  [
    compose.includes('method GET') && compose.includes('method POST'),
    'gateway method allow-list is missing',
  ],
  [
    compose.includes('/public/proof-params/*') && compose.includes('/public/callback/*'),
    'gateway route allow-list is missing',
  ],
  [!compose.includes('/private/*'), 'a private provider path is exposed by the gateway'],
  [compose.includes('POSTGRES_PASSWORD_FILE'), 'database password is not file-backed'],
  [compose.includes('/dev/urandom'), 'database password is not generated on the VPS'],
  [compose.includes('internal: true'), 'private network is not internal'],
  [
    compose.includes(
      'ref=f7ebbdf4d692326dd50d2c49976dd31042b2c29a&checksum=f7ebbdf4d692326dd50d2c49976dd31042b2c29a',
    ),
    'upstream verifier context is not pinned and checksum-bound',
  ],
  [
    compose.includes('additional_contexts:') && compose.includes('COPY --from=upstream . .'),
    'pinned upstream is not mounted as a named build context',
  ],
  [compose.includes('dockerfile_inline: |'), 'Hostinger build is not self-contained'],
  [
    compose.includes(
      'ADD --checksum=sha256:91ab66698f70ae1456d3f54cbb2cb5e84fefa44c2b0dd55194eff3fe2ae85053',
    ),
    'reviewed cleanup patch download is not checksum-bound',
  ],
  [
    compose.includes("git apply --check --include='internal/service/handlers/*'"),
    'reviewed cleanup patch is not checked before application',
  ],
  [
    compose.includes('go test ./internal/service/handlers'),
    'cleanup tests are not executed during the build',
  ],
  [registryCompose.length <= 8192, 'pull-only Hostinger manifest exceeds the API content limit'],
  [
    registryCompose.includes(
      'ghcr.io/tomasgarro/midnight-rarimo-verificator:v0.3.12-cico-delete-204-22c3c68@sha256:c617e38b457d488dce937741ee3ce395b1d4d9749fcc254cadbb8eefe408aa40',
    ),
    'pull-only manifest image is not pinned to the published registry digest',
  ],
  [!registryCompose.includes('build:'), 'pull-only Hostinger manifest still requires a build'],
  [
    servicesSection(registryCompose) === servicesSection(compose),
    'build and pull-only manifests have different runtime services',
  ],
  [cutoverCompose.length <= 8192, 'CICO cutover manifest exceeds the Hostinger API content limit'],
  [!cutoverCompose.includes('build:'), 'CICO cutover manifest still requires a build'],
  [
    cutoverCompose.includes(
      'sha256:c617e38b457d488dce937741ee3ce395b1d4d9749fcc254cadbb8eefe408aa40',
    ),
    'cutover verifier digest is missing',
  ],
  [
    cutoverCompose.includes(
      'sha256:ec3080c8ee6754365af0e390449ad1be7d1897bb95b9b58891d90b36bd66789e',
    ),
    'cutover CICO digest is missing',
  ],
  [
    cutoverCompose.includes(
      'sha256:801bbc0340e9e96f16735f77b523f23c7459e3359842f7c79c2c53f4e994d531',
    ),
    'cutover proof-server digest is missing',
  ],
  [
    cutoverCompose.includes('"80:80"') && cutoverCompose.includes('"443:443"'),
    'HTTPS edge ports are missing',
  ],
  [
    cutoverCompose.includes('cico.cardanoschool.org') &&
      cutoverCompose.includes('rarimo.cardanoschool.org'),
    'cutover domains are missing',
  ],
  [cutoverCompose.includes('@ok path /v1/*'), 'CICO public route allow-list is missing'],
  [
    cutoverCompose.includes('/public/proof-params/*') &&
      cutoverCompose.includes('/public/callback/*'),
    'Rarimo public route allow-list is missing',
  ],
  [!cutoverCompose.includes('/private/*'), 'a private Rarimo wildcard is exposed at cutover'],
  // CICO and its proof server share the verifier's network namespace. The
  // issuer runtime refuses a non-loopback proof server over HTTP, and the
  // shared namespace keeps both services off every other network.
  [
    cutoverCompose.includes('CICO_RARIMO_BASE_URL: http://127.0.0.1:8000'),
    'CICO does not reach the verifier over loopback',
  ],
  [
    cutoverCompose.includes('CICO_PROOF_SERVER_URL: http://127.0.0.1:6300'),
    'CICO does not reach its proof server over loopback',
  ],
  [
    (cutoverCompose.match(/network_mode: "service:rarimo-verificator"/gu) ?? []).length === 2,
    'CICO and its proof server must share the verifier network namespace',
  ],
  [
    cutoverCompose.includes('reverse_proxy rarimo-verificator:8791'),
    'the edge does not reach CICO through the shared namespace',
  ],
  [
    cutoverCompose.includes('CICO_STATE_DIRECTORY: /var/lib/cico-passport'),
    'CICO durable state is missing',
  ],
  [
    !cutoverCompose.includes('CICO_REFERENDA_JSON') &&
      !cutoverCompose.includes('CICO_ACTION_CAPABILITY_SECRET'),
    'Stage B cutover must not publish roots or mint vote capabilities',
  ],
  [
    cutoverCompose.includes('CICO_ISSUER_WALLET_SEED: ${CICO_ISSUER_WALLET_SEED:?required}'),
    'CICO wallet seed is not injected',
  ],
  [
    cutoverCompose.includes('CICO_ISSUER_ROLE_SECRET: ${CICO_ISSUER_ROLE_SECRET:?required}'),
    'CICO issuer role secret is not injected',
  ],
  [
    cutoverCompose.includes(
      'CICO_ROOT_PUBLISHER_SECRET_HEX: ${CICO_ROOT_PUBLISHER_SECRET_HEX:?required}',
    ),
    'CICO root role secret is not injected',
  ],
  [
    cutoverCompose.includes('rarimo-internal: {internal: true}'),
    'cutover private network is not internal',
  ],
  // The Preview manifest is the cutover plus what a walletless answer needs:
  // the capability issuer, the root publisher, the relay route, and the
  // midnight.vote names.
  [previewCompose.length <= 8192, 'Preview manifest exceeds the Hostinger API content limit'],
  [!previewCompose.includes('build:'), 'Preview manifest still requires a build'],
  [
    !/image: [^\n]*(?<!@sha256:[0-9a-f]{64})\n/u.test(previewCompose),
    'every Preview image must be pinned by digest',
  ],
  [
    previewCompose.includes('midnight-civic-cico-service:') &&
      previewCompose.includes('midnight-rarimo-verificator:'),
    'Preview images are missing',
  ],
  [
    ['cico.midnight.vote', 'rarimo.midnight.vote {', 'relay.midnight.vote {'].every((site) =>
      previewCompose.includes(site),
    ),
    'a midnight.vote site is missing from the Preview edge',
  ],
  [
    !previewCompose.includes('rarimo.cardanoschool.org') &&
      previewCompose.includes('RARIMO_CALLBACK_ORIGIN: https://rarimo.midnight.vote') &&
      previewCompose.includes('CICO_RARIMO_PROOF_PARAMS_ORIGINS: https://rarimo.midnight.vote'),
    'the verifier must be published under one name, used by both services',
  ],
  [
    previewCompose.includes('CICO_ALLOWED_ORIGINS: https://midnight.vote\n'),
    'the credential service must answer the app origin only',
  ],
  // The Cleisthenes project joins this edge network and is reached here.
  [
    previewCompose.includes('@swiss path /Switzerland/api /Switzerland/api/*') &&
      previewCompose.includes('reverse_proxy swiss-pilot:4318'),
    'the Cleisthenes route is missing from the Preview edge',
  ],
  [
    previewCompose.includes('@relay path /keys /ready /v2/*') &&
      previewCompose.includes('reverse_proxy relayer:8790'),
    'the relay route is missing or wider than the citizen routes',
  ],
  [
    previewCompose.includes('@ok path /v1/*') &&
      previewCompose.includes('/public/proof-params/*') &&
      previewCompose.includes('/public/callback/*') &&
      !previewCompose.includes('/private/*'),
    'Preview route allow-lists are wrong',
  ],
  [
    [
      'CICO_ISSUER_WALLET_SEED',
      'CICO_ISSUER_ROLE_SECRET',
      'CICO_ROOT_PUBLISHER_SECRET_HEX',
      'CICO_ACTION_CAPABILITY_SECRET',
      'CICO_ACTION_ALLOWED_CONTRACTS',
      'CICO_REFERENDA_JSON',
    ].every((name) => previewCompose.includes(`${name}: \${${name}:?required}`)),
    'a Preview secret or consultation value is not injected',
  ],
  [
    previewCompose.includes('CICO_ACTION_ALLOWED_CIRCUITS: castVote,revealVote\n') &&
      previewCompose.includes('CICO_ACTION_ALLOWED_NETWORKS: preview\n'),
    'capabilities must cover exactly the two citizen circuits on Preview',
  ],
  [
    previewCompose.includes('CICO_RARIMO_BASE_URL: http://127.0.0.1:8000') &&
      previewCompose.includes('CICO_PROOF_SERVER_URL: http://127.0.0.1:6300') &&
      (previewCompose.match(/network_mode: "service:rarimo-verificator"/gu) ?? []).length === 2,
    'CICO must reach the verifier and its proof server over loopback',
  ],
  [
    previewCompose.includes('rarimo-internal: {internal: true}'),
    'Preview private network is not internal',
  ],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}

const unresolved =
  `${compose}\n${registryCompose}\n${cutoverCompose}\n${previewCompose}`.match(
    /REPLACE_[A-Z0-9_]+/gu,
  ) ?? [];
if (unresolved.length !== 0) {
  throw new Error(`unexpected unresolved placeholders: ${unresolved.join(', ') || '(none)'}`);
}

console.log('Rarimo standalone Hostinger project validation passed.');
