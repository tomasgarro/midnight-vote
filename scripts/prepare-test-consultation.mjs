/**
 * Writes the inputs for the Preview test consultation of Wave 2: one question,
 * open to any adult with a chip-verified pass, against the registry that is
 * already deployed.
 *
 *     node scripts/prepare-test-consultation.mjs
 *     npm run deploy:preview:test
 *
 * The first run draws the event id and fixes the schedule. A later run keeps
 * the file it finds, because the deploy is restarted against the same manifest
 * and a new event id or schedule would no longer match it. Delete the file and
 * the manifest together to start another consultation.
 *
 * The schedule is in the file as Unix seconds. Answers close on Friday
 * 9 October 2026 at 18:00 in Geneva; a pass can be added until one hour
 * before; an answer can be counted until Monday 12 October at 18:00.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const OUT = '.env.v2.preview.test';
if (existsSync(OUT)) {
  console.log(
    `${OUT} exists and is kept. Delete it and its manifest to start another consultation.`,
  );
  process.exit(0);
}

const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);
const opens = Math.floor(Date.now() / 1000);
const enrollmentCloses = seconds('2026-10-09T17:00:00+02:00');
const closes = seconds('2026-10-09T18:00:00+02:00');
const revealCloses = seconds('2026-10-12T18:00:00+02:00');
if (!(opens < enrollmentCloses)) {
  console.error('The schedule in this script is in the past. Set new dates before running it.');
  process.exit(1);
}

const lines = [
  `# Generated ${new Date().toISOString()} by scripts/prepare-test-consultation.mjs`,
  '# No secrets here; the role secrets come from .env.v2.preview.',
  '',
  'V2_REFERENDUM_ID=preview-wave2-test-consultation',
  `V2_EVENT_ID_HEX=${randomBytes(32).toString('hex')}`,
  'V2_MANIFEST_PATH=deploy/passport-v2/preview.test.manifest.json',
  'V2_REGISTRY_FROM_MANIFEST=deploy/passport-v2/preview.manifest.json',
  'V2_API_URL=https://cico.midnight.vote',
  '# The consultation is deployed and its roots are published. No fixture',
  '# answer is cast: the answers come from people, through the app.',
  'V2_EVIDENCE_PHASE=prepare',
  '# A cold operator wallet replayed 258,000 indices at about 3,000 a minute on',
  '# 1 October 2026. Three hours leaves room for a slower night.',
  'V2_OPERATOR_SYNC_WAIT_MS=10800000',
  '',
  `V2_OPENS_AT_UNIX=${opens}`,
  `V2_ENROLLMENT_CLOSES_AT_UNIX=${enrollmentCloses}`,
  `V2_CLOSES_AT_UNIX=${closes}`,
  `V2_REVEAL_CLOSES_AT_UNIX=${revealCloses}`,
  '',
  'V2_REFERENDUM_TITLE=Results after the close',
  'V2_REFERENDUM_QUESTION=Should the result of a consultation stay hidden until it closes?',
  'V2_REFERENDUM_DESCRIPTION=A test consultation on Midnight Preview. Answers close on 9 October 2026 at 18:00, Geneva time.',
  '',
];

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`wrote ${OUT}`);
console.log(`  a pass can be added until ${new Date(enrollmentCloses * 1000).toISOString()}`);
console.log(`  answers close            ${new Date(closes * 1000).toISOString()}`);
console.log(`  counting closes          ${new Date(revealCloses * 1000).toISOString()}`);
