import { useState } from 'react';
import './civic-hero-art.css';

/**
 * The hero picture: Cleisthenes before an alpine lake, in an arched frame.
 *
 * Decorative only. It shows the guide and the place, and it changes nothing
 * about the visitor's pass or session.
 */
export function CivicHeroArt() {
  const [failed, setFailed] = useState(false);

  return (
    <figure className="civic-art">
      <div
        className="civic-art__stage"
        data-failed={failed}
        role="img"
        aria-label="Cleisthenes, the guide, before an alpine lake"
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
