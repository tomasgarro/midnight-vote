import {
  Check,
  Fingerprint,
  IdentificationCard,
  LockSimple,
  Robot,
  Wallet,
} from '@phosphor-icons/react';
import { MidnightMark } from './MidnightMark';

const PHRASE = [
  ['Meet', 'Midnight', 'Passport.'],
  ['Your', 'private', 'identity', 'on', 'Midnight.'],
] as const;

/**
 * How Midnight Passport works, in five steps, one claim each, from Midnight's public sources only:
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
  },
  {
    title: 'Show only what is asked.',
    body: 'When an app asks “Over 21?”, Midnight Passport answers with a proof the app can check: yes, and nothing else. Your name and birthday stay with you.',
    when: 'Q1 2027 · Midnight Passport v2, with credentials',
  },
  {
    title: 'No seed phrase. Just your face or fingerprint.',
    body: 'A passkey replaces the seed phrase: you unlock Midnight Passport as you unlock your phone. Use it on any device, and recover it even if you lose them all.',
    when: 'Q4 2026 · Midnight Passport SDK v1',
  },
  {
    title: 'A name, not a string of code.',
    body: 'Your Midnight Passport has a name people can read, like yourname.passport.night, in place of a long address.',
    when: 'In the Midnight Passport plan · no date yet',
  },
  {
    title: 'Your agents act for you, within your limits.',
    body: 'Give an AI agent a pass, not your Midnight Passport: permissions with limits, like a spending cap. Your money stays yours, and you can take the pass back.',
    when: 'Q4 2026 · Midnight Passport SDK v1',
  },
] as const;

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
            <div className="pc-card pc-home">
              <p className="pc-card__head">
                <MidnightMark className="pc-card__symbol" />
                <span className="pc-label">Midnight Passport</span>
              </p>
              <ul>
                <li className="pc-row">
                  <span>
                    <Wallet size={18} /> Money
                  </span>
                  <Hidden as="span" />
                </li>
                <li className="pc-row">
                  <span>
                    <IdentificationCard size={18} /> Identity
                  </span>
                  <strong className="pc-ok">
                    <Check size={15} weight="bold" /> Verified
                  </strong>
                </li>
                <li className="pc-row">
                  <span>
                    <Robot size={18} /> Agents
                  </span>
                  <strong>2 with a pass</strong>
                </li>
              </ul>
            </div>
          </figure>
          <StepText index={0} />
        </li>
        <li className="pc-part pc-part--2">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-stack">
              <p className="pc-ask">
                <span className="pc-label">Car rental asks</span>
                <strong>Over 21?</strong>
              </p>
              <div className="pc-card pc-id">
                <p className="pc-card__head">
                  <MidnightMark className="pc-card__symbol" />
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
                <p className="pc-id__proof">
                  <span>Over 21?</span>
                  <strong>
                    <Check size={16} weight="bold" /> Yes, proven
                  </strong>
                </p>
              </div>
            </div>
          </figure>
          <StepText index={1} />
        </li>
        <li className="pc-part pc-part--3">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-card pc-unlock">
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
                  <span className="pc-seed">
                    <span className="pc-seed__words">
                      {['a', 'b', 'c', 'd', 'e', 'f'].map((slot) => (
                        <i key={slot} />
                      ))}
                    </span>
                    <strong>None to write down</strong>
                  </span>
                </li>
                <li className="pc-row">
                  <span>Backup</span>
                  <strong className="pc-ok">
                    <Check size={15} weight="bold" /> On, recover anywhere
                  </strong>
                </li>
              </ul>
            </div>
          </figure>
          <StepText index={2} />
        </li>
        <li className="pc-part pc-part--4">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-card pc-name">
              <p className="pc-label">Instead of</p>
              <p className="pc-name__addr">
                mn_addr1qx7d93l2u5c0v8k2f8w0m3n6
                <i className="pc-name__strike" />
              </p>
              <p className="pc-label">You are</p>
              <p className="pc-name__handle">
                {[...'yourname'].map((letter, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed word, spelt out letter by letter
                  <span className="pc-name__letter" key={at}>
                    {letter}
                  </span>
                ))}
                <span className="pc-name__letter pc-name__tld">.passport.night</span>
              </p>
            </div>
          </figure>
          <StepText index={3} />
        </li>
        <li className="pc-part pc-part--5">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-card pc-pass">
              <p className="pc-card__head">
                <Robot size={22} weight="regular" />
                <span>Travel agent</span>
                <span className="pc-pass__state">Revocable</span>
              </p>
              <ul>
                <li className="pc-row">
                  <span>May</span>
                  <strong>Book train tickets</strong>
                </li>
                <li className="pc-row">
                  <span>Spending cap</span>
                  <strong>CHF 80 a month</strong>
                </li>
                <li className="pc-row">
                  <span>Proves</span>
                  <strong className="pc-lit">
                    <Check size={14} weight="bold" /> Acts for you
                  </strong>
                </li>
                <li className="pc-row pc-pass__did">
                  <span>Just now</span>
                  <strong className="pc-ok">
                    Geneva → Zürich, CHF 38 <Check size={15} weight="bold" />
                  </strong>
                </li>
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
    </div>
  );
}
