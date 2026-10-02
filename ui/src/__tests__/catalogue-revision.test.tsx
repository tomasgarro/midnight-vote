import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogueChat } from '@/views/CatalogueChat';
import { answerCatalogue } from '@/views/catalogue-guide';
import { POLLS } from '@/views/poll-model';

afterEach(() => vi.unstubAllGlobals());
describe('source-backed catalogue guide', () => {
  it('recognises a federal object by name and keeps sources and uncertainty grounded', () => {
    expect(answerCatalogue('Summarize the fireworks initiative', POLLS, 'en').selectedId).toBe(
      'ch-fireworks',
    );
    expect(answerCatalogue('Sources: fireworks', POLLS, 'en').text).toContain('UVEK');
    expect(answerCatalogue('What is uncertain? fireworks', POLLS, 'en').text).toContain('enforced');
    expect(answerCatalogue('Context: fireworks', POLLS, 'en').text).toContain('sparklers');
    expect(answerCatalogue('Resumir: AHV', POLLS, 'es').selectedId).toBe('ch-ahv-vat');
    expect(answerCatalogue('Résumer : réseaux sociaux', POLLS, 'fr').selectedId).toBe(
      'world-social-media-age',
    );
  });
  it('filters topics without broadening country eligibility', () => {
    const result = answerCatalogue(
      'Show open consultations about climate',
      POLLS,
      'en',
      'CH',
      undefined,
      new Date('2026-10-02T12:00:00Z'),
    );
    expect(result.pollIds).toEqual(['ch-fireworks']);
  });
  it('reveals immediately for reduced motion and exposes source links', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<CatalogueChat polls={POLLS} locale="en" onOpenPolicy={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sources: fireworks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('link', { name: /UVEK/ }).getAttribute('href')).toContain(
      'uvek.admin.ch',
    );
  });
  it('clearing a pending response prevents it returning later', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const change = vi.fn();
    render(
      <CatalogueChat polls={POLLS} locale="en" onOpenPolicy={vi.fn()} onMessagesChange={change} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show global consultations' }));
    expect(screen.getByRole('status').textContent).toContain('Finding catalogue context');
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenLastCalledWith([]);
  });
});
