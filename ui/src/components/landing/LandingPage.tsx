import { Check, Fingerprint, LockKey } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { persistLocale } from '@/integration/locale';
import { HowItWorks } from './HowItWorks';
import { LandingFinale, LandingFooter } from './LandingFinale';
import './landing.css';
import { LandingHero } from './LandingHero';
import './landing-actions.css';

export function LandingPage() {
  useEffect(() => {
    document.documentElement.lang = 'en';
    document.title = 'midnight.vote — Connect. Vote. Verify.';
  }, []);
  const start = () => {
    persistLocale('en');
    window.location.hash = 'polls';
  };
  return (
    <div className="civic-landing">
      <a className="landing-skip" href="#landing-main">
        Skip to content
      </a>
      <main id="landing-main">
        <LandingHero onStart={start} />
        <div className="landing-bridge">
          <div>
            <LockKey size={25} weight="thin" />
            <span>
              <strong>Connect Midnight Passport.</strong>
              <small>Your account. Your consent.</small>
            </span>
          </div>
          <div>
            <Fingerprint size={25} weight="thin" />
            <span>
              <strong>Check the participation rule.</strong>
              <small>An account and an eligibility claim are different.</small>
            </span>
          </div>
          <div>
            <Check size={25} weight="thin" />
            <span>
              <strong>Vote once. Keep the evidence.</strong>
              <small>Explore the demonstration and receipt recovery.</small>
            </span>
          </div>
        </div>
        <HowItWorks onStart={start} />
        <section className="landing-poll-modes" aria-labelledby="poll-modes-title">
          <p className="landing-poll-kicker">One question. Clear rules.</p>
          <h2 id="poll-modes-title">Know what your answer shares.</h2>
          <p>Organizers choose the rules before a poll opens. You see them before answering.</p>
          <div>
            <article>
              <h3>Public</h3>
              <p>
                After closing, choices are published with the consenting Midnight Passport account.
              </p>
            </article>
            <article>
              <h3>Anonymous</h3>
              <p>After closing, choices are published without public links to accounts.</p>
            </article>
            <article>
              <h3>Private totals</h3>
              <p>Only the aggregate result and verification evidence become public.</p>
            </article>
          </div>
          <p className="landing-poll-status">
            In development: profile connection is real; polls and receipts are simulated. Live
            voting and private tally proofs remain gated.
          </p>
          <nav aria-label="Get involved">
            <a href="#connect">Create or connect Midnight Passport</a>
            <a href="#organizer">Explore organizer tools</a>
            <a href="#verify">Verify a receipt</a>
          </nav>
        </section>
        <LandingFinale onStart={start} />
      </main>
      <LandingFooter />
    </div>
  );
}
