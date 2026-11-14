import { ArrowDown, ArrowUpRight, Check, Fingerprint, LockSimple } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';
import './docs-page.css';

const repository = 'https://github.com/tomasgarro/midnight-vote';
const doc = (path: string) => `${repository}/blob/main/docs/${path}`;
const ROADMAP = 'https://midnight.network/roadmap';

function Arrow({ size = 16 }: { size?: number }) {
  return <ArrowUpRight className="vote-docs__arrow" size={size} weight="bold" aria-hidden="true" />;
}

/** The documents in GitHub: the restart record first, then September's, marked as such. */
const CURRENT = [
  {
    title: 'The restart, 9 November 2026',
    path: 'RESTART-2026-11-09.md',
    body: 'What changed, what was tested, and the gates before a real pilot.',
  },
  {
    title: 'Midnight Passport account verification',
    path: 'MIDNIGHT-PASSPORT-AUTHORITY.md',
    body: 'What the signed sign-in response proves today, and what it does not prove yet.',
  },
] as const;

const SEPTEMBER = [
  {
    title: 'The idea',
    path: 'VISION.md',
    body: 'Why understanding a question and keeping your privacy belong together.',
  },
  {
    title: 'Understanding together',
    path: 'AI-AND-DELIBERATION.md',
    body: 'How Cleisthenes is meant to work: sourced briefings, reviewed by a person.',
  },
  {
    title: 'Midnight Passport and proofs',
    path: 'PASSPORT-AND-PROOFS.md',
    body: 'Selective disclosure as first designed. Some paths in it are now planned for later.',
  },
  {
    title: 'Inside the system',
    path: 'ARCHITECTURE.md',
    body: 'Contracts, services and the boundaries between them, as built in September.',
  },
  {
    title: 'Build and explore',
    path: 'QUICKSTART.md',
    body: 'Run the September demo locally and follow a short walkthrough.',
  },
  {
    title: 'Evidence and limitations',
    path: 'COMPACT-REVIEW-2026-09-16.md',
    body: 'A dated review of the Compact contracts: what was tested and what was not.',
  },
] as const;

/** Where we are today: one row per fact, in the words of the 9 November restart. */
const TODAY: { state: string; tone?: 'works' | 'later'; title: string; body: ReactNode }[] = [
  {
    state: 'Works today',
    tone: 'works',
    title: 'Signing in with Midnight Passport',
    body: 'You sign in through the official Midnight Passport window and choose which profile details midnight.vote may see.',
  },
  {
    state: 'Simulated',
    title: 'Answers and receipts',
    body: 'They stay on this device. Nothing is sent to Midnight, and no answer is counted on a blockchain yet.',
  },
  {
    state: 'Examples',
    title: 'Cleisthenes’ briefings',
    body: 'The briefings in the demo are written for the demo, and the sources they name are examples.',
  },
  {
    state: 'Not yet',
    title: 'Proving a fact about you',
    body: (
      <>
        Country, age or membership needs verifiable credentials. The{' '}
        <a href={ROADMAP}>Midnight roadmap</a> plans them for Midnight Passport v2, in Q1 2027.
        Until then, a poll that asks for one cannot take answers.
      </>
    ),
  },
  {
    state: 'Not yet',
    title: 'Live voting on Midnight',
    body: 'Signing in shows your profile, but does not yet prove that you control the account. Until it does, live voting stays switched off. The voting contracts are research prototypes, tested locally and not deployed.',
  },
  {
    state: 'Later',
    tone: 'later',
    title: 'A physical passport, scanned over NFC',
    body: 'A travel document read by your phone is a later way to prove a fact. It is not Midnight Passport, and it is not part of the app today.',
  },
];

const GATES = [
  'Proof that you control your Midnight Passport account, with one answer per account in each poll.',
  'Contracts deployed on Midnight, with the proofs made in your browser.',
  'Results that stay sealed until the poll closes, in all three result modes.',
  'An organizer service with real accounts, and polls stored for good.',
  'A full poll from opening to the count, checked independently, then an invited pilot with real people.',
] as const;

