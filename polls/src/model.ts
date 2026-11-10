export type Visibility = 'public' | 'anonymous' | 'private';
export type Eligibility =
  | { kind: 'midnight-passport-account' }
  | {
      kind: 'credential';
      claim: 'nationality' | 'age' | 'membership' | 'residence';
      value: string;
    };

export interface PollDraft {
  id: string;
  question: string;
  description: string;
  options: readonly string[];
  visibility: Visibility;
  eligibility: Eligibility;
  opensAt: number;
  closesAt: number;
}

export interface PublishedPoll extends PollDraft {
  readonly rulesHash: string;
  readonly publishedAt: number;
  readonly environment: 'simulation' | 'preview';
}

export interface ChainConfirmation {
  network: 'preview';
  contractAddress: string;
  transactionId: string;
  blockHash: string;
  blockHeight: number;
}

/** No Midnight Passport account identifier is permitted in anonymous/private records. */
export interface BallotRecord {
  pollId: string;
  rulesHash: string;
  nullifier: string;
  commitment: string;
  encryptedOpening: string;
  account?: { address: string; network: string };
  confirmation: ChainConfirmation;
}

export interface BallotOpening {
  pollId: string;
  rulesHash: string;
  choice: number;
  salt: string;
}

export interface VoteReceipt {
  kind: 'midnight.vote/receipt/v1';
  environment: 'simulation' | 'preview';
  opening: BallotOpening;
  commitment: string;
  confirmation?: ChainConfirmation;
}

export interface TallyEvidence {
  pollId: string;
  rulesHash: string;
  ballotSetHash: string;
  ballotCount: number;
  totals: readonly number[];
  proof: string;
  confirmation: ChainConfirmation;
}

export const VISIBILITY_COPY: Record<Visibility, { label: string; description: string }> = {
  public: {
    label: 'Public',
    description:
      'After closing, choices are published with the consenting Midnight Passport account.',
  },
  anonymous: {
    label: 'Anonymous',
    description:
      'After closing, choices are published without public links to Midnight Passport accounts.',
  },
  private: {
    label: 'Private totals',
    description:
      'Only totals and verification evidence are published. Individual choices are not published.',
  },
};

export const LIVE_CAPABILITIES = Object.freeze({
  accountControl: false,
  previewDeployment: false,
  delayedDisclosure: false,
  privateTally: false,
  regionalCredentials: false,
});

export function releaseBlockers(): string[] {
  return [
    'Midnight Passport account-control proof is not exposed by the current connector.',
    'The Ledger 9 poll contract has no verified deployment in this release.',
    'Automatic delayed disclosure and private aggregate proof verification are not validated.',
  ];
}

export function validateDraft(draft: PollDraft): void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(draft.id)) throw new Error('Invalid poll identifier.');
  if (!draft.question.trim() || draft.question.length > 240)
    throw new Error('Write a question of at most 240 characters.');
  if (draft.description.length > 4000) throw new Error('Description is too long.');
  if (
    draft.options.length < 2 ||
    draft.options.length > 6 ||
    draft.options.some((s) => !s.trim() || s.length > 120)
  ) {
    throw new Error('Use two to six options, each at most 120 characters.');
  }
  if (new Set(draft.options.map((s) => s.trim().toLowerCase())).size !== draft.options.length)
    throw new Error('Options must be different.');
  if (!Object.hasOwn(VISIBILITY_COPY, draft.visibility))
    throw new Error('Choose a supported visibility mode.');
  if (
    !Number.isSafeInteger(draft.opensAt) ||
    !Number.isSafeInteger(draft.closesAt) ||
    draft.opensAt >= draft.closesAt
  )
    throw new Error('Closing must be after opening.');
  if (draft.eligibility.kind !== 'midnight-passport-account') {
    if (
      draft.eligibility.kind !== 'credential' ||
      !['nationality', 'age', 'membership', 'residence'].includes(draft.eligibility.claim) ||
      !draft.eligibility.value.trim()
    )
      throw new Error('Invalid credential rule.');
  }
}

export function pollPhase(poll: PollDraft, now = Date.now()): 'scheduled' | 'open' | 'closed' {
  return now < poll.opensAt ? 'scheduled' : now < poll.closesAt ? 'open' : 'closed';
}
