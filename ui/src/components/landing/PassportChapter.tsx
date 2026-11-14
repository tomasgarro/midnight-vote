import {
  Check,
  Fingerprint,
  IdentificationCard,
  LockSimple,
  Robot,
  Wallet,
} from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { MidnightMark } from './MidnightMark';

const PHRASE = [
  ['Meet', 'Midnight', 'Passport.'],
  ['Your', 'private', 'identity', 'on', 'Midnight.'],
] as const;

/**
 * How Midnight Passport works, in five steps, one claim each, from Midnight's public sources only
 * (Karmel's "Introducing Midnight Passport" and Charles Hoskinson's Midnight City talk at
 * TOKEN2049 add: data encrypted on the phone; passkey, wallet or social sign-up; private sends to
 * an alias; an agent gets an allowance, not the master key; Nightframe, as a concept):
 * - the roadmap (midnight.network/roadmap): "Passport SDK v1", Q4 2026, accounts without a seed
 *   phrase, "own their data, identity and money, then delegate to agents"; "Passport v2", Q1 2027,
 *   decentralised identifiers, verifiable credentials and a choice of which apps see which;
 * - the Passport site (midnightntwrk.github.io/passport/site): "alice.passport.night", a passkey
 *   instead of a seed phrase, any device, recoverable after losing all of them, scoped grants;
 * - the October 2026 State of the Network: permissions delegated to AI agents, custody kept.
 * `when` is the public timing; a step without a public date says so.
 */
export const PASSPORT_STEPS = [
  {
    title: 'One place for your money, your identity and your agents.',
    body: 'Midnight Passport is your private home on Midnight. It holds what you own, proves who you are, and sets what your agents may do.',
    when: 'Q4 2026 · Midnight Passport SDK v1',
    points: [
      'Money: held in your own account, which only your proofs can move.',
      'Identity: facts about you that you can prove, and keep to yourself.',
      'Agents: each gets its own pass, with limits you set.',
      'Your data: encrypted on your phone, and backed up where you choose.',
    ],
  },
  {
    title: 'Show only what is asked.',
    body: 'When an app asks “Over 21?”, Midnight Passport answers with a proof the app can check: yes, and nothing else. Your name and birthday stay with you.',
    when: 'Q1 2027 · Midnight Passport v2, with credentials',
    points: [
      'The app asks one question.',
      'Midnight Passport answers with a proof made from your details.',
      'The app checks the proof. It never sees the details.',
    ],
  },
  {
    title: 'No seed phrase. Just your face or fingerprint.',
    body: 'A passkey replaces the seed phrase: you unlock Midnight Passport as you unlock your phone. Use it on any device, and recover it even if you lose them all.',
    when: 'Q4 2026 · Midnight Passport SDK v1',
    points: [
      'A seed phrase is the 12 or 24 secret words behind a crypto wallet. Lose them, or let anyone see them, and the money is gone.',
      'Midnight Passport uses a passkey instead: the face or fingerprint unlock your phone already has. A wallet or a social login works too.',
      'Set up recovery once, and restore it on a new phone, even after losing every device.',
    ],
  },
  {
    title: 'A name, not a string of code.',
    body: 'Your Midnight Passport has a name people can read, like yourname.passport.night, in place of a long address.',
    when: 'In the Midnight Passport plan · no date yet',
    points: [
      'An address is a long string of code that is easy to mistype.',
      'You pick a name when you sign up, and people can send to it privately.',
    ],
  },
  {
    title: 'Your agents act for you, within your limits.',
    body: 'Give an AI agent a pass, not your Midnight Passport: permissions with limits, like a spending cap. Your money stays yours, and you can take the pass back.',
    when: 'Q4 2026 · Midnight Passport SDK v1',
    points: [
      'A travel agent books trains, up to CHF 80 a month.',
      'A video agent edits your videos with the skills you give it.',
      'A grocery agent does the weekly shop, never above CHF 120.',
      'Each pass is an allowance, never your keys. Take it back, and the agent is refused.',
      'Next: Nightframe, shown at TOKEN2049 as a concept, where agents rent skills and use your Midnight Passport, and what goes in, no one else can see.',
    ],
  },
] as const;

/** The address a name replaces (it decodes into the name in PassportJourney.tsx). */
export const ADDRESS = 'mn_addr1qx7d93l2u5c0v8k2f8w0m3n6fj9w4z0ckq8';

