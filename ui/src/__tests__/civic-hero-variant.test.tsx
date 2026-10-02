import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CivicHeroArt, heroVariantFrom } from '@/components/landing/CivicHeroArt';

describe('the hero picture', () => {
  it('keeps the approved lake by default and shows the portico only behind its flag', () => {
    expect(heroVariantFrom('')).toBe('lake');
    expect(heroVariantFrom('?hero=lake')).toBe('lake');
    expect(heroVariantFrom('?hero=Portico')).toBe('lake');
    expect(heroVariantFrom('?utm=x&hero=portico')).toBe('portico');
  });

  it('draws the lake picture without a portico', () => {
    const { container } = render(<CivicHeroArt />);
    expect(screen.getByRole('img', { name: 'Cleisthenes, the guide, before an alpine lake' }));
    expect(container.querySelector('.civic-art__portico')).toBeNull();
    expect(container.querySelector('.civic-art')?.getAttribute('data-variant')).toBe('lake');
  });

  it('stands him in a portico above the same lake when asked', () => {
    const { container } = render(<CivicHeroArt variant="portico" />);
    expect(
      screen.getByRole('img', {
        name: 'Cleisthenes, the guide, in a portico above an alpine lake',
      }),
    );
    const layers = [...container.querySelectorAll('.civic-art__window img')].map((image) =>
      image.getAttribute('src'),
    );
    // The lake, then the colonnade, then the guide in front of it.
    expect(layers).toEqual([
      '/art/civic/alpine-lake.webp',
      '/art/civic/portico.webp',
      '/art/civic/cleisthenes-bust.webp',
    ]);
  });
});
