import { render, screen } from '@testing-library/react';
import type { ReferendumV2State } from 'midnight-referendum-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PolicyDetailView } from '@/views/PolicyDetailView';
import type { Poll } from '@/views/poll-model';
import { ResultsPanel } from '@/views/ResultsPanel';

/* What a deployed consultation shows a person: the facts its contract
   enforces, in their language, and never placeholder prose. */

const publicState = vi.hoisted(() => ({
  current: { state: null, error: null, loading: false } as {
    state: Partial<ReferendumV2State> | null;
    error: string | null;
    loading: boolean;
  },
}));
vi.mock('@/views/use-public-referendum-state', () => ({
  usePublicReferendumState: () => publicState.current,
}));
vi.mock('@/views/app-runtime', async (original) => ({
  ...(await original<typeof import('@/views/app-runtime')>()),
  CHAIN_RUNTIME_ENABLED: true,
}));

const NOW = Date.parse('2026-10-05T10:00:00Z');

const deployed = (overrides: Partial<Poll> = {}): Poll => ({
  id: 'preview-wave2-test-consultation',
  title: 'Results after the close',
  question: 'Should the result of a consultation stay hidden until it closes?',
  description: 'A test consultation on Midnight Preview.',
  subject: 'governance',
  deadline: '',
  opened: '',
  opensAt: '2026-10-01T22:00:00.000Z',
  closesAt: '2026-10-09T16:00:00.000Z',
  eligible: '—',
  participation: '',
  whyNow: '',
  legalFrame: '',
  evidence: '',
  evidenceLabel: '',
  argumentsFor: [],
  argumentsAgainst: [],
  uncertainty: '',
  sources: [],
  runtimeScope: 'global',
  runtimeContractAddress: 'ab'.repeat(32),
  runtime: {
    passesUntil: '2026-10-09T15:00:00.000Z',
    countingUntil: '2026-10-12T16:00:00.000Z',
    requireAdult: true,
    minimumAssurance: 2,
  },
  translations: {
    fr: {
      title: 'Les résultats après la clôture',
      question: "Le résultat d'une consultation doit-il rester caché jusqu'à sa clôture ?",
      description: 'Une consultation de test sur Midnight Preview.',
    },
  },
  ...overrides,
});

function renderPage(poll: Poll, locale: 'es' | 'en' | 'fr' = 'en') {
  return render(
    <PolicyDetailView
      poll={poll}
      onBack={vi.fn()}
      onStartVote={vi.fn()}
      credential={null}
      onOpenPassportJourney={vi.fn()}
      locale={locale}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the page of a deployed consultation', () => {
  it('states the three deadlines and the rule its contract enforces', () => {
    renderPage(deployed());

    expect(screen.getByText('Answers close')).toBeTruthy();
    expect(screen.getByText('A pass can be added until')).toBeTruthy();
    expect(screen.getByText('Your answer can be counted until')).toBeTruthy();
    expect(screen.getByText('Who can answer')).toBeTruthy();
    expect(screen.getByText('Adults with a passport read by its chip')).toBeTruthy();
  });

  it('shows the description and none of the editorial sections it has no text for', () => {
    renderPage(deployed());

    expect(screen.getByText('A test consultation on Midnight Preview.')).toBeTruthy();
    for (const heading of ['Perspectives', 'Uncertainty', 'Current framework']) {
      expect(screen.queryByText(heading)).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(/manifiesto|catálogo v2|manifest|catalog/i);
  });

  it('says what each answer means without assuming a proposal', () => {
    renderPage(deployed());

    expect(screen.getByText('You answer yes to the question.')).toBeTruthy();
    expect(
      screen.getByText('You take no position. Your answer is counted as undecided.'),
    ).toBeTruthy();
  });

  it('reads in the language the person chose', () => {
    renderPage(deployed(), 'fr');

    expect(screen.getByRole('heading', { name: 'Les résultats après la clôture' })).toBeTruthy();
    expect(screen.getByText('Une consultation de test sur Midnight Preview.')).toBeTruthy();
    expect(screen.getByText('Les adultes avec un passeport lu par sa puce')).toBeTruthy();
  });

  it('names the document country as a country of the document, never a residence', () => {
    renderPage(deployed({ runtimeScope: 'country', runtimeCountryCode: 'FR' }));

    expect(screen.getByText('Adults with a passport read by its chip from France')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/resident|living in|lives in/i);
  });

  it('after the close, drops the pass deadline and offers no action', () => {
    renderPage(deployed({ closesAt: '2026-10-04T16:00:00.000Z' }));

    expect(screen.getByText('Answers closed')).toBeTruthy();
    expect(screen.queryByText('A pass can be added until')).toBeNull();
    // Counting is still possible until its own deadline.
    expect(screen.getByText('Your answer can be counted until')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /vote|eligibility/i })).toBeNull();
  });

  it('keeps the demo page as it was for a consultation that is not deployed', () => {
    renderPage(
      deployed({
        runtimeContractAddress: undefined,
        runtime: undefined,
        whyNow: 'The rules are changing.',
        eligible: 'Any pass',
      }),
    );

    expect(screen.getByText('The rules are changing.')).toBeTruthy();
    expect(screen.queryByText('Who can answer')).toBeNull();
  });
});

describe('the public results of a deployed consultation', () => {
  const state = (overrides: Partial<ReferendumV2State>): Partial<ReferendumV2State> => ({
    phase: 'COMMIT',
    issuedVotes: 3n,
    closesAtUnix: BigInt(Date.parse('2026-10-09T16:00:00Z') / 1000),
    tally: new Map([
      ['YES', 0n],
      ['NO', 0n],
      ['ABSTAIN', 0n],
    ]),
    ...overrides,
  });

  it('counts sealed answers, not eligible people', () => {
    publicState.current = { state: state({}), error: null, loading: false };
    render(<ResultsPanel contractAddress={'ab'.repeat(32)} locale="en" />);

    expect(screen.getByText('Answers open')).toBeTruthy();
    expect(screen.getByText('sealed answers')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/eligible/i);
  });

  it('says answers are closed once the closing time has passed, before the count starts', () => {
    publicState.current = {
      state: state({ closesAtUnix: BigInt(Date.parse('2026-10-04T16:00:00Z') / 1000) }),
      error: null,
      loading: false,
    };
    render(<ResultsPanel contractAddress={'ab'.repeat(32)} locale="en" />);

    expect(screen.getByText('Answers closed')).toBeTruthy();
    expect(screen.queryByText('Answers open')).toBeNull();
    expect(
      screen.getByText(/Counting starts once the consultation is closed on chain/),
    ).toBeTruthy();
  });

  it('reports counted answers against sealed ones while counting', () => {
    publicState.current = {
      state: state({
        phase: 'REVEAL',
        tally: new Map([
          ['YES', 2n],
          ['NO', 0n],
          ['ABSTAIN', 0n],
        ]),
      }),
      error: null,
      loading: false,
    };
    render(<ResultsPanel contractAddress={'ab'.repeat(32)} locale="en" />);

    expect(screen.getByText('Counting in progress')).toBeTruthy();
    expect(screen.getByText('2 counted of 3 sealed · read from the contract')).toBeTruthy();
  });
});
