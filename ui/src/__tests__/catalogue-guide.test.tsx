import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatalogueChat } from '@/views/CatalogueChat';
import { BottomNav } from '@/views/Chrome';
import { answerCatalogue, hasValidatedPassport } from '@/views/catalogue-guide';
import { localizePoll, POLLS } from '@/views/poll-model';

const now = new Date('2026-10-02T12:00:00Z');
describe('catalogue guide boundaries', () => {
  it('returns open global and verified-country projects, not another country', () => {
    const answer = answerCatalogue(
      'What polls are open for me?',
      POLLS,
      'en',
      'FR',
      undefined,
      now,
    );
    expect(answer.pollIds).toContain('world-social-media-age');
    expect(answer.pollIds).toContain('france-mobilite');
    expect(answer.pollIds).not.toContain('tierras-rurales');
    expect(
      answerCatalogue('Show global consultations', POLLS, 'en', 'FR', undefined, now).pollIds,
    ).toEqual(['world-social-media-age']);
  });
  it('allows explicit country browsing without pretending to establish identity', () => {
    const answer = answerCatalogue('Open polls in France', POLLS, 'en', undefined, undefined, now);
    expect(answer.pollIds).toContain('france-mobilite');
    expect(answer.scope).toBe('France + Global');
  });
  it('excludes closed, future and malformed schedules', () => {
    const invalid = POLLS.map((p) => ({ ...p, closesAt: 'invalid' }));
    expect(answerCatalogue('open polls', invalid, 'en', undefined, undefined, now).pollIds).toEqual(
      [],
    );
    expect(
      answerCatalogue('open polls', POLLS, 'en', undefined, undefined, new Date('2030-01-01'))
        .pollIds,
    ).toEqual([]);
  });
  it('uses authored summaries and follows up without inventing a project', () => {
    const poll = POLLS.find((p) => p.id === 'france-mobilite');
    expect(poll).toBeDefined();
    if (!poll) return;
    const p = localizePoll(poll, 'en');
    const answer = answerCatalogue(`Summarize ${p.title}`, POLLS, 'en');
    expect(answer.text).toBe(p.description);
    expect(answerCatalogue('What are the arguments?', POLLS, 'en', undefined, p.id).text).toContain(
      p.argumentsAgainst[0],
    );
    expect(
      answerCatalogue('Summarize the imaginary moon project', POLLS, 'en', undefined, p.id)
        .selectedId,
    ).toBeUndefined();
  });
  it('does not upgrade a demo or expired credential to a validated passport', () => {
    const c = {
      kind: 'verified-credential' as const,
      assurance: 'document-nfc',
      country: 'FR',
      issuer: 'test',
      epoch: '1',
      ageClass: '18+',
      validUntil: '2026-12-01',
    };
    expect(hasValidatedPassport(c, now)).toBe(true);
    expect(hasValidatedPassport({ ...c, kind: 'synthetic-demo-credential' }, now)).toBe(false);
    expect(hasValidatedPassport({ ...c, validUntil: '2026-01-01' }, now)).toBe(false);
  });
  it('reaches the guide from the bar, with or without a pass', () => {
    const change = vi.fn();
    render(<BottomNav tab="consultations" onChange={change} locale="en" />);
    screen.getByRole('button', { name: 'Cleisthenes' }).click();
    expect(change).toHaveBeenCalledWith('cleisthenes');
    expect(screen.queryByRole('button', { name: /Verify/ })).toBeNull();
  });
  it('lists the consultations that have a reviewed brief, and opens one', async () => {
    const open = vi.fn();
    const [first, second] = POLLS;
    if (!first || !second) throw new Error('The catalogue is empty');
    render(<CatalogueChat polls={POLLS} locale="en" onOpenPolicy={open} briefIds={[second.id]} />);

    const briefs = screen.getByRole('region', { name: 'Briefs from the official record' });
    expect(within(briefs).getAllByRole('button')).toHaveLength(1);
    within(briefs)
      .getByRole('button', { name: localizePoll(second, 'en').title })
      .click();
    expect(open).toHaveBeenCalledWith(second.id);
    // The chat itself stays what it is, and says so.
    expect(screen.getByText(/Generative AI is not connected/)).toBeTruthy();
  });
  it('shows no list of briefs when no consultation has one', () => {
    render(<CatalogueChat polls={POLLS} locale="en" onOpenPolicy={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Briefs from the official record' })).toBeNull();
  });
});
