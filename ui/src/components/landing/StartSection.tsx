import { ArrowUpRight } from '@phosphor-icons/react';
import './start-section.css';

/**
 * Two doors: answer a poll, or run one. Agents get one quieter link, to the city where they may
 * one day take part.
 */
export function StartSection({
  onAnswer,
  onOrganise,
}: {
  onAnswer: () => void;
  onOrganise: () => void;
}) {
  return (
    <section className="start" id="start" aria-labelledby="start-title">
      <h2 id="start-title">Answer a poll, or run your own.</h2>
      <div className="start-doors">
        <article className="start-door start-door--answer">
          <div className="start-door__art" aria-hidden="true">
            <img
              className="start-door__lake"
              src="/art/civic/alpine-lake.webp"
              alt=""
              loading="lazy"
            />
            <img
              className="start-door__bust"
              src="/art/civic/cleisthenes-bust.webp"
              alt=""
              loading="lazy"
            />
          </div>
          <div className="start-door__copy">
            <h3>Answer a poll</h3>
            <p>
              Try a demo poll in a couple of minutes. Cleisthenes explains the question from its
              sources, and never tells you what to answer.
            </p>
            <button type="button" className="midnight-cta" onClick={onAnswer}>
              Try a poll{' '}
              <span>
                <ArrowUpRight className="landing-action-arrow" size={22} />
              </span>
            </button>
          </div>
        </article>
        <article className="start-door start-door--run">
          <div className="start-door__art" aria-hidden="true">
            <div className="start-rules">
              <p>Who can answer</p>
              <strong>Members with Midnight Passport</strong>
              <p>What results show</p>
              <strong>Only the totals</strong>
              <p>Closes</p>
              <strong>Sunday, 18:00</strong>
            </div>
          </div>
          <div className="start-door__copy">
            <h3>Run a poll</h3>
            <p>
              Ask your club, your class or your town. Choose who can answer and what the results
              will show.
            </p>
            <button type="button" className="midnight-cta" onClick={onOrganise}>
              Set up a poll{' '}
              <span>
                <ArrowUpRight className="landing-action-arrow" size={22} />
              </span>
            </button>
          </div>
        </article>
      </div>
      <a
        className="start-agents"
        href="https://www.midnight.city/"
        target="_blank"
        rel="noreferrer"
      >
        <span className="start-agents__hand" aria-hidden="true" />
        <span>
          And agents? <strong>See where they could take part, in Midnight City</strong>
        </span>
        <ArrowUpRight className="landing-action-arrow" size={20} />
      </a>
      <p className="start-note">This is a demo: polls, answers and receipts are simulated.</p>
    </section>
  );
}
