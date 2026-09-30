import { readFile } from 'node:fs/promises';

const compose = await readFile(new URL('./docker-compose.hostinger.yml', import.meta.url), 'utf8');
const service = (name) => {
  const start = compose.indexOf(`\n  ${name}:\n`);
  if (start < 0) return '';
  const rest = compose.slice(start + 1);
  const next = rest.slice(name.length + 3).search(/\n {2}[a-z][a-z-]*:\n|\nnetworks:\n/u);
  return next < 0 ? rest : rest.slice(0, next + name.length + 3);
};
const voterProof = service('voter-proof');
const relayer = service('relayer');
const edge = service('edge');

const checks = [
  [compose.length <= 8192, 'the manifest exceeds the Hostinger API content limit'],
  [compose.includes('name: midnight-civic-relay'), 'the project name is missing'],
  [!compose.includes('build:'), 'the manifest must only pull images'],
  [
    !/image: (?!\$\{RELAYER_IMAGE)[^\n]*(?<!@sha256:[0-9a-f]{64})\n/u.test(compose),
    'every fixed image must be pinned by digest',
  ],
  [
    relayer.includes('image: ${RELAYER_IMAGE:?'),
    'the relayer image must be supplied as a pinned reference',
  ],
  [
    relayer.includes('RELAYER_SEED: ${RELAYER_SEED:?required}') &&
      relayer.includes('RELAYER_V2_CAPABILITY_SECRET: ${RELAYER_V2_CAPABILITY_SECRET:?required}'),
    'the relayer secrets must be injected, never written in the manifest',
  ],
  [!/[0-9a-f]{64}(?![0-9a-f])/u.test(relayer), 'the relayer block holds a 64-hex value'],
  [
    /^ {6}RELAYER_V2_ALLOWED_CIRCUITS: castVote,revealVote$/mu.test(relayer),
    'the relay must carry exactly the two citizen circuits',
  ],
  [
    relayer.includes('RELAYER_LEGACY_API_ENABLED: "false"'),
    'the legacy transaction API must stay off',
  ],
  [relayer.includes('read_only: true'), 'the relayer file system must be read-only'],
  [compose.includes('POSTGRES_PASSWORD_FILE'), 'the database password is not file-backed'],
  [compose.includes('/dev/urandom'), 'the database password is not generated on the VPS'],
  [compose.includes('relay-internal: {internal: true}'), 'the database network is not internal'],
  [
    (compose.match(/^ {4}ports:/gmu) ?? []).length === 1 && edge.includes('ports:'),
    'only the edge may publish a port',
  ],
  [edge.includes('@relay path /keys /v2/*'), 'the relay route allow-list is missing'],
  [
    edge.includes('path /check /prove') && edge.includes('method POST'),
    'the proving route allow-list is missing',
  ],
  [
    edge.includes('Access-Control-Allow-Origin {$$APP_ORIGIN}') && !edge.includes('Origin *'),
    'the proving server must answer the app origin only',
  ],
  [!/\blog\b/u.test(edge), 'the edge must not log requests: a proving request is a witness'],
  // ADR-010: what an honest operator must not retain.
  [voterProof.includes('profiles: [hosted-proving]'), 'hosted proving must be opt-in'],
  [
    voterProof.includes('command: [midnight-proof-server]') && !voterProof.includes('-v'),
    'the voter proving server must not run verbose',
  ],
  [!voterProof.includes('volumes:'), 'the voter proving server must have no volume'],
  [
    !voterProof.includes('relay-internal') && !voterProof.includes('relay-edge'),
    'the voter proving server must share no network with the relayer',
  ],
  [
    !relayer.includes('prove-edge') && !relayer.includes('prove-egress'),
    'the relayer must share no network with the voter proving server',
  ],
  [compose.includes('read_only: true\n  tmpfs: [/tmp]'), 'proof servers must be read-only'],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}

const unresolved = compose.match(/REPLACE_[A-Z0-9_]+/gu) ?? [];
if (unresolved.length !== 0) {
  throw new Error(`unexpected unresolved placeholders: ${unresolved.join(', ')}`);
}

console.log('Relay standalone Hostinger project validation passed.');
