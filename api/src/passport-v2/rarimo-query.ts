import type { RarimoVerificationRequest } from './rarimo-types.js';

/**
 * The one shape of Rarimo query this product asks for, written once: the app
 * builds its verification request from it, and the credential service refuses
 * a request that is not of this shape.
 *
 * The request is made by the browser, so the service cannot take its bounds on
 * trust. A query circuit proves only the constraints its selector switches on,
 * against the bounds the request names. A request with the adult bit off, or
 * with a birth-date bound of today, yields a valid proof for a child; one with
 * a loose identity counter yields a valid proof, and a fresh nullifier, for a
 * passport registered a second time. The proof is sound in each case. What it
 * proves is not what a pass says.
 */

/** Selector bits of the query circuit, as Rarimo numbers them. */
export const RARIMO_SELECTOR_BITS = {
  /** Reveals the nullifier: the same for one identity under one event. */
  nullifier: 1 << 0,
  /** Reveals the citizenship. */
  citizenship: 1 << 5,
  /** Proves the identity was registered before `timestampUpperBound`. */
  timestampUpperBound: 1 << 9,
  /** Proves the passport was registered fewer times than `identityCounterUpperBound`. */
  identityCounterUpperBound: 1 << 11,
  /** Proves the passport expires after `expirationDateLowerBound`. */
  expirationDateLowerBound: 1 << 12,
  /** Proves the holder was born before `birthDateUpperBound`. */
  birthDateUpperBound: 1 << 15,
} as const;

/** What the circuit takes for a date that is not constrained: "000000". */
export const RARIMO_UNUSED_DATE_HEX = '0x303030303030';

/**
 * The passport's identity may not have been registered again. A second
 * registration draws a new identity key, and with it a new nullifier: the
 * document would look like another document. The circuit proves the counter
 * is below this bound.
 */
export const RARIMO_IDENTITY_COUNTER_UPPER_BOUND = '1';

/** Age a pass of class `18-plus` attests. */
export const RARIMO_ADULT_AGE_YEARS = 18;

/** How far the browser's date may be from the service's. */
const DATE_TOLERANCE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** The selector of a verification: with or without the proof of age. */
export function rarimoQuerySelector(requireAdult: boolean): number {
  return (
    RARIMO_SELECTOR_BITS.nullifier |
    RARIMO_SELECTOR_BITS.citizenship |
    RARIMO_SELECTOR_BITS.timestampUpperBound |
    RARIMO_SELECTOR_BITS.identityCounterUpperBound |
    RARIMO_SELECTOR_BITS.expirationDateLowerBound |
    (requireAdult ? RARIMO_SELECTOR_BITS.birthDateUpperBound : 0)
  );
}

/** A date as a passport writes it, YYMMDD in ASCII, as a hexadecimal number. */
export function rarimoAsciiDateHex(date: Date): string {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  let hex = '';
  for (const character of `${yy}${mm}${dd}`) {
    hex += character.charCodeAt(0).toString(16).padStart(2, '0');
  }
  return `0x${hex}`;
}

/** The latest birth date of a person who is an adult on `now`. */
export function rarimoAdultBirthDateBound(now: Date): string {
  const threshold = new Date(now);
  threshold.setUTCFullYear(threshold.getUTCFullYear() - RARIMO_ADULT_AGE_YEARS);
  return rarimoAsciiDateHex(threshold);
}

function daysAround(now: Date): Date[] {
  const days: Date[] = [];
  for (let offset = -DATE_TOLERANCE_DAYS; offset <= DATE_TOLERANCE_DAYS; offset += 1) {
    days.push(new Date(now.getTime() + offset * DAY_MS));
  }
  return days;
}

const sameHex = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Why a verification request is not one this product makes, or null when it
 * is. `now` is the checker's clock; the request's dates may differ from it by
 * two days, for a device whose clock or time zone is off.
 *
 * | Checked | So that |
 * | --- | --- |
 * | The selector is exactly one of the two this product uses | Every constraint below is proven, and nothing else is revealed |
 * | The identity counter bound is at most 1 | A passport registered again cannot come back as a new document |
 * | The expiry bound is today | The pass is not issued for an expired passport |
 * | With the proof of age: the birth-date bound is today, 18 years ago | `18-plus` means 18 |
 * | Without it: the birth-date bound is unused | A pass's age class follows from the bound alone |
 */
export function rarimoVerificationRequestProblem(
  request: Pick<
    RarimoVerificationRequest,
    'selector' | 'identityCounterUpperBound' | 'expirationDateLowerBound' | 'birthDateUpperBound'
  >,
  now: Date,
): string | null {
  const withAge = String(rarimoQuerySelector(true));
  const withoutAge = String(rarimoQuerySelector(false));
  if (request.selector !== withAge && request.selector !== withoutAge) {
    return 'The verification does not ask for the proofs a pass depends on';
  }
  if (!/^(0|1)$/u.test(request.identityCounterUpperBound)) {
    return 'The verification must exclude a passport that was registered again';
  }
  const days = daysAround(now);
  if (!days.some((day) => sameHex(rarimoAsciiDateHex(day), request.expirationDateLowerBound))) {
    return 'The verification must prove the passport is valid today';
  }
  if (request.selector === withAge) {
    if (!days.some((day) => sameHex(rarimoAdultBirthDateBound(day), request.birthDateUpperBound))) {
      return 'The verification must prove the age of majority as of today';
    }
  } else if (!sameHex(request.birthDateUpperBound, RARIMO_UNUSED_DATE_HEX)) {
    return 'A verification without a proof of age must not name a birth date';
  }
  return null;
}
