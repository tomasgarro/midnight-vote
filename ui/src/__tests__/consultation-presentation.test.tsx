import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PolicyDetailView } from '@/views/PolicyDetailView';
import type { Poll } from '@/views/poll-model';
import { ResultsPanel } from '@/views/ResultsPanel';
import { VotesView } from '@/views/VotesView';

// The public tally is read from the contract; here it is set by each test.
const tally = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('@/views/use-public-referendum-state', () => ({
  usePublicReferendumState: () => ({ state: tally.current, error: null, loading: false }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  tally.current = null;
});

const poll = (overrides: Partial<Poll> = {}): Poll => ({
  id: 'global-rules',
  title: 'Open rules',
  description: 'A public consultation.',
  question: 'Should the rules be published?',
  deadline: 'October 4, 2026',
  opened: 'August 29, 2026',
  opensAt: '2026-08-29T00:00:00.000Z',
  closesAt: '2026-10-04T12:00:00.000Z',
  eligible: 'Any pass',
  participation: '100 responses',
  whyNow: 'Written for the demo.',
  legalFrame: 'Product governance.',
  evidence: 'Public evidence.',
  evidenceLabel: 'FACT',
  argumentsFor: ['A reason for.'],
  argumentsAgainst: ['A reason against.'],
  uncertainty: 'Unknown.',
  sources: [],
  ...overrides,
});

const pass = {
  kind: 'synthetic-demo-credential' as const,
  issuer: 'demo',
  country: 'FR',
  ageClass: '18+',
  assurance: 'fixture',
  epoch: 'preview',
  validUntil: '2026-11-30T00:00:00Z',
};

describe('a consultation card', () => {
  it('says its state in one line, in words, without a coloured pill', () => {
    render(
      <VotesView
        polls={[poll(), poll({ id: 'old', title: 'Old', closesAt: '2026-08-30T12:00:00Z' })]}
        credential={null}
        onStartVote={vi.fn()}
        onOpenPolicy={vi.fn()}
        onOpenPassportJourney={vi.fn()}
        locale="en"
      />,
    );
    const metas = [...document.querySelectorAll('.poll__meta')].map((node) =>
      node.textContent?.replace(/\s+/gu, ' ').trim(),
    );
    expect(metas).toEqual([
      'Open·Closes 4 October 2026·Simulated',
      'Closed·30 August 2026·Simulated',
    ]);
    expect(document.querySelector('.poll__status--open')).toBeNull();
    // The subject is a small decorative tile, not a block of its own.
    for (const tile of document.querySelectorAll('.poll-media')) {
      expect(tile.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('reminds the reader that this device already answered, and opens the receipt', () => {
    const openAnswers = vi.fn();
    const startVote = vi.fn();
    render(
      <VotesView
        polls={[poll({ runtimeScope: 'country', runtimeCountryCode: 'FR' })]}
        credential={pass}
        answeredIds={['global-rules']}
        onOpenAnswers={openAnswers}
        onStartVote={startVote}
        onOpenPolicy={vi.fn()}
        onOpenPassportJourney={vi.fn()}
        locale="en"
      />,
    );
    const card = screen
      .getByRole('heading', { name: 'Open rules' })
      .closest('.poll') as HTMLElement;
    expect(within(card).getByText('You answered on this device.')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Participate/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'See your receipt' }));
    expect(openAnswers).toHaveBeenCalledOnce();
    expect(startVote).not.toHaveBeenCalled();
  });

  it('lists consultations and nothing else: no results panel without a consultation', () => {
    render(
      <VotesView
        polls={[poll()]}
        credential={null}
        onStartVote={vi.fn()}
        onOpenPolicy={vi.fn()}
        onOpenPassportJourney={vi.fn()}
        locale="en"
      />,
    );
    expect(screen.queryByText('Public results')).toBeNull();
  });
});

describe('the consultation page', () => {
  const show = (item: Poll) =>
    render(
      <PolicyDetailView
        poll={item}
        onBack={vi.fn()}
        onStartVote={vi.fn()}
        credential={null}
        onOpenPassportJourney={vi.fn()}
        locale="en"
      />,
    );

  it('names its sections in headings and its options in neutral words', () => {
    show(poll());
    expect(screen.getByRole('heading', { level: 2, name: 'Perspectives' })).toBeTruthy();
    expect(screen.getByText('For')).toBeTruthy();
    expect(screen.getByText('Against')).toBeTruthy();
    expect(screen.getByText('You support the proposal as it is asked.')).toBeTruthy();
    expect(screen.queryByText(/prioritising/u)).toBeNull();
  });

  it('shows a Preview consultation’s results and no prose written for another one', () => {
    show(poll({ runtimeContractAddress: 'contract-1', whyNow: 'Esta consulta se publica…' }));
    expect(screen.queryByText('Esta consulta se publica…')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Perspectives' })).toBeNull();
    expect(screen.getByText('Public results')).toBeTruthy();
  });
});

describe('the public results', () => {
  const state = (yes: bigint, no: bigint, abstain: bigint) => ({
    phase: 'REVEAL',
    issuedVotes: 500n,
    tally: new Map([
      ['YES', yes],
      ['NO', no],
      ['ABSTAIN', abstain],
    ]),
  });

  it('says so when nothing is counted, with no 0% bar', () => {
    tally.current = state(0n, 0n, 0n);
    render(<ResultsPanel contractAddress="contract-1" locale="en" />);
    expect(screen.getByText('No answer has been counted yet.')).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('shows counts without percentages below 100 counted answers', () => {
    tally.current = state(12n, 7n, 1n);
    render(<ResultsPanel contractAddress="contract-1" locale="en" />);
    expect(
      screen.getByText('Below 100 counted answers, the numbers are shown without percentages.'),
    ).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.queryByText(/%/u)).toBeNull();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('gives each share with its count from 100 counted answers', () => {
    tally.current = state(60n, 30n, 10n);
    render(<ResultsPanel contractAddress="contract-1" locale="en" />);
    expect(screen.getByText('60.0% (60)')).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  });
});
