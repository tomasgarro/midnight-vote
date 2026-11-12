import { ArrowUpRight, Check, LockSimple } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { loadScroll, SCROLL_SCENES, useMediaQuery } from './scroll';
import './start-section.css';

/** Small flags, drawn plainly, for the countries the referendum card proves in turn. */
function Flag({ of }: { of: (typeof COUNTRIES)[number] }) {
  if (of === 'Switzerland')
    return (
      <svg className="vote-flag" viewBox="0 0 20 20" aria-hidden="true">
        <rect width="20" height="20" rx="2" fill="#d52b1e" />
        <path d="M8 4h4v4h4v4h-4v4H8v-4H4V8h4z" fill="#fff" />
      </svg>
    );
  if (of === 'the European Union')
    return (
      <svg className="vote-flag" viewBox="0 0 30 20" aria-hidden="true">
        <rect width="30" height="20" rx="2" fill="#003399" />
        {Array.from({ length: 12 }, (_, at) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: twelve fixed stars
            key={at}
            cx={15 + 6 * Math.sin((at * Math.PI) / 6)}
            cy={10 - 6 * Math.cos((at * Math.PI) / 6)}
            r="0.95"
            fill="#ffcc00"
          />
        ))}
      </svg>
    );
  if (of === 'India')
    return (
      <svg className="vote-flag" viewBox="0 0 30 20" aria-hidden="true">
        <rect width="30" height="20" rx="2" fill="#fff" />
        <path d="M2 0h26a2 2 0 0 1 2 2v4.67H0V2a2 2 0 0 1 2-2z" fill="#ff9933" />
        <path d="M0 13.33h30V18a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z" fill="#138808" />
        <circle cx="15" cy="10" r="2.4" fill="none" stroke="#000080" strokeWidth="0.7" />
      </svg>
    );
  return (
    <svg className="vote-flag" viewBox="0 0 30 20" aria-hidden="true">
      <rect width="30" height="20" rx="2" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((stripe) => (
        <rect key={stripe} y={(stripe * 20) / 13} width="30" height={20 / 13} fill="#b22234" />
      ))}
      <rect width="13" height={(7 * 20) / 13} fill="#3c3b6e" />
    </svg>
  );
}

/** The countries the referendum card proves, in turn. */
const COUNTRIES = ['Switzerland', 'the European Union', 'India', 'the United States'] as const;

/** What midnight.vote does with Midnight Passport: one claim per row. */
export const VOTE_PARTS = [
  {
    title: 'Understand before you answer.',
    body: 'Ask Cleisthenes about any poll. He reads the sources, sets out what each side says and who says it, and never tells you how to vote.',
  },
  {
    title: 'Polls for your own groups.',
    body: 'Ask your club, your class or your building. Choose who can answer and what the results show; the rules lock when the poll opens.',
  },
  {
    title: 'Referendums, country by country.',
    body: 'Prove you are a citizen of the country that is voting, without showing who you are. Every vote is sealed on Midnight and counted in the open.',
    when: 'With Midnight Passport v2 · Q1 2027',
  },
] as const;

function Hidden() {
  return (
    <span className="vote-hidden">
      <span />
      <LockSimple size={14} weight="bold" />
    </span>
  );
}

