import { ArrowUpRight } from '@phosphor-icons/react';
import { useEffect } from 'react';
import './docs-page.css';

const repository = 'https://github.com/tomasgarro/midnight-vote';
const chapters = [
  [
    '01',
    'The idea',
    'VISION.md',
    'Privacy on your own terms. Why Passport, verified participation and informed deliberation belong together.',
  ],
  [
    '02',
    'Passport & proofs',
    'PASSPORT-AND-PROOFS.md',
    'Selective disclosure, the NFC journey, Rarimo verification and the future Compact migration.',
  ],
  [
    '03',
    'Understanding together',
    'AI-AND-DELIBERATION.md',
    'The catalogue guide today, source-grounded AI tomorrow, and a separate place for agent experiments.',
  ],
  [
    '04',
    'Inside the system',
    'ARCHITECTURE.md',
    'Contracts, credential issuance, local proving, the relay and confirmed receipts.',
  ],
  [
    '05',
    'Build & explore',
    'QUICKSTART.md',
    'Run the demo locally and follow a short participant walkthrough.',
  ],
  [
    '06',
    'Evidence & limitations',
    'COMPACT-REVIEW-2026-09-16.md',
    'What has been tested, what remains trusted, and what must happen before live use.',
  ],
];

export default function DocsPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Documentation · midnight.vote';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="vote-docs">
      <a className="vote-docs__skip" href="#docs-main">
        Skip to documentation
      </a>
      <header className="vote-docs__header">
        <a className="vote-docs__brand" href="/" aria-label="midnight.vote home">
          <img src="/brand/midnight-vote-d3-black.svg" width="43" height="25" alt="" /> midnight
          <span>.vote</span>
        </a>
        <nav aria-label="Documentation navigation">
          <a href={repository}>
            GitHub <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          <a href="/#app">
            Try the demo <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </nav>
      </header>
      <main id="docs-main">
        <section className="vote-docs__hero" aria-labelledby="docs-title">
          <p className="vote-docs__eyebrow">THE MIDNIGHT.VOTE FIELD GUIDE</p>
          <h1 id="docs-title">
            Understand more.
            <br />
            <em>Disclose less.</em>
          </h1>
          <p className="vote-docs__lead">
            A Passport-first approach to civic participation. Understand the question, prove only
            what is needed, and make your own choice.
          </p>
          <div className="vote-docs__actions">
            <a className="vote-docs__primary" href={`${repository}/blob/main/docs/SUBMISSION.md`}>
              Read the submission <ArrowUpRight size={18} aria-hidden="true" />
            </a>
            <a href="#reading">Explore the documentation ↓</a>
          </div>
          <div className="vote-docs__status">
            <span aria-hidden="true" /> Submission prototype · Passport stagenet beta · Public
            voting demo is simulated
          </div>
        </section>

        <section className="vote-docs__principle" aria-labelledby="principle-title">
          <div>
            <p className="vote-docs__eyebrow">01 / THE STARTING POINT</p>
            <h2 id="principle-title">
              Privacy on
              <br />
              your own terms.
            </h2>
          </div>
          <div>
            <p>
              Midnight Passport is at the core of the vision: choose the facts you disclose, instead
              of handing over your whole identity.
            </p>
            <div className="vote-docs__claims">
              <div>
                <strong>18+</strong>
                <span>
                  An age threshold.
                  <br />
                  No name needed.
                </span>
              </div>
              <div>
                <strong>Country</strong>
                <span>
                  A citizenship claim.
                  <br />
                  No street address needed.
                </span>
              </div>
            </div>
            <p className="vote-docs__caption">
              Intended selective-proof experience. The current Passport bridge supplies session and
              consented profile data; full eligibility integration is still in progress.
            </p>
          </div>
        </section>

        <section className="vote-docs__journey" aria-labelledby="journey-title">
          <p className="vote-docs__eyebrow">02 / THE VERIFICATION PATH</p>
          <h2 id="journey-title">Real documents. Minimal claims.</h2>
          <p>
            The goal is participation by real, eligible citizens with private proof generation.
            Rarimo ZK Passport is the first evidence path; moving passport verification toward
            Compact is future work.
          </p>
          <ol className="vote-docs__flow" aria-label="Intended verification flow">
            <li>
              <span>01</span>
              <strong>Passport + NFC</strong>
              <small>A supported physical document</small>
            </li>
            <li>
              <span>02</span>
              <strong>Verify the proof</strong>
              <small>Request-bound Rarimo evidence</small>
            </li>
            <li>
              <span>03</span>
              <strong>Issue eligibility</strong>
              <small>Minimal committed claims</small>
            </li>
            <li>
              <span>04</span>
              <strong>Participate</strong>
              <small>Compact ballot rules</small>
            </li>
          </ol>
          <p className="vote-docs__caption">
            Target architecture, not a completed live journey. The Compact registry and voting
            contracts already exist. Physical NFC-to-counted-vote acceptance is pending.
          </p>
        </section>

        <section id="reading" className="vote-docs__reading" aria-labelledby="reading-title">
          <p className="vote-docs__eyebrow">03 / GO A LITTLE DEEPER</p>
          <h2 id="reading-title">A clear path through the project.</h2>
          <div className="vote-docs__chapters">
            {chapters.map(([number, title, path, description]) => (
              <a key={number} href={`${repository}/blob/main/docs/${path}`}>
                <span className="vote-docs__chapter-number">{number}</span>
                <h3>
                  {title} <ArrowUpRight size={19} aria-hidden="true" />
                </h3>
                <p>{description}</p>
              </a>
            ))}
          </div>
        </section>

        <section className="vote-docs__reality" aria-labelledby="reality-title">
          <p className="vote-docs__eyebrow">04 / WHERE WE ARE TODAY</p>
          <h2 id="reality-title">Ambition, with the evidence beside it.</h2>
          <dl>
            <div>
              <dt>Working demo</dt>
              <dd>
                Explore proposals, review a response and keep a simulated receipt. No physical
                document or live network vote is required.
              </dd>
            </div>
            <div>
              <dt>Reviewable engineering</dt>
              <dd>
                Compact credential and ballot contracts, provider adapters, issuance and relay
                services. Historical evidence is dated and linked in GitHub.
              </dd>
            </div>
            <div>
              <dt>AI-assisted deliberation</dt>
              <dd>
                In the app, Cleisthenes answers from the authored catalogue. Sourced briefs appear
                on a consultation once its evidence is connected and a person has reviewed it.
              </dd>
            </div>
            <div>
              <dt>Exploratory agents</dt>
              <dd>
                Midnight.city agent participation is research. Agent results must remain separate
                from verified-human totals.
              </dd>
            </div>
          </dl>
          <aside>
            <strong>The privacy boundary matters.</strong> The current contract hides choices during
            commit, then publishes them during reveal. A local proof server sees witnesses. Document
            verification alone does not establish unique personhood.{' '}
            <a href={`${repository}/blob/main/docs/PASSPORT-AND-PROOFS.md`}>
              Read the full explanation →
            </a>
          </aside>
        </section>
      </main>
      <footer className="vote-docs__footer">
        <p>
          An independent project built on Midnight, not an official Midnight product.
          <br />
          Non-binding participation · September 2026
        </p>
        <nav aria-label="Documentation footer">
          <a href="/">Back to midnight.vote</a>
          <a href={`${repository}/blob/main/docs/README.md`}>All documentation ↗</a>
        </nav>
      </footer>
    </div>
  );
}
