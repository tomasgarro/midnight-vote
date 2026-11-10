import { ArrowDown, ArrowUpRight } from '@phosphor-icons/react';
import { type RefObject, useRef } from 'react';
import { HeroHand } from './HeroHand';
import type { HeroAssets } from './hero-assets';

/**
 * The opening: a hand holding a Midnight Passport between two columns. On a large screen the page
 * then flies through the columns into the symbol on the cover (see PassportJourney).
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
  return (
    <div className="ph" ref={surfaceRef}>
      <div className="ph-sky" aria-hidden="true">
        <img src={assets.sky} alt="" width="1376" height="768" fetchPriority="high" />
      </div>
      <div className="ph-hand-wrap">
        <HeroHand assets={assets} surfaceRef={surfaceRef} revealAllowed={revealAllowed} />
      </div>
      <div className="ph-columns" aria-hidden="true">
        <img className="ph-column ph-column--left" src={assets.columns} alt="" />
        <img className="ph-column ph-column--right" src={assets.columns} alt="" />
      </div>
      <div className="ph-copy">
        <h1 id="landing-title">
          <span>Your voice.</span> <span>Your choice.</span>
          <br />
          <em>Your secret.</em>
        </h1>
        <p className="ph-lead">Be part of the conversation. Keep what makes you, you.</p>
        <div className="ph-actions">
          <button type="button" className="midnight-cta" onClick={onStart}>
            Try a poll{' '}
            <span>
              <ArrowUpRight className="landing-action-arrow" size={22} />
            </span>
          </button>
          <a className="ph-more" href="#how-it-works">
            How it works <ArrowDown size={18} />
          </a>
        </div>
      </div>
    </div>
  );
}
