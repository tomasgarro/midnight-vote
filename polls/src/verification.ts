import { ballotSetHash, verifyReceiptOpening } from './crypto.js';
import type { BallotRecord, PublishedPoll, TallyEvidence, VoteReceipt } from './model.js';

export interface CanonicalBallotReader {
  /** Must read finalized chain data, not relay acknowledgement or an untrusted uploaded JSON record. */
  readBallots(poll: PublishedPoll): Promise<readonly BallotRecord[]>;
}
export interface AggregateProofVerifier {
  verify(
    poll: PublishedPoll,
    records: readonly BallotRecord[],
    evidence: TallyEvidence,
  ): Promise<boolean>;
}
export interface VerificationResult {
  openingMatches: boolean;
  chainConfirmed: boolean;
  included: boolean;
  tallyVerified: boolean;
  message: string;
}

export async function verifyVote(
  poll: PublishedPoll,
  receipt: VoteReceipt,
  reader: CanonicalBallotReader,
  verifier: AggregateProofVerifier,
  evidence?: TallyEvidence,
  now = Date.now(),
): Promise<VerificationResult> {
  const openingMatches =
    receipt.opening.pollId === poll.id &&
    receipt.opening.rulesHash === poll.rulesHash &&
    receipt.opening.choice < poll.options.length &&
    (await verifyReceiptOpening(receipt));
  const empty = { openingMatches, chainConfirmed: false, included: false, tallyVerified: false };
  if (!openingMatches)
    return { ...empty, message: 'This receipt does not match the poll and ballot commitment.' };
  if (receipt.environment !== 'preview' || poll.environment !== 'preview')
    return {
      ...empty,
      message: 'This is a simulation receipt. It confirms no blockchain transaction.',
    };
  const records = await reader.readBallots(poll);
  const accepted = records.find((b) => b.commitment === receipt.commitment);
  const chainConfirmed = Boolean(
    accepted &&
      receipt.confirmation &&
      JSON.stringify(accepted.confirmation) === JSON.stringify(receipt.confirmation),
  );
  const base = { openingMatches, chainConfirmed, included: false, tallyVerified: false };
  if (!chainConfirmed)
    return { ...base, message: 'No matching finalized on-chain ballot was observed.' };
  if (!evidence || now < poll.closesAt)
    return {
      ...base,
      message: 'Your ballot is confirmed. A verified final tally is not available yet.',
    };
  const matchesSet =
    evidence.pollId === poll.id &&
    evidence.rulesHash === poll.rulesHash &&
    evidence.ballotCount === records.length &&
    evidence.ballotSetHash === (await ballotSetHash(poll, records)) &&
    evidence.totals.length === poll.options.length &&
    evidence.totals.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    evidence.totals.reduce((a, b) => a + b, 0) === records.length;
  const tallyVerified = matchesSet && (await verifier.verify(poll, records, evidence));
  return {
    ...base,
    included: tallyVerified,
    tallyVerified,
    message: tallyVerified
      ? 'The chain confirms your ballot and the verified tally includes the complete accepted ballot set.'
      : 'The aggregate proof or accepted ballot set could not be verified.',
  };
}

export class UnavailableAggregateVerifier implements AggregateProofVerifier {
  async verify(): Promise<boolean> {
    return false;
  }
}
