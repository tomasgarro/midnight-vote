import type { PollDraft } from 'midnight-vote-polls';

/**
 * The demonstration polls and the briefings Cleisthenes gives on them.
 *
 * The questions echo the landing page, so "Try a poll" opens what the landing showed. The
 * briefings are written for this demonstration: Cleisthenes does not read live sources here, and
 * the sources named are examples. The interface says so beside every briefing.
 */

export interface BriefingSide {
  readonly point: string;
  readonly source: string;
}

export interface Briefing {
  readonly summary: string;
  readonly for: readonly BriefingSide[];
  readonly against: readonly BriefingSide[];
}

const DAY = 86_400_000;

export function examplePolls(start: number): PollDraft[] {
  return [
    {
      id: 'car-free-sundays',
      question: 'Make our street car‑free on Sundays?',
      description:
        'The residents’ association asks whether the street should close to cars every Sunday, from 10:00 to 18:00, for a trial year.',
      options: ['Yes', 'No', 'Abstain'],
      visibility: 'anonymous',
      eligibility: { kind: 'midnight-passport-account' },
      opensAt: start - 1000,
      closesAt: start + 7 * DAY,
    },
    {
      id: 'club-saturdays',
      question: 'Should the club meet on Saturdays?',
      description:
        'The club meets on Wednesday evenings. The committee asks whether to move the weekly meeting to Saturday mornings.',
      options: ['Move to Saturdays', 'Stay on Wednesdays', 'Alternate the two'],
      visibility: 'private',
      eligibility: { kind: 'midnight-passport-account' },
      opensAt: start - 1000,
      closesAt: start + 5 * DAY,
    },
    {
      id: 'hybrid-meeting',
      question: 'Should our next meeting be hybrid?',
      description:
        'In a public poll, everyone who answers agrees to publish their account and choice after closing.',
      options: ['Yes', 'No', 'Abstain'],
      visibility: 'public',
      eligibility: { kind: 'midnight-passport-account' },
      opensAt: start - 1000,
      closesAt: start + 7 * DAY,
    },
  ];
}

export const BRIEFINGS: Readonly<Record<string, Briefing>> = {
  'car-free-sundays': {
    summary: 'A trial year of car‑free Sundays on one residential street.',
    for: [
      { point: 'Quieter, safer Sundays for people on foot.', source: 'City mobility study' },
      { point: 'Room for a market, play and cycling.', source: 'Residents’ survey' },
    ],
    against: [
      { point: 'Harder for cafés to get their deliveries.', source: 'Shopkeepers’ letter' },
      { point: 'Parking moves to the next streets.', source: 'Neighbouring street committee' },
    ],
  },
  'club-saturdays': {
    summary: 'Moving the weekly meeting from Wednesday evening to Saturday morning.',
    for: [
      { point: 'More members are free at the weekend.', source: 'Member survey' },
      { point: 'Families could come together.', source: 'Parents’ group' },
    ],
    against: [
      { point: 'The hall costs more on Saturdays.', source: 'Treasurer’s note' },
      { point: 'Some members work weekend shifts.', source: 'Committee minutes' },
    ],
  },
  'hybrid-meeting': {
    summary: 'Letting members join the next meeting by video as well as in the room.',
    for: [
      { point: 'Members who travel can still take part.', source: 'Secretary’s proposal' },
      { point: 'Easier for people who cannot climb the stairs.', source: 'Access group' },
    ],
    against: [
      { point: 'Hybrid meetings need a camera and a host.', source: 'Board minutes' },
      { point: 'Debate is harder when half the room is on a screen.', source: 'Chair’s note' },
    ],
  },
};
