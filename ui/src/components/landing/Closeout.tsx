import { ArrowUpRight } from '@phosphor-icons/react';
import './closeout.css';
import { LakeScene } from './LakeScene';
import { StartSection } from './StartSection';

/**
 * The end of the page: the doors, then the Geneva harbour as the last scene. The invitation and the
 * links are set in the harbour's sky, so the picture stays whole.
 */
export function LandingEnd({
  onStart,
  onOrganise,
}: {
  onStart: () => void;
  onOrganise: () => void;
}) {
  return (
    <div className="landing-end">
      <StartSection onAnswer={onStart} onOrganise={onOrganise} />
      <footer className="closeout">
        <LakeScene />
        <div className="closeout__sky">
          <h2>
            Be part of a<br />
            <span>bigger conversation.</span>
          </h2>
          <button type="button" className="midnight-cta" onClick={onStart}>
            Get started{' '}
            <span>
              <ArrowUpRight className="landing-action-arrow" size={20} weight="bold" />
            </span>
          </button>
          <nav className="closeout__links" aria-label="Footer navigation">
            <button type="button" onClick={onStart}>
              Try a poll
            </button>
            <button type="button" onClick={onOrganise}>
              Run a poll
            </button>
            <a href="#how-it-works">How it works</a>
            <a href="/docs">Docs</a>
            <a href="https://midnight.network" target="_blank" rel="noreferrer">
              Midnight <ArrowUpRight className="landing-action-arrow" size={13} />
            </a>
            <a href="https://www.midnight.city/" target="_blank" rel="noreferrer">
              Midnight City <ArrowUpRight className="landing-action-arrow" size={13} />
            </a>
            <a
              href="https://discord.com/invite/midnightnetwork?utm_source=midnight.vote&utm_medium=referral&utm_campaign=community&utm_content=footer"
              target="_blank"
              rel="noreferrer"
            >
              Discord <ArrowUpRight className="landing-action-arrow" size={13} />
            </a>
            <a href="https://t.me/midnightswitzerland" target="_blank" rel="noreferrer">
              Midnight Switzerland <ArrowUpRight className="landing-action-arrow" size={13} />
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
