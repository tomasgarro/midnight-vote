import { ArrowUpRight } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import './landing-header.css';

/**
 * Three things only: the name, two places to read, and the way in. It steps aside while the page
 * scrolls down and comes back as soon as the reader scrolls up or tabs into it.
 */
export function LandingHeader({ onStart }: { onStart: () => void }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        if (Math.abs(y - last) < 6) return;
        setHidden(y > 120 && y > last);
        last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header className="landing-header" data-hidden={hidden}>
      <a className="midnight-brand" href="#landing-main" aria-label="midnight.vote home">
        <img src="/brand/midnight-vote-d3-black.svg" width="40" height="23" alt="" />
        <span>
          midnight<span className="midnight-brand__suffix">.vote</span>
        </span>
      </a>
      <nav className="landing-header__links" aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a href="/docs">Docs</a>
      </nav>
      <button type="button" className="landing-header__start" onClick={onStart}>
        Try a poll <ArrowUpRight className="landing-action-arrow" size={16} />
      </button>
    </header>
  );
}
