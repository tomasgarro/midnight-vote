/**
 * Puts a consultation on Midnight Preview, or runs what is due on one that is
 * already there.
 *
 *     node scripts/deploy-consultation.mjs <slug>
 *     npm run deploy:preview:consultation -- <slug>
 *
 * The consultation is read from deploy/passport-v2/consultations.json. The
 * first run draws its event id, fixes its opening time and writes its inputs
 * to `.env.v2.preview.<slug>`. Every later run keeps that file, because the
 * deployment is tied to it, and does what is due: it admits a newer
 * credential root while the consultation still enrols, closes the
 * consultation once answers are over, and finalizes it once counting is over.
 *
 * It never casts or counts an answer. It needs `.env.v2.preview` and
 * `relayer/.env` (the operator's secrets) and a proof server on port 6300.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deployInputs, envPathFor, loadConsultations } from './consultations.mjs';

const slug = process.argv[2];
const file = loadConsultations();
const consultation = slug ? file.consultations[slug] : undefined;
if (!consultation) {
  console.error(
    `Usage: node scripts/deploy-consultation.mjs <slug>\nKnown: ${Object.keys(file.consultations).join(', ')}`,
  );
  process.exit(1);
}

const envPath = envPathFor(slug);
if (existsSync(envPath)) {
  // A consultation that was edited after its first deploy would no longer
  // match what is on chain. Say so here instead of failing deep in the deploy.
  const kept = readFileSync(envPath, 'utf8');
  const recorded = (name) => kept.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
  const drift = [
    ['V2_REFERENDUM_ID', consultation.referendumId],
    ['V2_ENROLLMENT_CLOSES_AT_UNIX', String(consultation.passesUntil)],
    ['V2_CLOSES_AT_UNIX', String(consultation.answersClose)],
    ['V2_REVEAL_CLOSES_AT_UNIX', String(consultation.countingUntil)],
  ].filter(([name, expected]) => recorded(name) !== expected);
  if (drift.length > 0) {
    console.error(
      `"${slug}" was prepared with other values for ${drift.map(([name]) => name).join(', ')}.\n` +
        'A deployed consultation cannot change its id or its schedule. Restore the file,\n' +
        'or give the changed consultation a new slug and a new id.',
    );
    process.exit(1);
  }
  console.log(`${envPath} is kept: this consultation was prepared before.`);
} else {
  writeFileSync(
    envPath,
    deployInputs(file, consultation, {
      nowSeconds: Math.floor(Date.now() / 1000),
      eventIdHex: randomBytes(32).toString('hex'),
    }),
    'utf8',
  );
  console.log(`wrote ${envPath}`);
}
const iso = (seconds) => new Date(seconds * 1000).toISOString();
console.log(`  a pass can be added until ${iso(consultation.passesUntil)}`);
console.log(`  answers close            ${iso(consultation.answersClose)}`);
console.log(`  counting closes          ${iso(consultation.countingUntil)}`);

const result = spawnSync(
  process.execPath,
  [
    '--env-file-if-exists=relayer/.env',
    '--env-file-if-exists=.env.v2.preview',
    `--env-file-if-exists=${envPath}`,
    'scripts/deploy-passport-v2.mjs',
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
