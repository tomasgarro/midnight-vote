import { describe, expect, it } from 'vitest';
import { AccountAuthorization, UnsupportedAccountControl } from './authority.js';
import {
  ballotCommitment,
  ballotSetHash,
  createOpening,
  exportReceipt,
  importReceipt,
  publishPoll,
} from './crypto.js';
import type { BallotRecord, PollDraft, VoteReceipt } from './model.js';
import { createPrototypeProcessor, encryptOpening, tallyPrototype } from './prototype.js';
import { UnavailableAggregateVerifier, verifyVote } from './verification.js';

const draft = (): PollDraft => ({
  id: 'community-budget',
  question: 'What should we fund next?',
  description: 'A non-binding community consultation.',
  options: ['Library', 'Park'],
  visibility: 'private',
  eligibility: { kind: 'midnight-passport-account' },
  opensAt: 100,
  closesAt: 1000,
});
const confirmation = {
  network: 'preview' as const,
  contractAddress: 'contract',
  transactionId: 'tx',
  blockHash: 'block',
  blockHeight: 1,
};

describe('poll publication and authorization', () => {
  it('freezes rules and rejects attempted live publication', async () => {
    const input = draft();
    const poll = await publishPoll(input, 'simulation', 10);
    input.options = ['Changed', 'Other'];
    expect(poll.options).toEqual(['Library', 'Park']);
    expect(Object.isFrozen(poll.eligibility)).toBe(true);
    expect(() => (poll.options as string[]).push('Attack')).toThrow();
    await expect(publishPoll(draft(), 'preview', 10)).rejects.toThrow(
      'Live publication is blocked',
    );
  });
  it('rejects duplicate options, invalid windows, and self-declared regional rules', async () => {
    await expect(
      publishPoll({ ...draft(), options: ['Same', ' same '] }, 'simulation', 10),
    ).rejects.toThrow();
    await expect(publishPoll({ ...draft(), closesAt: 100 }, 'simulation', 10)).rejects.toThrow();
    await expect(
      publishPoll(
        { ...draft(), eligibility: { kind: 'country-selector' } as never },
        'simulation',
        10,
      ),
    ).rejects.toThrow();
  });
  it('does not accept a reported profile or arbitrary signed callback as account authority', async () => {
    const auth = new AccountAuthorization(
      new UnsupportedAccountControl(),
      'https://midnight.vote',
      () => 100,
    );
    const challenge = auth.challenge({
      account: 'claimed-account',
      network: 'stagenet',
      purpose: 'vote',
      pollId: 'community-budget',
    });
    await expect(
      auth.authorize(challenge.id, {
        profile: { passportContract: 'claimed-account' },
        signature: 'arbitrary',
      }),
    ).rejects.toThrow('could not be verified');
    await expect(auth.authorize(challenge.id, {})).rejects.toThrow('already used');
  });
  it('binds verifier input and consumes challenges before concurrent replay', async () => {
    let calls = 0;
    const auth = new AccountAuthorization(
      {
        async verify(challenge) {
          calls++;
          return (
            challenge.origin === 'https://midnight.vote' && challenge.pollId === 'community-budget'
          );
        },
      },
      'https://midnight.vote',
      () => 100,
    );
    const challenge = auth.challenge({
      account: 'account',
      network: 'preview',
      purpose: 'vote',
      pollId: 'community-budget',
    });
    const results = await Promise.allSettled([
      auth.authorize(challenge.id, {}),
      auth.authorize(challenge.id, {}),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(calls).toBe(1);
  });
});

describe('independent receipt recovery and verification', () => {
  it('restores a choice on a clean client and refuses the wrong password and changed ciphertext', async () => {
    const poll = await publishPoll(draft(), 'simulation', 10);
    const opening = createOpening(poll, 1);
    const receipt: VoteReceipt = {
      kind: 'midnight.vote/receipt/v1',
      environment: 'simulation',
      opening,
      commitment: await ballotCommitment(opening),
    };
    const encrypted = await exportReceipt(receipt, 'a sufficiently long private phrase');
    expect(encrypted).not.toContain(opening.salt);
    expect(await importReceipt(encrypted, 'a sufficiently long private phrase')).toEqual(receipt);
    await expect(importReceipt(encrypted, 'a different private phrase')).rejects.toThrow();
    const tampered = JSON.parse(encrypted);
    tampered.ciphertext = 'AAAA';
    await expect(
      importReceipt(JSON.stringify(tampered), 'a sufficiently long private phrase'),
    ).rejects.toThrow();
  });
  it('never upgrades a demo receipt to blockchain confirmation', async () => {
    const poll = await publishPoll(draft(), 'simulation', 10);
    const opening = createOpening(poll, 0);
    const result = await verifyVote(
      poll,
      {
        kind: 'midnight.vote/receipt/v1',
        environment: 'simulation',
        opening,
        commitment: await ballotCommitment(opening),
      },
      {
        async readBallots() {
          throw new Error('must not query');
        },
      },
      new UnavailableAggregateVerifier(),
    );
    expect(result.chainConfirmed).toBe(false);
    expect(result.tallyVerified).toBe(false);
  });
  it('requires a canonical ballot and a proof over the full set before claiming inclusion in the tally', async () => {
    const simulated = await publishPoll(draft(), 'simulation', 10);
    const poll = { ...simulated, environment: 'preview' as const };
    const opening = createOpening(poll, 0);
    const commitment = await ballotCommitment(opening);
    const record: BallotRecord = {
      pollId: poll.id,
      rulesHash: poll.rulesHash,
      commitment,
      nullifier: 'one',
      encryptedOpening: 'encrypted',
      confirmation,
    };
    const receipt: VoteReceipt = {
      kind: 'midnight.vote/receipt/v1',
      environment: 'preview',
      opening,
      commitment,
      confirmation,
    };
    const evidence = {
      pollId: poll.id,
      rulesHash: poll.rulesHash,
      ballotSetHash: await ballotSetHash(poll, [record]),
      ballotCount: 1,
      totals: [1, 0],
      proof: 'proof',
      confirmation,
    };
    const result = await verifyVote(
      poll,
      receipt,
      {
        async readBallots() {
          return [record];
        },
      },
      new UnavailableAggregateVerifier(),
      evidence,
      1001,
    );
    expect(result.chainConfirmed).toBe(true);
    expect(result.included).toBe(false);
    expect(result.tallyVerified).toBe(false);
  });
});

describe('automatic counting experiment', () => {
  it('counts after closing using encrypted submissions with no voter return', async () => {
    const poll = await publishPoll(draft(), 'simulation', 10);
    const keys = await createPrototypeProcessor();
    const records: BallotRecord[] = [];
    for (const [i, choice] of [0, 1, 0].entries()) {
      const opening = createOpening(poll, choice);
      records.push({
        pollId: poll.id,
        rulesHash: poll.rulesHash,
        nullifier: String(i),
        commitment: await ballotCommitment(opening),
        encryptedOpening: await encryptOpening(opening, keys.publicKey),
        confirmation: { ...confirmation, transactionId: `tx${i}`, blockHeight: i + 1 },
      });
    }
    await expect(tallyPrototype(poll, records, keys.privateKey, 999)).rejects.toThrow('not closed');
    const tally = await tallyPrototype(poll, records, keys.privateKey, 1000);
    expect(tally.totals).toEqual([2, 1]);
    expect(tally.proofVerified).toBe(false);
    expect(await ballotSetHash(poll, records.slice(1))).not.toBe(tally.ballotSetHash);
    expect(await ballotSetHash(poll, [...records].reverse())).not.toBe(tally.ballotSetHash);
    await expect(ballotSetHash(poll, [records[0], records[0]])).rejects.toThrow('Duplicate');
    await expect(
      ballotSetHash(poll, [{ ...records[0], account: { address: 'leak', network: 'preview' } }]),
    ).rejects.toThrow('cannot publish');
    await expect(
      tallyPrototype(poll, [{ ...records[0], commitment: 'wrong' }], keys.privateKey, 1001),
    ).rejects.toThrow('does not match');
  });
});
