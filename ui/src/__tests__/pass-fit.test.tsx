import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import {
  answerableByPlace,
  defaultScopeForPass,
  orderForPass,
  PASS_FIT_COPY,
  passBlock,
  passBlockLine,
} from '@/views/pass-fit';
import { POLLS, type Poll } from '@/views/poll-model';
import { VotesView } from '@/views/VotesView';

vi.mock('@/views/ResultsPanel', () => ({ ResultsPanel: () => null }));

const NOW = new Date('2026-10-02T12:00:00Z');

const pass = (country: string, overrides: Partial<DemoCredentialSummary> = {}) => ({
  kind: 'synthetic-demo-credential' as const,
  issuer: 'demo',
  country,
  ageClass: '18+',
  assurance: 'fixture',
  epoch: 'preview',
  validUntil: '2026-11-01T00:00:00Z',
  ...overrides,
});

const poll = (id: string, overrides: Partial<Poll> = {}): Poll => ({
  id,
  title: `Consultation ${id}`,
  description: 'A consultation.',
  question: 'Should it?',
  deadline: 'December 31, 2026',
  opened: 'September 1, 2026',
  opensAt: '2026-09-01T00:00:00Z',
  closesAt: '2026-12-31T23:00:00Z',
  eligible: '18+',
  participation: 'Demo',
  whyNow: '',
  legalFrame: '',
  evidence: '',
  evidenceLabel: '',
  argumentsFor: [],
  argumentsAgainst: [],
  uncertainty: '',
  sources: [],
  ...overrides,
});

const country = (code: string) => ({ runtimeScope: 'country' as const, runtimeCountryCode: code });

describe('what a pass can answer', () => {
  const world = poll('world', { runtimeScope: 'global' });
  const swiss = poll('swiss', country('CH'));
  const closedArgentine = poll('ar-closed', {
    ...country('AR'),
    closesAt: '2026-08-30T12:00:00Z',
  });
  const later = poll('later', { runtimeScope: 'global', opensAt: '2026-11-01T00:00:00Z' });

  it('names one plain reason, the first that applies', () => {
    expect(passBlock(world, pass('JP'), NOW)).toBeNull();
    expect(passBlock(swiss, pass('CH'), NOW)).toBeNull();
    expect(passBlock(swiss, pass('IT'), NOW)).toEqual({ kind: 'country', country: 'CH' });
    expect(passBlock(world, pass('CH', { ageClass: 'under-18' }), NOW)).toEqual({ kind: 'age' });
    expect(passBlock(world, pass('CH', { validUntil: '2026-09-01' }), NOW)).toEqual({
      kind: 'expired',
    });
    // Closed is closed for everyone, whatever the pass.
    expect(passBlock(closedArgentine, pass('IT'), NOW)?.kind).toBe('closed');
    expect(passBlock(later, pass('CH'), NOW)?.kind).toBe('not-open');
  });

  it('says it in the reader’s language, with a passport and never a residence', () => {
    const block = { kind: 'country', country: 'CH' } as const;
    expect(passBlockLine(block, 'en')).toBe('For passports from Switzerland only.');
    expect(passBlockLine(block, 'es')).toBe('Solo para pasaportes de Suiza.');
    expect(passBlockLine(block, 'fr')).toBe('Réservé aux passeports : Suisse.');
    expect(passBlockLine({ kind: 'closed', date: closedArgentine.closesAt }, 'en')).toBe(
      'Answers closed on 30 August 2026.',
    );
    for (const locale of ['en', 'es', 'fr'] as const) {
      expect(JSON.stringify(PASS_FIT_COPY[locale].country('X'))).not.toMatch(
        /live|resid|viv|habit/i,
      );
    }
  });

  it('puts what the pass can answer first and closed consultations last', () => {
    const order = orderForPass([closedArgentine, swiss, later, world], pass('JP'), NOW);
    expect(order.map((item) => item.id)).toEqual(['world', 'swiss', 'later', 'ar-closed']);
  });

  it('opens on the pass’s country, then Global, then where it can answer most', () => {
    const catalogue = [world, swiss, closedArgentine];
    expect(defaultScopeForPass(catalogue, pass('CH'), NOW)).toEqual({
      kind: 'country',
      code: 'CH',
    });
    expect(defaultScopeForPass(catalogue, pass('AR'), NOW)).toEqual({ kind: 'world' });
    expect(defaultScopeForPass([swiss], pass('CH', { validUntil: '2020-01-01' }), NOW)).toEqual({
      kind: 'country',
      code: 'CH',
    });
    expect(answerableByPlace(catalogue, pass('JP'), NOW)).toEqual(new Map([['global', 1]]));
  });
});

describe('the demo catalogue, pass by pass', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  // Every reason a card can give in English.
  const reasons = new RegExp(
    [
      'For passports from',
      'For passes of people 18',
      'Your pass has expired',
      'Answers closed on',
      'Answers are closed',
      'Opens on',
    ].join('|'),
  );

  // Swiss, French, Italian and Argentine passes, and a country with no
  // consultation of its own.
  it.each(['CH', 'FR', 'IT', 'AR', 'JP'])('a %s pass lands on a list it can act on', (code) => {
    const onStartVote = vi.fn();
    render(
      <VotesView
        polls={POLLS}
        credential={pass(code)}
        onStartVote={onStartVote}
        onOpenPolicy={vi.fn()}
        onOpenPassportJourney={vi.fn()}
        locale="en"
      />,
    );
    const shown = screen.getAllByRole('listitem').filter((item) => item.querySelector('.poll'));
    // Never empty.
    expect(shown.length).toBeGreaterThan(0);
    // The first card is one this pass can answer now.
    const first = shown[0];
    if (!first) throw new Error('No card');
    within(first)
      .getByRole('button', { name: /Participate/ })
      .click();
    expect(onStartVote).toHaveBeenCalledTimes(1);
    // Every other card either offers to answer or says in one line why not.
    for (const card of shown) {
      const canAnswer = within(card).queryByRole('button', { name: /Participate/ });
      if (!canAnswer) expect(card.textContent).toMatch(reasons);
    }
    // It lands on a place where this pass can answer something.
    const scope = screen.getByRole('group', { name: 'Consultation scope' });
    const pressed = within(scope).getByRole('button', { pressed: true }).textContent ?? '';
    const places = [...answerableByPlace(POLLS, pass(code), NOW).keys()].map((key) =>
      key === 'global' ? 'Global' : new Intl.DisplayNames(['en'], { type: 'region' }).of(key),
    );
    expect(places.some((place) => place && pressed.includes(place))).toBe(true);
  });

  it('points a pass to the other places it can answer', () => {
    const world = poll('world', { runtimeScope: 'global' });
    const swiss = poll('swiss', country('CH'));
    render(
      <VotesView
        polls={[world, swiss]}
        credential={pass('CH')}
        onStartVote={vi.fn()}
        onOpenPolicy={vi.fn()}
        onOpenPassportJourney={vi.fn()}
        locale="en"
      />,
    );
    const scope = screen.getByRole('group', { name: 'Consultation scope' });
    expect(within(scope).getByRole('button', { pressed: true }).textContent).toContain(
      'Switzerland',
    );
    const hint = document.querySelector<HTMLElement>('.votes__elsewhere');
    if (!hint) throw new Error('No hint');
    expect(hint.textContent).toContain('Also open to your pass:');
    fireEvent.click(within(hint).getByRole('button', { name: 'Global (1)' }));
    expect(within(scope).getByRole('button', { pressed: true }).textContent).toContain('Global');
  });
});
