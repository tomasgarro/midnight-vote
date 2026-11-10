import { Check } from '@phosphor-icons/react';
import { MidnightMark } from './MidnightMark';

const PHRASE = [
  ['A', 'little', 'less', 'exposure.'],
  ['A', 'lot', 'more', 'possibility.'],
] as const;

/** One claim per part, and one plain line on what works today. */
export const CHAPTER_PARTS = [
  {
    title: 'Prove who you are. Show nothing else.',
    body: 'Midnight Passport lets you prove the one fact a poll asks for, such as your age or your membership, without handing over your name or your document.',
    status: 'Today you sign in with Midnight Passport. Proving facts like your age comes next.',
  },
  {
    title: 'Ask your question. Set the rules.',
    body: 'Choose who can answer and what the results will show: every answer in public, answers without names, or only the totals. The rules are fixed when the poll opens.',
    status: 'The organiser tools are a demo, with simulated polls.',
  },
  {
    title: 'Count it in the open.',
    body: 'Every vote is sealed on Midnight, so no one can quietly change it. Anyone can check the count, and your receipt shows your vote was counted without showing how you voted.',
    status: 'Receipts and checks are simulated in this demo.',
  },
] as const;

/**
 * The passport's black, opened: a phrase, then the three things midnight.vote does. On a large
 * screen one Midnight symbol carries the whole chapter (`.pc-mark`); elsewhere every part draws its
 * own small symbol.
 */
export function PassportChapter({ anchorHere }: { anchorHere: boolean }) {
  return (
    <div className="pc" id={anchorHere ? 'how-it-works' : undefined}>
      <div className="pc-ground" aria-hidden="true" />
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
            <MidnightMark className="pc-part__mark" />
            <div className="pc-card pc-id">
              <p className="pc-card__title">Midnight Passport</p>
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd className="pc-redacted" />
                </div>
                <div>
                  <dt>Document number</dt>
                  <dd className="pc-redacted" />
                </div>
                <div>
                  <dt>Date of birth</dt>
                  <dd className="pc-redacted" />
                </div>
                <div className="pc-id__proof">
                  <dt>Over 18</dt>
                  <dd>
                    <Check size={18} weight="bold" /> proven
                  </dd>
                </div>
              </dl>
            </div>
          </figure>
          <PartText index={0} />
        </li>
        <li className="pc-part pc-part--2">
          <figure className="pc-part__figure" aria-hidden="true">
            <MidnightMark className="pc-part__mark" />
            <div className="pc-card pc-poll">
              <p className="pc-card__title">Should the club meet on Saturdays?</p>
              <ul>
                <li>
                  <span className="pc-poll__bullet" />
                  <span className="pc-poll__rule">
                    <small>Who can answer</small>Members with Midnight Passport
                  </span>
                </li>
                <li>
                  <span className="pc-poll__bullet" />
                  <span className="pc-poll__rule">
                    <small>What results show</small>Only the totals
                  </span>
                </li>
                <li>
                  <span className="pc-poll__bullet" />
                  <span className="pc-poll__rule">
                    <small>Closes</small>Sunday, 18:00
                  </span>
                </li>
              </ul>
            </div>
          </figure>
          <PartText index={1} />
        </li>
        <li className="pc-part pc-part--3">
          <figure className="pc-part__figure" aria-hidden="true">
            <div className="pc-card pc-receipt">
              <p className="pc-card__title">Your receipt</p>
              <dl>
                <div>
                  <dt>Poll</dt>
                  <dd>Club on Saturdays</dd>
                </div>
                <div>
                  <dt>Your vote</dt>
                  <dd>Sealed</dd>
                </div>
                <div className="pc-receipt__counted">
                  <dt>Counted</dt>
                  <dd>
                    <Check size={18} weight="bold" /> yes
                  </dd>
                </div>
              </dl>
              <MidnightMark className="pc-receipt__seal" />
            </div>
          </figure>
          <PartText index={2} />
        </li>
      </ol>
    </div>
  );
}

function PartText({ index }: { index: 0 | 1 | 2 }) {
  const part = CHAPTER_PARTS[index];
  return (
    <div className="pc-part__text">
      <h3>{part.title}</h3>
      <p>{part.body}</p>
      <p className="pc-part__status">{part.status}</p>
    </div>
  );
}
