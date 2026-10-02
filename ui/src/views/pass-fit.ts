import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import { countryName } from '@/integration/country-catalog';
import { formatDate } from '@/integration/format';
import type { CicoLocale } from '@/integration/locale';
import { getPollAvailability } from '@/integration/poll-lifecycle';
import type { DiscoveryScope } from '@/integration/product-boundaries';
import { type Poll, pollCountryCode, pollPlaceCode } from './poll-model';

/**
 * What a pass can do with each consultation, and why not when it cannot.
 *
 * One reason per consultation, the first that applies: a closed consultation
 * is closed for everyone, so that comes before anything about the pass.
 */
export type PassBlock =
  | { readonly kind: 'not-open'; readonly date: string }
  | { readonly kind: 'closed'; readonly date: string | null }
  | { readonly kind: 'expired' }
  | { readonly kind: 'age' }
  | { readonly kind: 'country'; readonly country: string };

function isAdult(credential: DemoCredentialSummary): boolean {
  return credential.ageClass === '18+' || credential.ageClass === '18-plus';
}

/** Null when the pass can answer now. Without a pass, only the clock is checked. */
export function passBlock(
  poll: Poll,
  credential: DemoCredentialSummary | null,
  now: Date = new Date(),
): PassBlock | null {
  let availability: ReturnType<typeof getPollAvailability>;
  try {
    availability = getPollAvailability(poll, now);
  } catch {
    return { kind: 'closed', date: null };
  }
  if (availability.reason === 'not-open') return { kind: 'not-open', date: poll.opensAt };
  if (!availability.isOpen) {
    return {
      kind: 'closed',
      date: availability.reason === 'closed-by-clock' ? poll.closesAt : null,
    };
  }
  if (!credential) return null;
  if (!(Date.parse(credential.validUntil) > now.getTime())) return { kind: 'expired' };
  if (!isAdult(credential)) return { kind: 'age' };
  const required = pollCountryCode(poll);
  if (required && required !== credential.country.trim().toUpperCase()) {
    return { kind: 'country', country: required };
  }
  return null;
}

export const PASS_FIT_COPY = {
  en: {
    notOpen: (date: string) => `Opens on ${date}.`,
    closed: (date: string | null) => (date ? `Answers closed on ${date}.` : 'Answers are closed.'),
    expired: 'Your pass has expired. Renew it to answer.',
    age: 'For passes of people 18 and over.',
    country: (country: string) => `For passports from ${country} only.`,
    elsewhere: 'Also open to your pass:',
    global: 'Global',
  },
  es: {
    notOpen: (date: string) => `Abre el ${date}.`,
    closed: (date: string | null) =>
      date ? `Las respuestas cerraron el ${date}.` : 'Las respuestas están cerradas.',
    expired: 'Tu pase venció. Renovalo para responder.',
    age: 'Para pases de personas de 18 años o más.',
    country: (country: string) => `Solo para pasaportes de ${country}.`,
    elsewhere: 'También abiertas para tu pase:',
    global: 'Global',
  },
  fr: {
    notOpen: (date: string) => `Ouvre le ${date}.`,
    closed: (date: string | null) =>
      date ? `Réponses closes le ${date}.` : 'Les réponses sont closes.',
    expired: 'Votre laissez-passer a expiré. Renouvelez-le pour répondre.',
    age: 'Pour les laissez-passer des personnes de 18 ans et plus.',
    country: (country: string) => `Réservé aux passeports : ${country}.`,
    elsewhere: 'Aussi ouvertes à votre laissez-passer :',
    global: 'Monde',
  },
} as const;

/** The one plain line that says why a pass cannot answer. */
export function passBlockLine(block: PassBlock, locale: CicoLocale): string {
  const copy = PASS_FIT_COPY[locale];
  switch (block.kind) {
    case 'not-open':
      return copy.notOpen(formatDate(block.date, locale) ?? block.date);
    case 'closed':
      return copy.closed(block.date ? (formatDate(block.date, locale) ?? null) : null);
    case 'expired':
      return copy.expired;
    case 'age':
      return copy.age;
    case 'country':
      return copy.country(countryName(block.country, locale));
  }
}

/** Answerable first, then open, then the rest; the catalogue order otherwise. */
export function orderForPass(
  polls: readonly Poll[],
  credential: DemoCredentialSummary | null,
  now: Date = new Date(),
): Poll[] {
  const rank = (poll: Poll) => {
    const block = passBlock(poll, credential, now);
    if (!block) return 0;
    return block.kind === 'closed' ? 2 : 1;
  };
  return polls
    .map((poll, index) => ({ poll, index, rank: rank(poll) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ poll }) => poll);
}

/** The place a consultation is listed under. Who may answer it is `passBlock`'s question. */
function scopeKey(poll: Poll): string {
  return pollPlaceCode(poll) ?? 'global';
}

/** How many consultations this pass can answer now, per place ('global' for Global). */
export function answerableByPlace(
  polls: readonly Poll[],
  credential: DemoCredentialSummary | null,
  now: Date = new Date(),
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!credential) return counts;
  for (const poll of polls) {
    if (passBlock(poll, credential, now)) continue;
    const key = scopeKey(poll);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Where a pass opens the list: its own country when it can answer something
 * there, then Global, then the place with the most it can answer. A pass that
 * can answer nothing opens on its own country, where the reasons are shown.
 */
export function defaultScopeForPass(
  polls: readonly Poll[],
  credential: DemoCredentialSummary | null,
  now: Date = new Date(),
): DiscoveryScope {
  if (!credential) return { kind: 'world' };
  const own = credential.country.trim().toUpperCase();
  const counts = answerableByPlace(polls, credential, now);
  if (counts.get(own)) return { kind: 'country', code: own };
  if (counts.get('global')) return { kind: 'world' };
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return { kind: 'country', code: best[0] };
  return { kind: 'country', code: own };
}
