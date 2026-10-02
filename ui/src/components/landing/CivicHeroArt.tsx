import { useState } from 'react';
import './civic-hero-art.css';

export type CivicHeroVariant = 'lake' | 'portico';

/** `?hero=portico` shows the Greek variant, for comparison. The lake stays the default. */
export function heroVariantFrom(search: string): CivicHeroVariant {
  return new URLSearchParams(search).get('hero') === 'portico' ? 'portico' : 'lake';
}

/**
 * The hero picture: Cleisthenes before an alpine lake, in an arched frame.
 *
 * The `portico` variant stands him in a colonnade above the same lake. It is
 * made only of approved brand pictures and is shown only behind a flag until
 * it is approved.
 *
 * Decorative only. It shows the guide and the place, and it changes nothing
 * about the visitor's pass or session.
 */
export function CivicHeroArt({ variant = 'lake' }: { variant?: CivicHeroVariant }) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className="civic-art" data-variant={variant}>
      <div
        className="civic-art__stage"
        data-failed={failed}
        role="img"
        aria-label={
          variant === 'portico'
            ? 'Cleisthenes, the guide, in a portico above an alpine lake'
            : 'Cleisthenes, the guide, before an alpine lake'
        }
      >
        <div className="civic-art__frame" aria-hidden="true">
          <div className="civic-art__window">
            <img
              className="civic-art__view"
              src="/art/civic/alpine-lake.webp"
              alt=""
              width="1376"
              height="768"
              fetchPriority="high"
              draggable="false"
              onError={() => setFailed(true)}
            />
            {variant === 'portico' ? (
              <img
                className="civic-art__portico"
                src="/art/civic/portico.webp"
                alt=""
                width="1376"
                height="768"
                draggable="false"
                onError={() => setFailed(true)}
              />
            ) : null}
            <img
              className="civic-art__guide"
              src="/art/civic/cleisthenes-bust.webp"
              alt=""
              width="760"
              height="930"
              draggable="false"
              onError={() => setFailed(true)}
            />
          </div>
        </div>
        {failed && <p className="civic-art__fallback">Your voice. Your choice. Your secret.</p>}
      </div>
    </figure>
  );
}
