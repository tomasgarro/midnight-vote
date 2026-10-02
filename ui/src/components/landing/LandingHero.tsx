import { ArrowDown, ArrowUpRight, List, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { CivicHeroArt, heroVariantFrom } from './CivicHeroArt';
import './landing-hero.css';

export function LandingHero({ onStart }: { onStart: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [heroVariant] = useState(() => heroVariantFrom(window.location.search));
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  return (
    <>
      <header className="midnight-nav">
        {/* biome-ignore lint/a11y/useValidAnchor: Native anchor navigation also dismisses the menu. */}
        <a
          className="midnight-brand"
          href="#landing-main"
          aria-label="midnight.vote home"
          onClick={() => {
            setMenuOpen(false);
          }}
        >
          <img src="/brand/midnight-vote-d3-black.svg" width="43" height="25" alt="" />
          <span>
            midnight<span className="midnight-brand__suffix">.vote</span>
          </span>
        </a>
        <nav className="midnight-nav__links" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#discover">Discover</a>
          <a href="#our-purpose">Our purpose</a>
          <a href="/docs">Docs</a>
          <a href="https://midnight.network" target="_blank" rel="noreferrer">
            Explore Midnight <ArrowUpRight className="landing-action-arrow" size={14} />
          </a>
        </nav>
        <button type="button" className="midnight-nav__start" onClick={onStart}>
          Get started <ArrowUpRight className="landing-action-arrow" size={17} />
        </button>
        <button
          ref={menuButton}
          className="midnight-nav__toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="midnight-mobile-nav"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={22} /> : <List size={22} />}
        </button>
        <nav
          id="midnight-mobile-nav"
          className="midnight-nav__mobile"
          aria-label="Mobile navigation"
          hidden={!menuOpen}
        >
          {/* biome-ignore lint/a11y/useValidAnchor: Native section navigation also dismisses the menu. */}
          <a
            href="#discover"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            Discover <ArrowDown size={18} />
          </a>
          <a href="/docs">
            Docs <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          {/* biome-ignore lint/a11y/useValidAnchor: Native section navigation also dismisses the menu. */}
          <a
            href="#how-it-works"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            How it works <ArrowDown size={18} />
          </a>
          {/* biome-ignore lint/a11y/useValidAnchor: Native section navigation also dismisses the menu. */}
          <a
            href="#our-purpose"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            Our purpose <ArrowDown size={18} />
          </a>
          <a
            href="https://midnight.network"
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            Explore Midnight <ArrowUpRight className="landing-action-arrow" size={18} />
          </a>
        </nav>
      </header>
      <section className="midnight-hero" aria-labelledby="landing-title" data-motion="intro">
        <div className="midnight-hero__layout">
          <div className="midnight-hero__copy">
            <p className="midnight-hero__eyebrow">
              <span /> A new space for civic participation
            </p>
            <h1 id="landing-title">
              Your voice.
              <br />
              Your choice.
              <br />
              <em>Your secret.</em>
            </h1>
            <p className="midnight-hero__lead">
              Be part of the conversation.
              <br />
              Keep what makes you, you.
            </p>
            <p className="midnight-hero__description">
              Discover a more private way to participate — with zero-knowledge technology built on
              Midnight.
            </p>
            <div className="midnight-hero__actions">
              <button type="button" className="midnight-cta" onClick={onStart}>
                Get started{' '}
                <span>
                  <ArrowUpRight className="landing-action-arrow" size={22} />
                </span>
              </button>
              <a
                className="midnight-hero__learn"
                href="https://midnight.network"
                target="_blank"
                rel="noreferrer"
              >
                Explore Midnight <ArrowUpRight className="landing-action-arrow" size={18} />
              </a>
            </div>
          </div>
          <CivicHeroArt variant={heroVariant} />
        </div>
      </section>
    </>
  );
}
