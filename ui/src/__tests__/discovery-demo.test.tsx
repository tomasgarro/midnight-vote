import { describe, expect, it } from 'vitest';
import {
  answerCatalogue,
  canUseCatalogueDialogue,
  hasValidatedPassport,
} from '@/views/catalogue-guide';
import { canUseDemoPass } from '@/views/discovery-presentation';
import {
  DEFAULT_POLL,
  isCountryPollForCountry,
  localizePoll,
  meetsCountryPolicy,
  POLLS,
  pollCountryCode,
  pollPlaceCode,
} from '@/views/poll-model';

const now = new Date('2026-10-02T12:00:00Z');
const demo = {
  kind: 'synthetic-demo-credential' as const,
  issuer: 'test',
  country: 'CH',
  ageClass: '18+',
  assurance: 'fixture',
  epoch: 'test',
  validUntil: '2026-12-01',
};
describe('demo discovery', () => {
  it('opens dialogue for a demo without claiming verification or enabling it in real mode', () => {
    expect(canUseCatalogueDialogue(demo, true, now)).toBe(true);
    expect(canUseCatalogueDialogue(demo, false, now)).toBe(false);
    expect(hasValidatedPassport(demo, now)).toBe(false);
    expect(canUseCatalogueDialogue({ ...demo, validUntil: '2020-01-01' }, true, now)).toBe(false);
  });
  it('lists the World question and the Swiss federal objects for a Swiss pass', () => {
    const result = answerCatalogue(
      'What polls are open for me?',
      POLLS,
      'en',
      'CH',
      undefined,
      now,
    );
    expect(result.pollIds).toEqual([
      'world-social-media-age',
      'ch-ahv-vat',
      'ch-war-materiel',
      'ch-married-couples-tax',
      'ch-fireworks',
    ]);
    expect(DEFAULT_POLL.id).toBe('world-social-media-age');
  });
  it('checks age, country and expiry on each simulated participation', () => {
    const swiss = POLLS.find((p) => p.id === 'ch-fireworks');
    const french = POLLS.find((p) => p.id === 'france-mobilite');
    if (!swiss || !french) throw Error('Missing fixture');
    expect(canUseDemoPass(swiss, demo, now)).toBe(true);
    // The Swiss objects are an open pulse: a passport from elsewhere may answer.
    expect(canUseDemoPass(swiss, { ...demo, country: 'IT' }, now)).toBe(true);
    expect(canUseDemoPass(swiss, { ...demo, ageClass: 'under-18' }, now)).toBe(false);
    expect(canUseDemoPass(swiss, { ...demo, validUntil: '2020-01-01' }, now)).toBe(false);
    // A country rule still holds where there is one.
    expect(canUseDemoPass(french, demo, now)).toBe(false);
    expect(canUseDemoPass(french, { ...demo, country: 'FR' }, now)).toBe(true);
    expect(canUseDemoPass(DEFAULT_POLL, { ...demo, ageClass: 'under-18' }, now)).toBe(false);
  });
  it('lists the open pulse under Switzerland without making it Swiss-only', () => {
    const swiss = POLLS.find((p) => p.id === 'ch-ahv-vat');
    if (!swiss) throw Error('Missing fixture');
    expect(pollPlaceCode(swiss)).toBe('CH');
    expect(pollCountryCode(swiss)).toBeNull();
    expect(isCountryPollForCountry(swiss, 'CH')).toBe(true);
    expect(meetsCountryPolicy(swiss, 'AR')).toBe(true);
  });
  it('gives every subject a question, a summary, an official source and a date', () => {
    for (const poll of POLLS.filter((p) => p.milestone)) {
      for (const locale of ['en', 'es', 'fr'] as const) {
        const copy = localizePoll(poll, locale);
        expect(copy.question.endsWith('?')).toBe(true);
        expect(copy.description.length).toBeGreaterThan(40);
        expect(copy.sources[0]?.href).toMatch(/^https:\/\//);
        expect(copy.argumentsFor[0]).toMatch(/:/);
        expect(copy.argumentsAgainst[0]).toMatch(/:/);
      }
      expect(Number.isNaN(Date.parse(poll.milestone?.date ?? ''))).toBe(false);
    }
    expect(POLLS.filter((p) => p.milestone)).toHaveLength(5);
  });
  it('localizes the subjects in all three supported languages', () => {
    const swiss = POLLS.find((p) => p.id === 'ch-fireworks');
    if (!swiss) throw Error('Missing fixture');
    expect(localizePoll(swiss, 'fr').title).toBe('Limiter les feux d’artifice');
    expect(localizePoll(swiss, 'en').title).toBe('Limiting fireworks');
    expect(localizePoll(swiss, 'es').title).toBe('Limitar la pirotecnia');
    expect(localizePoll(swiss, 'fr').sources[0]?.href).toContain('/fr/');
  });
});