export default function DocsPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'How it works · midnight.vote';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="vote-docs">
      <a className="vote-docs__skip" href="#docs-main">
        Skip to content
      </a>
      <div className="vote-docs__bar-wrap">
        <header className="vote-docs__bar">
          <a href="/" className="vote-docs__brand" aria-label="midnight.vote home">
            <img src="/brand/midnight-vote-d3-black.svg" width="40" height="23" alt="" />
            <span>
              midnight<span className="vote-docs__brand-suffix">.vote</span>
            </span>
          </a>
          <nav className="vote-docs__nav" aria-label="Main navigation">
            <a href="/#polls">Polls</a>
            <a href="/#organizer">Run a poll</a>
            <a href="/docs" aria-current="page">
              Docs
            </a>
          </nav>
          <a className="vote-docs__start" href="/#polls">
            Try a poll <Arrow />
          </a>
        </header>
      </div>

      <main id="docs-main" className="vote-docs__main" tabIndex={-1}>
        <section className="vote-docs__hero" aria-labelledby="docs-title">
          <p className="vote-docs__label">How midnight.vote works</p>
          <h1 id="docs-title">
            Midnight Passport proves who you are. <em>midnight.vote puts it to a vote.</em>
          </h1>
          <p className="vote-docs__lead">
            Understand the question, answer as yourself, and show no more than the poll needs. Here
            is what the app does, what comes next, and where it stands today.
          </p>
          <div className="vote-docs__actions">
            <a className="vote-docs__pill" href="/#polls">
              Try a poll <Arrow size={18} />
            </a>
            <a className="vote-docs__pill vote-docs__pill--ghost" href="#today">
              Where we are today <ArrowDown size={16} weight="bold" aria-hidden="true" />
            </a>
          </div>
          <p className="vote-docs__demo-note">
            <span className="vote-docs__chip vote-docs__chip--accent">Demo</span>
            Sign-in uses the real Midnight Passport. Answers and receipts are simulated on this
            device; nothing is sent to Midnight.
          </p>
        </section>

        <section className="vote-docs__story" aria-label="What midnight.vote does">
          <article className="vote-docs__card vote-docs__part">
            <div className="vote-docs__part-top">
              <span className="vote-docs__num">01</span>
              <span className="vote-docs__chip vote-docs__chip--accent">Works today</span>
            </div>
            <h2>Midnight Passport proves who you are.</h2>
            <p>
              You sign in with Midnight Passport, in its own official window, and choose which
              profile details midnight.vote may see. There is no midnight.vote account, and no
              password for us to keep.
            </p>
            <div className="vote-docs__picture" aria-hidden="true">
              <span className="vote-docs__signin">
                <Fingerprint size={18} weight="regular" /> Sign in with Midnight Passport
              </span>
              <small>Opens the official Midnight Passport window. You choose what to share.</small>
            </div>
          </article>

          <article className="vote-docs__card vote-docs__part">
            <div className="vote-docs__part-top">
              <span className="vote-docs__num">02</span>
              <span className="vote-docs__chip">In the demo</span>
            </div>
            <h2>Cleisthenes’ briefing before you answer.</h2>
            <p>
              Every poll opens with a briefing from Cleisthenes: what each side says, and who says
              it. He never tells you how to vote. The answer is yours.
            </p>
            <figure className="vote-docs__picture vote-docs__brief">
              <figcaption>
                <span className="vote-docs__face" aria-hidden="true">
                  <img src="/art/civic/cleisthenes-bust.webp" alt="" />
                </span>
                <span>
                  <strong>Cleisthenes</strong>
                  Should the lake path close to cars on Sundays?
                </span>
              </figcaption>
              <div className="vote-docs__sides">
                <p>
                  <small>For</small>
                  Quieter, safer Sundays for people on foot.
                </p>
                <p>
                  <small>Against</small>
                  Harder for cafés to get their deliveries.
                </p>
              </div>
            </figure>
          </article>

          <article className="vote-docs__card vote-docs__part">
            <div className="vote-docs__part-top">
              <span className="vote-docs__num">03</span>
              <span className="vote-docs__chip">In the demo</span>
            </div>
            <h2>Polls for your own groups.</h2>
            <p>
              Ask your club, your class or your building. Choose who can answer, what the results
              show and when the poll closes. The rules lock when the poll opens: nobody changes them
              halfway, the organizer included.
            </p>
            <div className="vote-docs__picture vote-docs__rules">
              <p className="vote-docs__label">The rules</p>
              <ul>
                <li>
                  <Check size={15} weight="bold" aria-hidden="true" /> Anyone with a Midnight
                  Passport account
                </li>
                <li>
                  <Check size={15} weight="bold" aria-hidden="true" /> Results: totals only
                </li>
                <li>
                  <Check size={15} weight="bold" aria-hidden="true" /> Closes Saturday, 18:00
                </li>
              </ul>
              <p className="vote-docs__lock">
                <LockSimple size={15} weight="bold" aria-hidden="true" /> Rules lock when the poll
                opens
              </p>
            </div>
          </article>

          <article className="vote-docs__card vote-docs__part vote-docs__part--later">
            <div className="vote-docs__part-top">
              <span className="vote-docs__num">04</span>
              <span className="vote-docs__chip">Later · Q1 2027</span>
            </div>
            <h2>Referendums, country by country.</h2>
            <p>
              A referendum needs proof that you are a citizen of the country that is voting, without
              showing who you are. That takes verifiable credentials, which the{' '}
              <a href={ROADMAP}>Midnight roadmap</a> plans for Midnight Passport v2 in Q1 2027.
              Until then, midnight.vote runs no referendums.
            </p>
            <div className="vote-docs__picture vote-docs__proof" aria-hidden="true">
              <p>
                <span>Citizen of the country voting</span>
                <strong>Proven</strong>
              </p>
              <p>
                <span>Name, birthday, passport number</span>
                <strong>
                  <LockSimple size={13} weight="bold" /> Not shown
                </strong>
              </p>
            </div>
          </article>
        </section>

        <section id="today" className="vote-docs__section" aria-labelledby="today-title">
          <div className="vote-docs__section-head">
            <p className="vote-docs__label">Where we are today</p>
            <h2 id="today-title">What is real, what is simulated, and what comes later.</h2>
            <p>
              midnight.vote restarted on 9 November 2026 around Midnight Passport. This is the
              honest state of the app, as of November 2026.
            </p>
          </div>
          <div className="vote-docs__today">
            <dl className="vote-docs__card vote-docs__facts">
              {TODAY.map((row) => (
                <div key={row.title}>
                  <dt>
                    <span className="vote-docs__chip" data-tone={row.tone}>
                      {row.state}
                    </span>
                    {row.title}
                  </dt>
                  <dd>{row.body}</dd>
                </div>
              ))}
            </dl>
            <aside className="vote-docs__card vote-docs__gates" aria-labelledby="gates-title">
              <h3 id="gates-title">Before a real pilot</h3>
              <ol>
                {GATES.map((gate) => (
                  <li key={gate}>{gate}</li>
                ))}
              </ol>
              <p className="vote-docs__small">
                None of these counts as done because the demo works.{' '}
                <a href={doc('RESTART-2026-11-09.md')}>Read the restart record</a>
              </p>
            </aside>
          </div>
        </section>

        <section id="reading" className="vote-docs__section" aria-labelledby="reading-title">
          <div className="vote-docs__section-head">
            <p className="vote-docs__label">Read further on GitHub</p>
            <h2 id="reading-title">The full record, dated.</h2>
          </div>
          <h3 className="vote-docs__group">Since the restart</h3>
          <div className="vote-docs__links vote-docs__links--current">
            {CURRENT.map((item) => (
              <a key={item.path} className="vote-docs__card vote-docs__link" href={doc(item.path)}>
                <h4>
                  {item.title} <Arrow />
                </h4>
                <p>{item.body}</p>
              </a>
            ))}
          </div>
          <h3 className="vote-docs__group">
            From the September submission <small>Written before the restart</small>
          </h3>
          <div className="vote-docs__links">
            {SEPTEMBER.map((item) => (
              <a key={item.path} className="vote-docs__card vote-docs__link" href={doc(item.path)}>
                <h4>
                  {item.title} <Arrow />
                </h4>
                <p>{item.body}</p>
              </a>
            ))}
          </div>
          <p className="vote-docs__all">
            <a href={doc('README.md')}>
              All documentation <Arrow size={14} />
            </a>
          </p>
        </section>
      </main>

      <footer className="vote-docs__footer">
        <div className="vote-docs__footer-brand">
          <a href="/" className="vote-docs__brand">
            <img src="/brand/midnight-vote-d3-black.svg" width="34" height="20" alt="" />
            <span>
              midnight<span className="vote-docs__brand-suffix">.vote</span>
            </span>
          </a>
          <p>An independent project built on Midnight, not an official Midnight product.</p>
        </div>
        <nav aria-label="Footer">
          <a href="/#polls">Polls</a>
          <a href="/#organizer">Run a poll</a>
          <a href="/#verify">Verify</a>
          <a href="/feedback">Feedback</a>
          <a href={repository}>
            Source code <Arrow size={13} />
          </a>
          <a href="https://midnight.network">
            Midnight <Arrow size={13} />
          </a>
        </nav>
      </footer>
    </div>
  );
}
