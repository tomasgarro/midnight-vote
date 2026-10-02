/**
 * The consultations that are, or will be, on Midnight Preview.
 *
 * `deploy/passport-v2/consultations.json` is the one place where a
 * consultation is written down: its question in each language, who may answer
 * and its three deadlines. `deploy-consultation.mjs` puts one on chain from
 * it, and `print-consultation-values.mjs` hands its other languages to the
 * app. Everything in the file is public.
 *
 * A consultation is named by a short slug. The slug names its local files:
 * `.env.v2.preview.<slug>` (its inputs, fixed at the first deploy) and
 * `deploy/passport-v2/preview.<slug>.manifest.json` (what was deployed).
 */
import { readFileSync } from 'node:fs';

export const CONSULTATIONS_PATH = 'deploy/passport-v2/consultations.json';
const LOCALES = ['en', 'es', 'fr'];

export const envPathFor = (slug) => `.env.v2.preview.${slug}`;
export const manifestPathFor = (slug) => `deploy/passport-v2/preview.${slug}.manifest.json`;

export function loadConsultations(path = CONSULTATIONS_PATH) {
  return parseConsultations(JSON.parse(readFileSync(path, 'utf8')));
}

/** Validates the whole file. One bad entry fails it: a consultation is deployed once. */
export function parseConsultations(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The consultations file must hold an object');
  }
  const registryManifest = text(value.registryManifest, 'registryManifest');
  const apiUrl = text(value.apiUrl, 'apiUrl');
  if (!/^https:\/\/[^\s/]+$/u.test(apiUrl)) {
    throw new TypeError('apiUrl must be an https origin without a path');
  }
  const entries = value.consultations;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new TypeError('consultations must be an object keyed by slug');
  }
  const consultations = {};
  const ids = new Set();
  for (const [slug, entry] of Object.entries(entries)) {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/u.test(slug)) {
      throw new TypeError(`"${slug}" is not a usable slug: lower-case letters, digits and dashes`);
    }
    const parsed = parseConsultation(slug, entry);
    if (ids.has(parsed.referendumId)) {
      throw new TypeError(`Two consultations share the id ${parsed.referendumId}`);
    }
    ids.add(parsed.referendumId);
    consultations[slug] = parsed;
  }
  return { registryManifest, apiUrl, consultations };
}

function parseConsultation(slug, entry) {
  const label = `consultations.${slug}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`${label} must be an object`);
  }
  const referendumId = text(entry.referendumId, `${label}.referendumId`);
  if (!/^[a-z0-9][a-z0-9:-]*$/u.test(referendumId)) {
    throw new TypeError(`${label}.referendumId may hold lower-case letters, digits, ":" and "-"`);
  }
  if (entry.country !== null && !/^[0-9]{3}$/u.test(String(entry.country))) {
    // The contract stores the document's country as its ISO numeric code.
    throw new TypeError(`${label}.country must be null or a three-digit ISO numeric code`);
  }
  const passesUntil = instant(entry.passesUntil, `${label}.passesUntil`);
  const answersClose = instant(entry.answersClose, `${label}.answersClose`);
  const countingUntil = instant(entry.countingUntil, `${label}.countingUntil`);
  if (!(passesUntil <= answersClose && answersClose < countingUntil)) {
    throw new TypeError(`${label}: passesUntil <= answersClose < countingUntil must hold`);
  }
  if (!entry.text || typeof entry.text !== 'object' || Array.isArray(entry.text)) {
    throw new TypeError(`${label}.text must hold the consultation in each language`);
  }
  const copy = {};
  for (const [locale, words] of Object.entries(entry.text)) {
    if (!LOCALES.includes(locale)) {
      throw new TypeError(`${label}.text.${locale}: the app has no such language`);
    }
    copy[locale] = {
      title: line(words?.title, `${label}.text.${locale}.title`),
      question: line(words?.question, `${label}.text.${locale}.question`),
      description: line(words?.description, `${label}.text.${locale}.description`),
    };
  }
  // English is what the deployment records. The other languages reach the app.
  if (!copy.en) throw new TypeError(`${label}.text.en is required`);
  return {
    slug,
    referendumId,
    country: entry.country === null ? null : String(entry.country),
    passesUntil,
    answersClose,
    countingUntil,
    text: copy,
  };
}

/** The other languages of a consultation, as the app's catalogue carries them. */
export function translationsOf(consultation) {
  const { en: _recorded, ...others } = consultation.text;
  return Object.keys(others).length > 0 ? others : null;
}

/**
 * The deploy inputs of a consultation. `now` and `eventIdHex` are drawn once,
 * when the consultation is first prepared, and then kept: the deployment is
 * tied to them.
 */
export function deployInputs(file, consultation, { nowSeconds, eventIdHex }) {
  if (!/^[0-9a-f]{64}$/u.test(eventIdHex)) throw new TypeError('eventIdHex must be 32 bytes');
  if (!(nowSeconds < consultation.passesUntil)) {
    throw new RangeError(
      `"${consultation.slug}" can no longer be opened: its deadline for passes has passed`,
    );
  }
  return [
    '# Written by scripts/deploy-consultation.mjs. No secrets here; the role',
    '# secrets come from .env.v2.preview.',
    '',
    `V2_REFERENDUM_ID=${consultation.referendumId}`,
    `V2_EVENT_ID_HEX=${eventIdHex}`,
    `V2_MANIFEST_PATH=${manifestPathFor(consultation.slug)}`,
    `V2_REGISTRY_FROM_MANIFEST=${file.registryManifest}`,
    `V2_API_URL=${file.apiUrl}`,
    ...(consultation.country ? [`V2_COUNTRY_POLICY=${consultation.country}`] : []),
    '# The operator deploys, admits roots, closes and finalizes. No fixture',
    '# answer is cast: the answers come from people, through the app.',
    'V2_EVIDENCE_PHASE=prepare',
    '# A wallet that starts with nothing replayed 258,000 indices in about 85',
    '# minutes on 1 October 2026. Three hours leaves room for a slower night.',
    'V2_OPERATOR_SYNC_WAIT_MS=10800000',
    '',
    `V2_OPENS_AT_UNIX=${nowSeconds}`,
    `V2_ENROLLMENT_CLOSES_AT_UNIX=${consultation.passesUntil}`,
    `V2_CLOSES_AT_UNIX=${consultation.answersClose}`,
    `V2_REVEAL_CLOSES_AT_UNIX=${consultation.countingUntil}`,
    '',
    `V2_REFERENDUM_TITLE=${consultation.text.en.title}`,
    `V2_REFERENDUM_QUESTION=${consultation.text.en.question}`,
    `V2_REFERENDUM_DESCRIPTION=${consultation.text.en.description}`,
    '',
  ].join('\n');
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

/** One line of text: it is written into an env file, where a line break ends the value. */
function line(value, label) {
  const result = text(value, label);
  if (/[\r\n]/u.test(result)) throw new TypeError(`${label} must be a single line`);
  return result;
}

/** An ISO instant with its offset, as Unix seconds. */
function instant(value, label) {
  const iso = text(value, label);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(iso)) {
    throw new TypeError(`${label} must say its time zone, for example 2026-10-09T18:00:00+02:00`);
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} is not a date`);
  return Math.floor(ms / 1000);
}
