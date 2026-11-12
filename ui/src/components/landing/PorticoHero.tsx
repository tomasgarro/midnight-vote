import { ArrowDown, ArrowUpRight } from '@phosphor-icons/react';
import { type RefObject, useEffect, useRef } from 'react';
import { HeroHand } from './HeroHand';
import type { HeroAssets } from './hero-assets';

const WORDS = ['voice.', 'choice.', 'secret.'] as const;

/**
 * The opening: a hand holding a Midnight Passport inside a portico, under one line whose last word
 * turns from voice to choice to secret. Scrolling then flies through the portico and into the
 * symbol on the cover (see PassportJourney).
 */
export function PorticoHero({
  assets,
  onStart,
  revealAllowed,
}: {
  assets: HeroAssets;
  onStart: () => void;
  revealAllowed: RefObject<boolean>;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  // The hand starts right under the buttons, whatever the window: the copy's height is measured.
  useEffect(() => {
    const surface = surfaceRef.current;
    const copy = copyRef.current;
    if (!surface || !copy) return;
    const measure = () => surface.style.setProperty('--copy-end', `${copy.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(copy);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="ph" ref={surfaceRef}>
      <div className="ph-sky" aria-hidden="true">
        <img src={assets.sky} alt="" width="1376" height="768" fetchPriority="high" />
      </div>
      <div className="ph-hand-wrap">
        <HeroHand assets={assets} surfaceRef={surfaceRef} revealAllowed={revealAllowed} />
      </div>
      <div className="ph-portico" aria-hidden="true">
        <img className="ph-portico__whole" src={assets.columns} alt="" />
        <img className="ph-portico__side ph-portico__side--left" src={assets.columns} alt="" />
        <img className="ph-portico__side ph-portico__side--right" src={assets.columns} alt="" />
      </div>
      <div className="ph-copy" ref={copyRef}>
        <h1 id="landing-title" className="ph-title">
          <span className="ph-title__said">Your voice. Your choice. Your secret.</span>
          <span className="ph-title__line" aria-hidden="true">
            Your{' '}
            <span className="ph-rotor">
              {WORDS.map((word) => (
                <em key={word}>{word}</em>
              ))}
            </span>
          </span>
        </h1>
        <div className="ph-actions">
          <button type="button" className="midnight-cta" onClick={onStart}>
            Try a poll{' '}
            <span>
              <ArrowUpRight className="landing-action-arrow" size={20} weight="bold" />
            </span>
          </button>
          <a className="ph-more" href="#how-it-works">
            See how it works
            <span aria-hidden="true">
              <ArrowDown size={18} weight="bold" />
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