function Copy({
  index,
  action,
}: {
  index: 0 | 1 | 2;
  action?: { label: string; onClick: () => void };
}) {
  const part = VOTE_PARTS[index];
  return (
    <div className="vote-copy">
      <p className="vote-num">
        <span className="vote-steps" aria-hidden="true">
          {VOTE_PARTS.map((other, at) => (
            <span key={other.title} data-on={at <= index} />
          ))}
        </span>
        {'when' in part && <small className="vote-when">{part.when}</small>}
      </p>
      <h3>{part.title}</h3>
      <p>{part.body}</p>
      {action && (
        <button type="button" className="midnight-cta" onClick={action.onClick}>
          {action.label}{' '}
          <span>
            <ArrowUpRight className="landing-action-arrow" size={20} weight="bold" />
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * After the passport, the paper world again: what midnight.vote does with Midnight Passport.
 * Three rows, each a small picture of the product beside one claim; the first two are the ways in.
 */
export function StartSection({
  onAnswer,
  onOrganise,
}: {
  onAnswer: () => void;
  onOrganise: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const motion = useMediaQuery(SCROLL_SCENES);

  // Each row builds itself as it comes up. Without motion everything simply stands.
  useEffect(() => {
    const section = sectionRef.current;
    if (!motion || !section) return;
    let revert: (() => void) | undefined;
    let cancelled = false;
    loadScroll()
      .then(({ gsap }) => {
        if (cancelled) return;
        const context = gsap.context(() => {
          for (const row of section.querySelectorAll<HTMLElement>('.vote-row')) {
            const build = gsap.timeline({
              defaults: { ease: 'power3.out' },
              scrollTrigger: { trigger: row, start: 'top 78%', once: true },
            });
            build
              .from(row.querySelector('.vote-plate'), { autoAlpha: 0, y: 48, duration: 0.8 })
              .from(
                row.querySelector('.vote-card'),
                { autoAlpha: 0, y: 36, rotation: -2.5, duration: 0.8 },
                0.15,
              )
              .from(
                row.querySelectorAll('.vote-build'),
                { autoAlpha: 0, y: 14, duration: 0.5, stagger: 0.12 },
                0.45,
              )
              .from(
                row.querySelectorAll('.vote-copy > *'),
                { autoAlpha: 0, y: 18, duration: 0.6, stagger: 0.08 },
                0.1,
              );
          }
        }, section);
        revert = () => context.revert();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      revert?.();
    };
  }, [motion]);

  return (
    <section className="start vote" id="start" aria-labelledby="vote-title" ref={sectionRef}>
      <h2 id="vote-title">
        Midnight Passport proves who you are. <em>midnight.vote puts it to a vote.</em>
      </h2>
      <ol className="vote-rows">
        <li className="vote-row vote-row--learn">
          <div className="vote-plate" aria-hidden="true">
            <div className="vote-card vote-brief">
              <p className="vote-card__q">Should the lake path close to cars on Sundays?</p>
              <div className="vote-brief__by vote-build">
                <span className="vote-brief__face">
                  <img src="/art/civic/cleisthenes-bust.webp" alt="" loading="lazy" />
                </span>
                <p>
                  <strong>Cleisthenes</strong>
                  <span>Here is what each side says, and who says it.</span>
                </p>
              </div>
              <div className="vote-brief__sides">
                <div className="vote-side vote-build">
                  <small>For</small>
                  <p>Quieter, safer Sundays for people on foot.</p>
                  <span>City mobility study</span>
                </div>
                <div className="vote-side vote-build">
                  <small>Against</small>
                  <p>Harder for cafés to get their deliveries.</p>
                  <span>Shopkeepers’ letter</span>
                </div>
              </div>
            </div>
          </div>
          <Copy index={0} action={{ label: 'Try a poll', onClick: onAnswer }} />
        </li>
        <li className="vote-row vote-row--groups">
          <div className="vote-plate" aria-hidden="true">
            <div className="vote-card vote-rules">
              <p className="vote-card__q">Should the club meet on Saturdays?</p>
              <ul>
                <li className="vote-build">
                  <Check size={16} weight="bold" /> Members with Midnight Passport
                </li>
                <li className="vote-build">
                  <Check size={16} weight="bold" /> Results: totals only
                </li>
                <li className="vote-build">
                  <Check size={16} weight="bold" /> Closes Sunday, 18:00
                </li>
              </ul>
              <p className="vote-rules__lock vote-build">
                <LockSimple size={15} weight="bold" /> Rules locked when the poll opens
              </p>
            </div>
          </div>
          <Copy index={1} action={{ label: 'Set up a poll', onClick: onOrganise }} />
        </li>
        <li className="vote-row vote-row--nation">
          <div className="vote-plate" aria-hidden="true">
            <div className="vote-card vote-ref">
              <p className="vote-label">National referendum</p>
              <p className="vote-card__q">Lower the voting age to 16?</p>
              <ul>
                <li className="vote-build">
                  <span>Citizen of</span>
                  <strong className="vote-country">
                    <span className="vote-rotor">
                      {COUNTRIES.map((country) => (
                        <em key={country}>
                          <Flag of={country} /> {country}
                        </em>
                      ))}
                    </span>
                    <Check size={15} weight="bold" />
                  </strong>
                </li>
                <li className="vote-build">
                  <span>Name</span>
                  <Hidden />
                </li>
                <li className="vote-build">
                  <span>Your answer</span>
                  <Hidden />
                </li>
                <li className="vote-build">
                  <span>Counted</span>
                  <strong className="vote-ok">
                    <Check size={15} weight="bold" /> Yes
                  </strong>
                </li>
              </ul>
            </div>
          </div>
          <Copy index={2} />
        </li>
      </ol>
    </section>
  );
}