/** The three agents of the last step, each with its own pass: what it may do, and its limit. */
const AGENT_PASSES = [
  { name: 'Travel agent', may: 'Books train tickets', cap: 'CHF 38 of 80 this month', used: 0.475 },
  {
    name: 'Video agent',
    may: 'Edits your videos',
    cap: 'Only the skills you gave it',
    skills: ['Cut', 'Captions'],
  },
  {
    name: 'Grocery agent',
    may: 'Does the weekly shop',
    cap: 'CHF 86 of 120 this week',
    used: 0.72,
  },
] as const;

/** The closed Midnight Passport, drawn flat, for when the 3D one cannot be. */
function Cover() {
  return (
    <span className="pc-cover">
      <MidnightMark className="pc-cover__symbol" />
      <span className="pc-cover__name">Midnight Passport</span>
    </span>
  );
}

/** A value nobody is shown: hatched over, under a lock. */
function Hidden({ as: Tag = 'dd' }: { as?: 'dd' | 'span' }) {
  return (
    <Tag className="pc-hidden">
      <span />
      <LockSimple size={14} weight="bold" />
    </Tag>
  );
}

/** A fingerprint as open arcs, in a 100-unit box. */
const PRINT_ARCS = [
  { r: 6, from: 215, to: 505 },
  { r: 12, from: 200, to: 520 },
  { r: 18, from: 225, to: 500 },
  { r: 24, from: 205, to: 515 },
  { r: 30, from: 230, to: 490 },
  { r: 36, from: 215, to: 455 },
] as const;

