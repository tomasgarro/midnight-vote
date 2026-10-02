import {
  ArrowUpRight,
  ChatCircle,
  Check,
  LockKey,
  Robot,
  Sparkle,
  UsersThree,
} from '@phosphor-icons/react';
import { useState } from 'react';
import './landing-finale.css';
import { LakeScene } from './LakeScene';
import { SelectiveDisclosureScene } from './SelectiveDisclosureScene';

export function LandingFinale({ onStart }: { onStart: () => void }) {
  const [audience, setAudience] = useState<'humans' | 'agents'>('humans');
  const human = audience === 'humans';
  return (
    <>
      <section className="future-section" id="discover" aria-labelledby="future-title">
        <div className="future-header">
          <div className="future-heading">
            <p className="how-kicker">ROOM FOR DIFFERENT FUTURES</p>
            <h2 id="future-title">
              Better conversations.
              <br />
              <span>New possibilities.</span>
            </h2>
            <p>Privacy gives participation room to grow.</p>
          </div>
          <fieldset
            className="future-switch"
            aria-label="Explore participation for humans or agents"
          >
            <button type="button" aria-pressed={human} onClick={() => setAudience('humans')}>
              <UsersThree size={19} /> Humans
            </button>
            <button type="button" aria-pressed={!human} onClick={() => setAudience('agents')}>
              <Robot size={19} /> Agents <small>Looking ahead</small>
            </button>
          </fieldset>
        </div>
        <div className="future-panel" key={audience}>
          <div className={`future-art future-art--${audience}`}>
            {human ? (
              <SelectiveDisclosureScene />
            ) : (
              <img
                className="future-city-image"
                src="/art/city/midnight-city-without-button.webp"
                alt="Two explorers and a robot overlooking Midnight City beneath a luminous night sky"
                loading="lazy"
                width="1122"
                height="1402"
              />
            )}
          </div>
          <div className="future-copy" aria-live="polite">
            <p className="future-label">
              {human ? 'HUMANS / START HERE' : 'AGENTS / A FUTURE CONCEPT'}
            </p>
            <h3>
              {human ? (
                <>
                  More informed.
                  <br />
                  Still your decision.
                </>
              ) : (
                <>
                  What could a city
                  <br />
                  decide together?
                </>
              )}
            </h3>
            <p>
              {human
                ? 'Understand your community. Join the conversation with more context and control over what you share.'
                : 'We’re exploring how agents could take part in the shared affairs of Midnight City — with clear rules for identity, participation, and accountability.'}
            </p>
            <ul>
              {human ? (
                <>
                  <li>
                    <Check size={18} />
                    <span>
                      <strong>Try it today</strong>Learn about privacy, explore a demo consultation,
                      and ask Cleisthenes what it is about.
                    </span>
                  </li>
                  <li>
                    <Sparkle size={18} />
                    <span>
                      <strong>On the horizon · Selective disclosure</strong>Prove citizenship — in
                      Argentina, Italy, or elsewhere — without sharing identity details. Join
                      verified-citizen conversations or opt-in consultations using attributes like
                      gender.
                    </span>
                  </li>
                  <li>
                    <ChatCircle size={18} />
                    <span>
                      <strong>Starting now · AI for civic understanding</strong>Cleisthenes explains
                      a consultation from its sources and never says how to answer. Research on
                      politicians and wider issues comes later.
                    </span>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <ChatCircle size={18} />
                    <span>
                      <strong>Explore shared decisions</strong>A future space for agents to
                      deliberate on city priorities.
                    </span>
                  </li>
                  <li>
                    <LockKey size={18} />
                    <span>
                      <strong>Keep the lanes clear</strong>Agent participation would be separate
                      from human-only consultations. It is not available in this demo.
                    </span>
                  </li>
                </>
              )}
            </ul>
            {human ? (
              <button type="button" className="how-action" onClick={onStart}>
                Start with the human journey{' '}
                <ArrowUpRight className="landing-action-arrow" size={19} />
              </button>
            ) : (
              <a
                className="how-action"
                href="https://www.midnight.city/"
                target="_blank"
                rel="noreferrer"
              >
                Explore Midnight City <ArrowUpRight className="landing-action-arrow" size={19} />
              </a>
            )}
          </div>
        </div>
      </section>
      <section className="finale-quote" id="our-purpose" aria-label="Our purpose">
        <span className="finale-quote-mark" aria-hidden="true">
          “
        </span>
        <blockquote>
          Never doubt that a small group of thoughtful, committed citizens can change the world.
          Indeed, it’s the only thing that ever has.
        </blockquote>
        <p>Attributed to Margaret Mead</p>
      </section>
      <section className="finale-invitation" aria-labelledby="invitation-title">
        <div>
          <h2 id="invitation-title">
            Be part of a<br />
            <span>bigger conversation.</span>
          </h2>
          <button type="button" className="midnight-cta" onClick={onStart}>
            Get started{' '}
            <span>
              <ArrowUpRight className="landing-action-arrow" size={22} />
            </span>
          </button>
          <small>Non-binding demo · simulated eligibility</small>
        </div>
      </section>
    </>
  );
}

export function LandingFooter() {
  return (
    <footer className="finale-footer">
      <LakeScene />
      <div className="finale-footer__top">
        <div>
          <a className="midnight-brand" href="#landing-main">
            <img src="/brand/midnight-vote-d3-black.svg" width="43" height="25" alt="" />
            <span>
              midnight<span className="midnight-brand__suffix">.vote</span>
            </span>
          </a>
          <p>
            A little privacy.
            <br />A world of possibility.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <div>
            <strong>Take part</strong>
            <a href="#how-it-works">How it works</a>
            <a href="#discover">Humans & agents</a>
            <a href="#our-purpose">Our purpose</a>
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
  );
}
