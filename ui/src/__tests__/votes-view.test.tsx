import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Poll } from '@/views/poll-model';
import { VotesView } from '@/views/VotesView';

vi.mock('@/views/ResultsPanel', () => ({
  ResultsPanel: () => null,
}));

const poll = (overrides: Partial<Poll> = {}): Poll => ({
  id: 'global-rules',
  title: 'Open rules',
  description: 'A public consultation.',
  question: 'Should the rules be published?',
  deadline: 'October 4, 2026',
  opened: 'August 29, 2026',
  opensAt: '2026-08-29T00:00:00.000Z',
  closesAt: '2026-10-04T23:59:59.000Z',
  eligible: 'Any pass',
  participation: '100 responses',
  whyNow: 'The rules are changing.',
  legalFrame: 'Product governance.',
  evidence: 'Public evidence.',
  evidenceLabel: 'FACT',
  argumentsFor: ['For'],
  argumentsAgainst: ['Against'],
  uncertainty: 'Unknown.',
  sources: [],
  ...overrides,
});

const credential = {
  kind: 'synthetic-demo-credential' as const,
  issuer: 'demo',
  country: 'FR',
  ageClass: '18+',
  assurance: 'fixture',
  epoch: 'preview',
  validUntil: '2026-09-30',
};

function renderVotes(polls: readonly Poll[], onStartVote = vi.fn()) {
  render(
    <VotesView
      polls={polls}
      credential={credential}
      onStartVote={onStartVote}
      onOpenPolicy={vi.fn()}
      onOpenPassportJourney={vi.fn()}
      locale="en"
    />,
  );
  return onStartVote;
}

describe('VotesView scope discovery', () => {
  it('puts published countries first while searching the complete catalogue', async () => {
    const user = userEvent.setup();
    renderVotes([
      poll(),
      poll({
        id: 'italy-consultation',
        title: 'Italy consultation',
        runtimeScope: 'country',
        runtimeCountryCode: 'IT',
      }),
    ]);

    // The pass is French and France has no consultation, so France gets a chip
    // of its own after the places that have one.
    const places = screen.getByRole('group', { name: 'Consultation scope' });
    expect(
      within(places)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim() || button.getAttribute('aria-label')),
    ).toEqual([
      'Global',
      expect.stringMatching(/Italy$/),
      expect.stringMatching(/France$/),
      'More places',
    ]);
    expect(within(places).getByRole('button', { name: /France/, pressed: true })).toBeTruthy();

    await user.click(within(places).getByRole('button', { name: 'More places' }));
    expect(screen.getByText('Consultations available')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Italy/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Japan/ })).toBeNull();

    await user.type(screen.getByRole('searchbox', { name: 'Consultation scope' }), 'Japan');
    expect(screen.getByRole('radio', { name: /Japan/ })).toBeTruthy();
  });

  it('normalizes runtime country scopes and keeps browsing separate from eligibility', async () => {
    const user = userEvent.setup();
    const onStartVote = renderVotes([
      poll(),
      poll({
        id: 'italy-consultation',
        title: 'Italy consultation',
        runtimeScope: 'country',
        runtimeCountryCode: ' it ',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /Italy/ }));

    expect(screen.getByRole('button', { name: /Italy/, pressed: true })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Italy' })).toBeTruthy();
    // One place at a time: the global consultation is not listed under Italy.
    expect(screen.queryByText('Open rules')).toBeNull();
    expect(screen.getByText('Italy consultation')).toBeTruthy();
    expect(screen.getByText(/This does not prove eligibility/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add eligibility/i })).toBeTruthy();
    expect(onStartVote).not.toHaveBeenCalled();
  });

  it('shows the subject filter only when there is a list to shorten', async () => {
    const user = userEvent.setup();
    const italian = (index: number, subject: Poll['subject']) =>
      poll({
        id: `italy-${index}`,
        title: `Italy consultation ${index}`,
        runtimeScope: 'country',
        runtimeCountryCode: 'IT',
        ...(subject ? { subject } : {}),
      });
    renderVotes([
      poll(),
      italian(1, 'housing'),
      italian(2, 'housing'),
      italian(3, 'mobility'),
      italian(4, 'mobility'),
      italian(5, 'climate'),
    ]);

    // A hidden group has no accessible name, so it is found by its class.
    const subjects = document.querySelector<HTMLElement>('.discovery-subjects');
    if (!subjects) throw new Error('The subject filter is missing');
    expect(subjects.hasAttribute('hidden')).toBe(true);
    expect(screen.queryByRole('group', { name: 'All subjects' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Italy/ }));
    expect(screen.getByRole('group', { name: 'All subjects' })).toBe(subjects);
    await user.click(within(subjects).getByRole('button', { name: 'Housing' }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });
});
