import { describe, expect, it } from 'vitest';
import {
  RARIMO_UNUSED_DATE_HEX,
  rarimoAdultBirthDateBound,
  rarimoAsciiDateHex,
  rarimoQuerySelector,
  rarimoVerificationRequestProblem,
} from './rarimo-query.js';

const now = new Date('2026-10-02T07:30:00.000Z');
const day = 24 * 60 * 60 * 1_000;

/** What the app asks for on `at`, with or without the proof of age. */
function asked(requireAdult: boolean, at: Date = now) {
  return {
    selector: String(rarimoQuerySelector(requireAdult)),
    identityCounterUpperBound: '1',
    expirationDateLowerBound: rarimoAsciiDateHex(at),
    birthDateUpperBound: requireAdult ? rarimoAdultBirthDateBound(at) : RARIMO_UNUSED_DATE_HEX,
  };
}

describe('the one shape of query this product asks Rarimo for', () => {
  it('has the two selectors Rarimo documents for these proofs', () => {
    // nullifier, citizenship, timestamp and identity-counter upper bounds, expiry.
    expect(rarimoQuerySelector(false)).toBe(0b0001101000100001);
    // The same, with the birth-date upper bound.
    expect(rarimoQuerySelector(true)).toBe(0b1001101000100001);
  });

  it('writes a date as a passport does', () => {
    // "261002" in ASCII.
    expect(rarimoAsciiDateHex(now)).toBe('0x323631303032');
    // Eighteen years earlier: "081002".
    expect(rarimoAdultBirthDateBound(now)).toBe('0x303831303032');
  });

  it('accepts what the app asks for, with and without the proof of age', () => {
    expect(rarimoVerificationRequestProblem(asked(true), now)).toBeNull();
    expect(rarimoVerificationRequestProblem(asked(false), now)).toBeNull();
  });

  it('allows a device whose date is up to two days off, and no more', () => {
    for (const offset of [-2, -1, 1, 2]) {
      const device = new Date(now.getTime() + offset * day);
      expect(rarimoVerificationRequestProblem(asked(true, device), now)).toBeNull();
    }
    for (const offset of [-3, 3, 400]) {
      const device = new Date(now.getTime() + offset * day);
      expect(rarimoVerificationRequestProblem(asked(true, device), now)).toMatch(/today/u);
    }
  });

  it('refuses a selector that leaves a proof out, or adds one', () => {
    const selector = rarimoQuerySelector(true);
    for (const bit of [0, 5, 9, 11, 12]) {
      expect(
        rarimoVerificationRequestProblem(
          { ...asked(true), selector: String(selector & ~(1 << bit)) },
          now,
        ),
      ).toBe('The verification does not ask for the proofs a pass depends on');
    }
    // Revealing the name, or the document number, is not something a pass needs.
    for (const bit of [3, 7]) {
      expect(
        rarimoVerificationRequestProblem(
          { ...asked(true), selector: String(selector | (1 << bit)) },
          now,
        ),
      ).not.toBeNull();
    }
  });

  it('refuses the ways to an 18-plus pass that prove no age', () => {
    // The bound named, the constraint switched off: nothing about age is proven.
    expect(
      rarimoVerificationRequestProblem(
        { ...asked(true), selector: String(rarimoQuerySelector(false)) },
        now,
      ),
    ).toBe('A verification without a proof of age must not name a birth date');
    // The constraint on, with a bound that everybody alive meets.
    expect(
      rarimoVerificationRequestProblem(
        { ...asked(true), birthDateUpperBound: rarimoAsciiDateHex(now) },
        now,
      ),
    ).toBe('The verification must prove the age of majority as of today');
    // The constraint on, with no bound at all.
    expect(
      rarimoVerificationRequestProblem(
        { ...asked(true), birthDateUpperBound: RARIMO_UNUSED_DATE_HEX },
        now,
      ),
    ).not.toBeNull();
  });

  it('refuses a passport registered again, which would show a new nullifier', () => {
    for (const bound of ['2', '10', '99999', '01', '-1', '1.0', '']) {
      expect(
        rarimoVerificationRequestProblem({ ...asked(true), identityCounterUpperBound: bound }, now),
      ).toBe('The verification must exclude a passport that was registered again');
    }
    expect(
      rarimoVerificationRequestProblem({ ...asked(true), identityCounterUpperBound: '0' }, now),
    ).toBeNull();
  });

  it('refuses an expiry bound in the past: the pass would outlive the passport', () => {
    expect(
      rarimoVerificationRequestProblem(
        { ...asked(true), expirationDateLowerBound: RARIMO_UNUSED_DATE_HEX },
        now,
      ),
    ).toBe('The verification must prove the passport is valid today');
    expect(
      rarimoVerificationRequestProblem(
        { ...asked(true), expirationDateLowerBound: '0x323030313031' },
        now,
      ),
    ).not.toBeNull();
  });

  it('reads the hexadecimal dates without regard to case', () => {
    const request = asked(true, new Date('2026-12-31T00:00:00.000Z'));
    expect(
      rarimoVerificationRequestProblem(
        { ...request, expirationDateLowerBound: request.expirationDateLowerBound.toUpperCase() },
        new Date('2026-12-31T23:00:00.000Z'),
      ),
    ).toBeNull();
  });
});
