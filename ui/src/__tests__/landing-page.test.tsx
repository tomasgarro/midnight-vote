import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroHand } from '../components/landing/HeroHand';
import { HERO_ASSETS } from '../components/landing/hero-assets';
import { LandingPage } from '../components/landing/LandingPage';
import { MidnightMark } from '../components/landing/MidnightMark';
import { PASSPORT_STEPS } from '../components/landing/PassportChapter';
import { VOTE_PARTS } from '../components/landing/StartSection';

const here = dirname(fileURLToPath(import.meta.url));

/** jsdom has no media queries or observers: every query answers `matches`. */
function stubBrowser(matches: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches,
    media,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', Observer);
}

beforeEach(() => {
  stubBrowser(false);
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the landing page', () => {
  it('keeps the header to the name, two places to read and the way in', () => {
    render(<LandingPage />);
    const header = within(screen.getByRole('banner'));
    expect(header.getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
      'midnight.vote',
      'How it works',
      'Docs',
    ]);
    expect(header.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Try a poll',
    ]);
    for (const gone of ['Discover', 'Our purpose', 'Explore Midnight']) {
      expect(header.queryByText(gone)).toBeNull();
    }
  });

  it('keeps the headline, and lays the story out as a page when it cannot play', () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /Your voice\.\s*Your choice\.\s*Your secret\./u,
    );
    expect(container.querySelector('.journey')?.getAttribute('data-motion')).toBe('off');
    expect(container.querySelector('#how-it-works')?.classList.contains('pc')).toBe(true);
  });

  it('opens the poll workspace from the first row and the organiser from the second', () => {
    render(<LandingPage />);
    const doors = within(screen.getByRole('region', { name: /proves who you are/u }));
    fireEvent.click(doors.getByRole('button', { name: /Set up a poll/u }));
    expect(window.location.hash).toBe('#organizer');
    fireEvent.click(doors.getByRole('button', { name: /Try a poll/u }));
    expect(window.location.hash).toBe('#polls');

    // Both places exist in the app the landing belongs to.
    const routes = readFileSync(join(here, '..', 'RestartApp.tsx'), 'utf8');
    expect(routes).toContain("'#polls'");
    expect(routes).toContain("'#organizer'");
  });

  it('closes on one invitation in the harbour, without the quote', () => {
    const { container } = render(<LandingPage />);
    const closing = within(screen.getByRole('contentinfo'));
    expect(
      closing.getByRole('heading', { name: /Be part of a\s*bigger conversation\./u }),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Get started/u })).toHaveLength(1);
    expect(container.textContent).not.toMatch(/Margaret Mead|Never doubt/u);
  });

  it('says each step in a sentence or two, and never shortens Midnight Passport', () => {
    const { container } = render(<LandingPage />);
    // How Midnight Passport works, then what midnight.vote does with it.
    expect(PASSPORT_STEPS).toHaveLength(5);
    expect(VOTE_PARTS).toHaveLength(3);
    for (const part of [...PASSPORT_STEPS, ...VOTE_PARTS])
      expect(part.body.length).toBeLessThan(160);
    expect(PASSPORT_STEPS[0].body).toMatch(/Midnight Passport is your private home/u);
    // Its name has the shape Midnight's public Passport site gives (alice.passport.night).
    expect(container.textContent).toMatch(/yourname\.passport\.night/u);
    // Timing is only what Midnight's public roadmap says.
    for (const step of PASSPORT_STEPS)
      expect(step.when).toMatch(/^(Q4 2026|Q1 2027|In the Midnight Passport plan) · /u);
    expect(container.textContent).not.toMatch(/\.midnight\b/u);

    const text = container.textContent ?? '';
    // Gone since the 12 Nov review: the agents link and the demo note under the doors.
    expect(text).not.toMatch(/And agents\?|This is a demo/u);
    expect(text).toMatch(/Ask Cleisthenes/u);
    expect(text).not.toMatch(/never leaves|nothing leaves|per person|one person|anonymous vote/iu);
    for (const match of text.matchAll(/passport/giu)) {
      // a name such as yourname.passport.night is an address, not the product shortened
      if (text.slice(match.index ?? 0, (match.index ?? 0) + 14) === 'passport.night') continue;
      expect(text.slice((match.index ?? 0) - 9, match.index)).toBe('Midnight ');
    }
  });
});

describe('the Midnight symbol', () => {
  it('keeps the official geometry, with a ring and three squares that can move apart', () => {
    const { container } = render(<MidnightMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 789.37 789.37');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.midnight-mark__ring')).toHaveLength(1);
    const squares = [...container.querySelectorAll('.midnight-mark__square')];
    expect(squares.map((square) => square.getAttribute('y'))).toEqual([
      '123.69',
      '240.66',
      '357.64',
    ]);
    for (const square of squares) {
      expect(square.getAttribute('x')).toBe('357.64');
      expect(square.getAttribute('width')).toBe('74.09');
    }
  });
});

describe('the hand', () => {
  const props = () => ({
    assets: HERO_ASSETS,
    surfaceRef: { current: document.createElement('div') },
    revealAllowed: { current: true },
  });

  it('is one picture for a screen reader, in the frame the loop was made for', () => {
    const { container } = render(<HeroHand {...props()} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'A hand holding a Midnight Passport',
    );
    for (const picture of container.querySelectorAll('img')) {
      expect(picture.getAttribute('alt')).toBe('');
    }
    // jsdom has no WebGL, so the rest frame stands in for the loop.
    const hand = container.querySelector<HTMLImageElement>('.hero-hand__poster');
    expect(hand?.getAttribute('src')).toBe('/art/passport/human-poster.webp');
    expect(container.querySelector<HTMLElement>('.hero-hand')?.style.aspectRatio).toBe(
      '1200 / 1800',
    );
  });

  it('shows only the human hand where there is no mouse or motion', () => {
    const { container } = render(<HeroHand {...props()} />);
    expect(container.querySelector('.hero-hand__window--agent')).toBeNull();
    expect(container.querySelector('.hero-hand')?.getAttribute('data-interactive')).toBe('false');
  });

  it('says the cover in words when the picture cannot be loaded', () => {
    const { container } = render(<HeroHand {...props()} />);
    const picture = container.querySelector('.hero-hand__poster');
    if (!picture) throw new Error('The hand is missing');
    fireEvent.error(picture);
    expect(container.querySelector('.hero-hand')?.getAttribute('data-failed')).toBe('true');
    expect(container.querySelector('.hero-hand__fallback')?.textContent).toBe(
      'Your identity. Your privacy.',
    );
  });
});
