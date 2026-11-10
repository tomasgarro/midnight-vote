import { ArrowUpRight } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import './closeout.css';
import { LakeScene } from './LakeScene';
import { StartSection } from './StartSection';

/**
 * The end of the page. The doors panel scrolls up off the harbour, which is already there beneath
 * it; the one invitation sits in the harbour's sky, and the links on a slim ledger at its foot.
 */
export function LandingEnd({
  onStart,
  onOrganise,
}: {
  onStart: () => void;
  onOrganise: () => void;
}) {
  const edge = useRef<HTMLDivElement>(null);
  const closeout = useRef<HTMLElement>(null);

  // Tabbing into the harbour first moves the doors panel out of the way, so focus is never hidden.
  useEffect(() => {
    const element = closeout.current;
    if (!element) return;
    const uncover = () => {
      const covered = edge.current?.getBoundingClientRect().top ?? 0;
      if (covered > 0) window.scrollBy({ top: covered, behavior: 'instant' });
    };
    element.addEventListener('focusin', uncover);
    return () => element.removeEventListener('focusin', uncover);
  }, []);
  return (
    <div className="landing-end">
      <StartSection onAnswer={onStart} onOrganise={onOrganise} />
      <div ref={edge} className="landing-end__edge" aria-hidden="true" />
      <footer ref={closeout} className="closeout">
        <LakeScene trigger={edge} />
        <div className="closeout__invite">
          <h2 id="closeout-title">
            Be part of a<br />
            <span>bigger conversation.</span>
          </h2>
          <button type="button" className="midnight-cta" onClick={onStart}>
            Get started{' '}
            <span>
              <ArrowUpRight className="landing-action-arrow" size={22} />
            </span>
          </button>
        </div>
        <div className="closeout__ledger">
          <div className="closeout__brand">
            <a className="midnight-brand" href="#landing-main">
              <img src="/brand/midnight-vote-d3-black.svg" width="40" height="23" alt="" />
              <span>
                midnight<span className="midnight-brand__suffix">.vote</span>
              </span>
            </a>
            <p>A little privacy. A world of possibility.</p>
          </div>
          <nav aria-label="Footer navigation">
            <div>
              <strong>Take part</strong>
              <button type="button" onClick={onStart}>
                Try a poll
              </button>
              <button type="button" onClick={onOrganise}>
                Run a poll
              </button>
              <a href="#how-it-works">How it works</a>
              <a href="/docs">Docs</a>
            </div>
            <div>
              <strong>Explore</strong>
              <a href="https://midnight.network" target="_blank" rel="noreferrer">
                Midnight <ArrowUpRight className="landing-action-arrow" size={14} />
              </a>
              <a href="https://www.midnight.city/" target="_blank" rel="noreferrer">
                Midnight City <ArrowUpRight className="landing-action-arrow" size={14} />
              </a>
              <a
                href="https://discord.com/invite/midnightnetwork?utm_source=midnight.vote&utm_medium=referral&utm_campaign=community&utm_content=footer"
                target="_blank"
                rel="noreferrer"
              >
                Midnight Discord <ArrowUpRight className="landing-action-arrow" size={14} />
              </a>
              <a href="https://t.me/midnightswitzerland" target="_blank" rel="noreferrer">
                Midnight Switzerland <ArrowUpRight className="landing-action-arrow" size={14} />
              </a>
            </div>
          </nav>
        </div>
      </footer>
    </div>
  );
}
