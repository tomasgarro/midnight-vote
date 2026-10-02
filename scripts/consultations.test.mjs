import { describe, expect, it } from 'vitest';
import {
  deployInputs,
  envPathFor,
  loadConsultations,
  manifestPathFor,
  parseConsultations,
  translationsOf,
} from './consultations.mjs';

const entry = (overrides = {}) => ({
  referendumId: 'ch-2026-11-29-example',
  country: null,
  passesUntil: '2026-11-27T17:00:00+01:00',
  answersClose: '2026-11-27T18:00:00+01:00',
  countingUntil: '2026-12-06T18:00:00+01:00',
  text: {
    en: { title: 'An example', question: 'Should it?', description: 'A consultation.' },
    fr: { title: 'Un exemple', question: 'Le faut-il ?', description: 'Une consultation.' },
  },
  ...overrides,
});
const file = (consultations) => ({
  registryManifest: 'deploy/passport-v2/preview.manifest.json',
  apiUrl: 'https://cico.midnight.vote',
  consultations,
});

describe('the consultations file', () => {
  it('is valid as committed, and holds the test consultation that is on chain', () => {
    const committed = loadConsultations();

    expect(committed.consultations.test.referendumId).toBe('preview-wave2-test-consultation');
    // The schedule that was deployed on 2 October 2026. Changing it here would
    // make this file disagree with the chain.
    expect(committed.consultations.test.answersClose).toBe(
      Date.parse('2026-10-09T16:00:00Z') / 1000,
    );
    expect(committed.consultations.test.passesUntil).toBe(
      Date.parse('2026-10-09T15:00:00Z') / 1000,
    );
    expect(committed.consultations.test.countingUntil).toBe(
      Date.parse('2026-10-12T16:00:00Z') / 1000,
    );
  });

  it('names the local files of a consultation by its slug', () => {
    expect(envPathFor('test')).toBe('.env.v2.preview.test');
    expect(manifestPathFor('ch-ahv')).toBe('deploy/passport-v2/preview.ch-ahv.manifest.json');
  });

  it('refuses a schedule that is out of order or has no time zone', () => {
    expect(() =>
      parseConsultations(file({ a: entry({ answersClose: '2026-11-27T16:00:00+01:00' }) })),
    ).toThrow('passesUntil <= answersClose < countingUntil');
    expect(() =>
      parseConsultations(file({ a: entry({ answersClose: '2026-11-27T18:00:00' }) })),
    ).toThrow('must say its time zone');
  });

  it('refuses text that would break the inputs file, an unknown language, or no English', () => {
    expect(() =>
      parseConsultations(
        file({
          a: entry({
            text: { en: { title: 'Two\nlines', question: 'Q?', description: 'D.' } },
          }),
        }),
      ),
    ).toThrow('single line');
    expect(() =>
      parseConsultations(file({ a: entry({ text: { ...entry().text, de: entry().text.en } }) })),
    ).toThrow('no such language');
    expect(() => parseConsultations(file({ a: entry({ text: { fr: entry().text.fr } }) }))).toThrow(
      'text.en is required',
    );
  });

  it('refuses a bad slug, a repeated id, or a country that is not a numeric code', () => {
    expect(() => parseConsultations(file({ 'Bad Slug': entry() }))).toThrow('not a usable slug');
    expect(() => parseConsultations(file({ a: entry(), b: entry() }))).toThrow('share the id');
    expect(() => parseConsultations(file({ a: entry({ country: 'FR' }) }))).toThrow(
      'three-digit ISO numeric',
    );
    expect(parseConsultations(file({ a: entry({ country: '250' }) })).consultations.a.country).toBe(
      '250',
    );
  });

  it('hands the app every language but the one the deployment records', () => {
    const parsed = parseConsultations(file({ a: entry() }));

    expect(translationsOf(parsed.consultations.a)).toEqual({
      fr: { title: 'Un exemple', question: 'Le faut-il ?', description: 'Une consultation.' },
    });
    expect(
      translationsOf(
        parseConsultations(file({ a: entry({ text: { en: entry().text.en } }) })).consultations.a,
      ),
    ).toBeNull();
  });
});

describe('the deploy inputs of a consultation', () => {
  const parsed = parseConsultations(file({ 'fr-example': entry({ country: '250' }) }));
  const consultation = parsed.consultations['fr-example'];
  const inputs = deployInputs(parsed, consultation, {
    nowSeconds: Date.parse('2026-11-01T00:00:00Z') / 1000,
    eventIdHex: 'ab'.repeat(32),
  });
  const value = (name) => inputs.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];

  it('reuse the deployed registry and never cast an answer', () => {
    expect(value('V2_REGISTRY_FROM_MANIFEST')).toBe('deploy/passport-v2/preview.manifest.json');
    expect(value('V2_EVIDENCE_PHASE')).toBe('prepare');
    expect(value('V2_MANIFEST_PATH')).toBe('deploy/passport-v2/preview.fr-example.manifest.json');
    expect(value('V2_API_URL')).toBe('https://cico.midnight.vote');
  });

  it('carry the schedule, the country rule and the English text', () => {
    expect(value('V2_OPENS_AT_UNIX')).toBe(String(Date.parse('2026-11-01T00:00:00Z') / 1000));
    expect(value('V2_ENROLLMENT_CLOSES_AT_UNIX')).toBe(String(consultation.passesUntil));
    expect(value('V2_CLOSES_AT_UNIX')).toBe(String(consultation.answersClose));
    expect(value('V2_REVEAL_CLOSES_AT_UNIX')).toBe(String(consultation.countingUntil));
    expect(value('V2_COUNTRY_POLICY')).toBe('250');
    expect(value('V2_REFERENDUM_TITLE')).toBe('An example');
    expect(value('V2_REFERENDUM_QUESTION')).toBe('Should it?');
  });

  it('hold no secret', () => {
    expect(inputs).not.toMatch(/SECRET|SEED|BLIND|SALT/);
  });

  it('refuse a consultation whose deadline for passes is already behind', () => {
    expect(() =>
      deployInputs(parsed, consultation, {
        nowSeconds: consultation.passesUntil,
        eventIdHex: 'ab'.repeat(32),
      }),
    ).toThrow('can no longer be opened');
  });
});
