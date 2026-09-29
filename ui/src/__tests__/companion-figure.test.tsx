import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionFigure, type CompanionPose } from '../components/companion';

const POSES: readonly CompanionPose[] = [
  'welcome',
  'explain',
  'passport',
  'waiting',
  'success',
  'reassure',
];

describe('the companion', () => {
  it.each(POSES)('keeps one face for the %s pose and marks the pose beside it', (pose) => {
    const { container } = render(<CompanionFigure pose={pose} />);

    const figure = container.querySelector('.companion-figure');
    expect(figure?.getAttribute('data-pose')).toBe(pose);
    const pictures = container.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.getAttribute('src')).toMatch(/cleisthenes-bust/u);
    // The picture is one image. The badge is an icon outside it.
    expect(container.querySelector('.onboarding-mascot__image svg')).toBeNull();
    expect(container.querySelectorAll('.companion-figure__badge svg')).toHaveLength(1);
  });

  it('shows a different badge for every pose', () => {
    const badges = POSES.map((pose) => {
      const { container, unmount } = render(<CompanionFigure pose={pose} />);
      const drawing = container.querySelector('.companion-figure__badge svg')?.innerHTML ?? '';
      unmount();
      return drawing;
    });

    expect(new Set(badges).size).toBe(POSES.length);
  });

  it('is decorative: hidden from screen readers, with no text of its own', () => {
    const { container } = render(<CompanionFigure pose="welcome" />);

    const figure = container.querySelector('.companion-figure');
    expect(figure?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(container.textContent).toBe('');
  });

  it('stays still unless motion is asked for, and loads first only when told to', () => {
    const still = render(<CompanionFigure pose="explain" />);
    expect(still.container.querySelector('.companion-figure')?.getAttribute('data-motion')).toBe(
      'false',
    );
    expect(still.container.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    still.unmount();

    const first = render(<CompanionFigure pose="welcome" motion priority />);
    expect(first.container.querySelector('.companion-figure')?.getAttribute('data-motion')).toBe(
      'true',
    );
    expect(first.container.querySelector('img')?.getAttribute('loading')).toBe('eager');
  });
});

describe('where the companion may appear', () => {
  it('is on no consent, eligibility or ballot screen', () => {
    const views = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');
    const decisionScreens = ['VoteFlow.tsx', 'PolicyDetailView.tsx', 'ConsultationBrief.tsx'];
    expect(readdirSync(views)).toEqual(expect.arrayContaining(decisionScreens));

    for (const file of decisionScreens) {
      const source = readFileSync(join(views, file), 'utf8');
      expect(source, `${file} shows the companion`).not.toMatch(/CompanionFigure/u);
    }
  });
});
