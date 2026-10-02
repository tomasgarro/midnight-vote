import { describe, expect, it } from 'vitest';
import type { PassportV2RuntimeReferendum } from '../integration/passport-v2-runtime-config';
import { localizePoll, type Poll, toRuntimePolls } from '../views/poll-model';

function policy(value: string | null): Uint8Array {
  const result = new Uint8Array(32);
  if (value) result.set(new TextEncoder().encode(value));
  return result;
}

function referendum(
  overrides: Partial<PassportV2RuntimeReferendum['config']> & {
    referendumId: string;
    contractAddress: string;
    title: string;
    question: string;
  },
): PassportV2RuntimeReferendum {
  const { referendumId, contractAddress, title, question, ...configOverrides } = overrides;
  return {
    referendumId,
    contractAddress,
    title,
    question,
    config: {
      registry: {} as PassportV2RuntimeReferendum['config']['registry'],
      eventId: new Uint8Array(32),
      organizerKey: new Uint8Array(32),
      rootPublisherKey: new Uint8Array(32).fill(1),
      opensAtUnix: 1_000n,
      enrollmentClosesAtUnix: 2_000n,
      closesAtUnix: 3_000n,
      revealClosesAtUnix: 4_000n,
      countryPolicy: new Uint8Array(32),
      countryPolicyEnabled: false,
      minimumAssurance: 0n,
      requireAdult: false,
      validityReference: 0n,
      network: 'preview',
      ...configOverrides,
    },
  };
}

describe('runtime poll catalog projection', () => {
  it('uses catalog identity and copy without retaining static fixture consultations', () => {
    const polls = toRuntimePolls([
      referendum({
        referendumId: 'runtime-policy-01',
        contractAddress: '0xruntime-contract',
        title: 'Consulta publicada en runtime',
        question: '¿Aprobás la política publicada?',
      }),
    ]);

    expect(polls).toHaveLength(1);
    expect(polls[0]).toMatchObject({
      id: 'runtime-policy-01',
      title: 'Consulta publicada en runtime',
      question: '¿Aprobás la política publicada?',
      runtimeScope: 'global',
      runtimeContractAddress: '0xruntime-contract',
    });
    expect(polls[0]?.id).not.toBe('tierras-rurales');
  });

  it('projects country policies for country routing while preserving the runtime address', () => {
    const polls = toRuntimePolls([
      {
        ...referendum({
          referendumId: 'runtime-policy-argentina',
          contractAddress: '0xcountry-contract',
          title: 'Consulta territorial',
          question: '¿Aprobás esta consulta?',
        }),
        config: {
          ...referendum({
            referendumId: 'runtime-policy-argentina',
            contractAddress: '0xcountry-contract',
            title: 'Consulta territorial',
            question: '¿Aprobás esta consulta?',
          }).config,
          countryPolicy: policy('032'),
          countryPolicyEnabled: true,
        },
      },
    ]);

    expect(polls[0]).toMatchObject({
      id: 'runtime-policy-argentina',
      runtimeScope: 'country',
      runtimeCountryCode: 'AR',
      runtimeContractAddress: '0xcountry-contract',
    });
  });

  /* The contract publishes and enforces its own schedule. Ignoring it made
     every deployed referendum read as permanently open on the screens whose
     job is to say when it closes. */
  it('takes its schedule from the contract when the catalog carries no dates', () => {
    const polls = toRuntimePolls([
      referendum({
        referendumId: 'runtime-scheduled',
        contractAddress: '0xscheduled',
        title: 'Consulta con calendario',
        question: '¿Aprobás esta consulta?',
        opensAtUnix: 1_788_000_000n,
        closesAtUnix: 1_788_600_000n,
      }),
    ]);

    expect(polls[0]?.opensAt).toBe(new Date(1_788_000_000_000).toISOString());
    expect(polls[0]?.closesAt).toBe(new Date(1_788_600_000_000).toISOString());
  });

  /* The page of a deployed consultation states what its contract enforces.
     It used to carry placeholder prose instead, which read as content. */
  it('carries the rule and the deadlines the contract enforces, and no filler', () => {
    const [poll] = toRuntimePolls([
      referendum({
        referendumId: 'runtime-facts',
        contractAddress: '0xfacts',
        title: 'Consulta con reglas',
        question: '¿Aprobás esta consulta?',
        enrollmentClosesAtUnix: 1_788_500_000n,
        closesAtUnix: 1_788_600_000n,
        revealClosesAtUnix: 1_788_900_000n,
        requireAdult: true,
        minimumAssurance: 2n,
      }),
    ]);

    expect(poll?.runtime).toEqual({
      passesUntil: new Date(1_788_500_000_000).toISOString(),
      countingUntil: new Date(1_788_900_000_000).toISOString(),
      requireAdult: true,
      minimumAssurance: 2,
    });
    expect(poll?.subject).toBe('governance');
    expect(poll?.description).toBe('');
    expect([poll?.whyNow, poll?.legalFrame, poll?.evidence, poll?.uncertainty]).toEqual([
      '',
      '',
      '',
      '',
    ]);
    expect(poll?.argumentsFor).toEqual([]);
    expect(poll?.argumentsAgainst).toEqual([]);
  });

  it('carries the other languages of a consultation', () => {
    const base = referendum({
      referendumId: 'runtime-translated',
      contractAddress: '0xtranslated',
      title: 'Results after the close',
      question: 'Should the result stay hidden until it closes?',
    });
    const [poll] = toRuntimePolls([
      {
        ...base,
        translations: {
          fr: {
            title: 'Les résultats après la clôture',
            question: 'Le résultat doit-il rester caché ?',
          },
        },
      },
    ]);

    expect(localizePoll(poll as Poll, 'fr')).toMatchObject({
      title: 'Les résultats après la clôture',
      question: 'Le résultat doit-il rester caché ?',
    });
    // A language without a translation reads the catalogue's own text.
    expect(localizePoll(poll as Poll, 'es').title).toBe('Results after the close');
  });

  it('lets the catalog override the contract schedule for display', () => {
    const base = referendum({
      referendumId: 'runtime-overridden',
      contractAddress: '0xoverridden',
      title: 'Consulta con fechas publicadas',
      question: '¿Aprobás esta consulta?',
    });
    const polls = toRuntimePolls([
      { ...base, opensAt: '2026-01-01T00:00:00.000Z', closesAt: '2026-02-01T00:00:00.000Z' },
    ]);

    expect(polls[0]?.opensAt).toBe('2026-01-01T00:00:00.000Z');
    expect(polls[0]?.closesAt).toBe('2026-02-01T00:00:00.000Z');
  });
});