function arc(r: number, from: number, to: number) {
  const point = (degrees: number) => {
    const t = (degrees * Math.PI) / 180;
    return `${(50 + 0.84 * r * Math.sin(t)).toFixed(2)} ${(51 - r * Math.cos(t)).toFixed(2)}`;
  };
  return `M${point(from)} A${(0.84 * r).toFixed(2)} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

function Print() {
  return (
    <svg className="pc-print" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {PRINT_ARCS.map(({ r, from, to }) => (
        <path key={r} d={arc(r, from, to)} pathLength={1} />
      ))}
    </svg>
  );
}

/**
 * The night inside the passport. The Midnight symbol appears once, as printed, with the phrase,
 * then leaves the stage to the five steps; a bar over each step's words loads as it passes.
 */
export function PassportChapter({ anchorHere }: { anchorHere: boolean }) {
  return (
    <div className="pc" id={anchorHere ? 'how-it-works' : undefined}>
      <div className="pc-ground" aria-hidden="true">
        <div className="pc-dusk">
          <img src="/art/civic/dusk-alps.webp" alt="" width="1536" height="900" decoding="async" />
        </div>
      </div>
      <canvas className="pc-scene" />
      <div className="pc-mark" aria-hidden="true">
        <MidnightMark />
      </div>
      <div className="pc-phrase">
        <MidnightMark className="pc-phrase__mark" />
        <p>
          {PHRASE.map((line) => (
            <span className="pc-phrase__line" key={line.join(' ')}>
              {line.map((word) => (
                <span className="pc-word" key={word}>
                  {word}{' '}
                </span>
              ))}
            </span>
          ))}
        </p>
      </div>
      <ol className="pc-parts">
        <li className="pc-part pc-part--1">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-fig pc-fig--home">
              <div className="pc-slot pc-slot--cover" data-slot="cover-1">
                <Cover />
              </div>
              <ul className="pc-fig__stack">
                <li className="pc-glass pc-tile">
                  <span className="pc-chip">
                    <Wallet size={20} />
                  </span>
                  <span className="pc-tile__text">
                    <strong>Money</strong>
                    <small>Only your proofs can move it</small>
                  </span>
                  <Hidden as="span" />
                </li>
                <li className="pc-glass pc-tile">
                  <span className="pc-chip">
                    <IdentificationCard size={20} />
                  </span>
                  <span className="pc-tile__text">
                    <strong>Identity</strong>
                    <small>Proven, and kept to yourself</small>
                  </span>
                  <span className="pc-ok">
                    <Check size={15} weight="bold" /> Verified
                  </span>
                </li>
                <li className="pc-glass pc-tile">
                  <span className="pc-chip">
                    <Robot size={20} />
                  </span>
                  <span className="pc-tile__text">
                    <strong>Agents</strong>
                    <small>Each with its own pass</small>
                  </span>
                  <span className="pc-tile__value">2 passes</span>
                </li>
              </ul>
            </div>
          </figure>
          <StepText index={0} />
        </li>
        <li className="pc-part pc-part--2">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-fig pc-fig--ask">
              <div className="pc-slot pc-slot--page" data-slot="page">
                <div className="pc-glass pc-id">
                  <p className="pc-glass__head">
                    <MidnightMark className="pc-glass__symbol" />
                    <span className="pc-label">Midnight Passport</span>
                  </p>
                  <dl>
                    <div>
                      <dt>Name</dt>
                      <Hidden />
                    </div>
                    <div>
                      <dt>Date of birth</dt>
                      <Hidden />
                    </div>
                    <div>
                      <dt>Document</dt>
                      <Hidden />
                    </div>
                    <span className="pc-id__scan" />
                  </dl>
                </div>
              </div>
              <div className="pc-glass pc-ask">
                <span className="pc-label">Car rental asks</span>
                <strong className="pc-ask__question">Over 21?</strong>
                <p className="pc-ask__answer" data-slot="proof">
                  <span className="pc-ask__waiting">Waiting for a proof</span>
                  <span className="pc-ask__proven">
                    <Check size={17} weight="bold" /> Yes, proven
                  </span>
                </p>
                <small className="pc-ask__note">Your name and birthday are not shared.</small>
              </div>
            </div>
          </figure>
          <StepText index={1} />
        </li>
        <li className="pc-part pc-part--3">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-fig pc-fig--unlock">
              <div className="pc-slot pc-slot--sheet" data-slot="sheet">
                <div className="pc-glass pc-unlock">
                  <div className="pc-unlock__sensor">
                    <Print />
                  </div>
                  <ul>
                    <li className="pc-row">
                      <span>Unlock</span>
                      <strong className="pc-lit">
                        <Fingerprint size={15} weight="bold" /> Face or fingerprint
                      </strong>
                    </li>
                    <li className="pc-row">
                      <span>Seed phrase</span>
                      <strong>None to write down</strong>
                    </li>
                    <li className="pc-row">
                      <span>Backup</span>
                      <strong className="pc-ok">
                        <Check size={15} weight="bold" /> Recover anywhere
                      </strong>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="pc-slot pc-slot--phone" data-slot="phone" />
            </div>
          </figure>
          <StepText index={2} />
        </li>
        <li className="pc-part pc-part--4">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-fig pc-fig--name">
              <div className="pc-glass pc-decode">
                <p className="pc-decode__label">
                  <span className="pc-label pc-decode__was">Instead of a long address</span>
                  <span className="pc-label pc-decode__now">You are</span>
                </p>
                <div className="pc-decode__line">
                  <span className="pc-decode__addr">{ADDRESS}</span>
                  <span className="pc-decode__name">
                    yourname<span>.passport.night</span>
                  </span>
                  <span className="pc-decode__edge" />
                </div>
                <p className="pc-decode__send">
                  <span className="pc-chip">
                    <LockSimple size={17} />
                  </span>
                  People can send to it, privately.
                </p>
              </div>
            </div>
          </figure>
          <StepText index={3} />
        </li>
        <li className="pc-part pc-part--5">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-fig pc-fig--agents">
              <div className="pc-slot pc-slot--cover" data-slot="cover-5">
                <Cover />
              </div>
              <ul className="pc-fig__stack">
                {AGENT_PASSES.map((agent, at) => (
                  <li className="pc-glass pc-agent" data-slot={`agent-${at}`} key={agent.name}>
                    <p className="pc-agent__head">
                      <span className="pc-chip">
                        <Robot size={19} />
                      </span>
                      <strong>{agent.name}</strong>
                      <span className="pc-agent__state">Revocable</span>
                    </p>
                    <p className="pc-agent__may">{agent.may}</p>
                    <p className="pc-agent__cap">
                      {'skills' in agent ? (
                        <span className="pc-agent__skills">
                          {agent.skills.map((skill) => (
                            <i key={skill}>{skill}</i>
                          ))}
                        </span>
                      ) : (
                        <span
                          className="pc-meter"
                          style={{ '--used': agent.used } as CSSProperties}
                        >
                          <i />
                        </span>
                      )}
                      <span>{agent.cap}</span>
                    </p>
                    {at === 0 && (
                      <p className="pc-pass__did">
                        <Check size={14} weight="bold" /> Just now: Geneva to Zürich, CHF 38
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </figure>
          <StepText index={4} />
        </li>
      </ol>
    </div>
  );
}

function StepText({ index }: { index: 0 | 1 | 2 | 3 | 4 }) {
  const step = PASSPORT_STEPS[index];
  return (
    <div className="pc-part__text">
      <p className="pc-part__when">
        <span className="pc-steps" aria-hidden="true">
          {PASSPORT_STEPS.map((other, at) => (
            <span
              key={other.title}
              data-state={at < index ? 'done' : at === index ? 'now' : 'next'}
            >
              <i />
            </span>
          ))}
        </span>
        {step.when}
      </p>
      <h3>{step.title}</h3>
      <p>{step.body}</p>
      <ul className="pc-part__points">
        {step.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}
