import { type BallotOpening, CivicCredentialError } from 'midnight-referendum-api';
import { describe, expect, it, vi } from 'vitest';
import {
  browserAnswerMarkerStore,
  countSealedAnswer,
  listSealedAnswers,
  type MarkerStorage,
} from '../integration/sealed-answers';

const SWISS = 'ch-2026-11-29-ahv';
const FRENCH = 'fr-2026-consultation';
const authorization = { kind: 'civic-credential', handle: 'handle-1' } as const;

function memoryStorage(): MarkerStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function opening(status: BallotOpening['status'], referendumId = SWISS): BallotOpening {
  return {
    referendumId,
    contractAddress: 'contract-a',
    choice: 'NO',
    voteSalt: new Uint8Array(32).fill(1),
    ballotCommitment: new Uint8Array(32).fill(2),
    status,
  };
}

function vaultWith(openings: readonly BallotOpening[]) {
  return {
    list: vi.fn(async (referendumId: string) =>
      openings.filter((item) => item.referendumId === referendumId),
    ),
  };
}

describe('answer markers', () => {
  it('keeps markers per deployment scope', () => {
    const storage = memoryStorage();
    const preview = browserAnswerMarkerStore('preview:issuer:1', storage);
    const other = browserAnswerMarkerStore('preview:issuer:2', storage);

    preview.set(SWISS, { state: 'counted' });
    preview.set(FRENCH, { state: 'missed', reason: 'count-closed' });

    expect(browserAnswerMarkerStore('preview:issuer:1', storage).get(SWISS)).toEqual({
      state: 'counted',
    });
    expect(preview.get(FRENCH)).toEqual({ state: 'missed', reason: 'count-closed' });
    expect(other.get(SWISS)).toBeNull();

    preview.clear();
    expect(preview.get(SWISS)).toBeNull();
  });

  it('stores a state and nothing about the answer itself', () => {
    const storage = memoryStorage();
    browserAnswerMarkerStore('preview:issuer:1', storage).set(SWISS, { state: 'counted' });

    const stored = [...storage.values.values()].join('');
    expect(stored).toBe(JSON.stringify({ [SWISS]: { state: 'counted' } }));
  });

  it('drops entries it does not recognise and survives blocked storage', () => {
    const storage = memoryStorage();
    storage.setItem(
      'midnight-vote:answer-markers:preview:issuer:1',
      JSON.stringify({ [SWISS]: { state: 'revealed', choice: 'YES' }, [FRENCH]: 'counted' }),
    );
    const markers = browserAnswerMarkerStore('preview:issuer:1', storage);
    expect(markers.get(SWISS)).toBeNull();
    expect(markers.get(FRENCH)).toBeNull();

    const blocked = browserAnswerMarkerStore('preview:issuer:1', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    blocked.set(SWISS, { state: 'counted' });
    expect(blocked.get(SWISS)).toEqual({ state: 'counted' });
  });
});

describe('listing sealed answers', () => {
  it('reports a confirmed sealed answer without asking the chain', async () => {
    const resolveOnChain = vi.fn();
    const answers = await listSealedAnswers({
      referendumIds: [SWISS, FRENCH],
      vault: vaultWith([opening('sealed')]),
      markers: browserAnswerMarkerStore('s', memoryStorage()),
      resolveOnChain,
    });

    expect(answers).toEqual([{ referendumId: SWISS, state: 'sealed' }]);
    expect(resolveOnChain).not.toHaveBeenCalled();
  });

  it('lets a marker speak for an answer whose opening was deleted', async () => {
    const markers = browserAnswerMarkerStore('s', memoryStorage());
    markers.set(SWISS, { state: 'counted' });
    markers.set(FRENCH, { state: 'missed', reason: 'opening-lost' });
    const vault = vaultWith([]);

    expect(await listSealedAnswers({ referendumIds: [SWISS, FRENCH], vault, markers })).toEqual([
      { referendumId: SWISS, state: 'counted' },
      { referendumId: FRENCH, state: 'missed', reason: 'opening-lost' },
    ]);
    expect(vault.list).not.toHaveBeenCalled();
  });

  it('asks the chain about an attempt whose outcome was never learned', async () => {
    const markers = browserAnswerMarkerStore('s', memoryStorage());
    const vault = vaultWith([opening('sealing'), opening('sealing', FRENCH)]);

    const answers = await listSealedAnswers({
      referendumIds: [SWISS, FRENCH],
      vault,
      markers,
      resolveOnChain: async (referendumId) => (referendumId === SWISS ? 'sealed' : 'counted'),
    });

    expect(answers).toEqual([
      { referendumId: SWISS, state: 'sealed' },
      { referendumId: FRENCH, state: 'counted' },
    ]);
    expect(markers.get(FRENCH)).toEqual({ state: 'counted' });
  });

  it('never calls an unconfirmed attempt sealed on a guess', async () => {
    const markers = browserAnswerMarkerStore('s', memoryStorage());
    const vault = vaultWith([opening('sealing')]);

    expect(await listSealedAnswers({ referendumIds: [SWISS], vault, markers })).toEqual([]);
    expect(
      await listSealedAnswers({
        referendumIds: [SWISS],
        vault,
        markers,
        resolveOnChain: async () => 'none',
      }),
    ).toEqual([]);
    expect(
      await listSealedAnswers({
        referendumIds: [SWISS],
        vault,
        markers,
        resolveOnChain: async () => {
          throw new Error('indexer unreachable');
        },
      }),
    ).toEqual([]);
  });
});

describe('counting a sealed answer', () => {
  const credential = { getActionAuthorization: vi.fn(async () => authorization) };

  it('sends the referendum and the pass authorization, and nothing about the answer', async () => {
    const markers = browserAnswerMarkerStore('s', memoryStorage());
    const revealVote = vi.fn(async () => ({}) as never);

    const outcome = await countSealedAnswer({
      referendumId: SWISS,
      actions: { revealVote },
      credential,
      markers,
    });

    expect(outcome).toEqual({ state: 'counted' });
    expect(revealVote).toHaveBeenCalledExactlyOnceWith({ referendumId: SWISS, authorization });
    expect(markers.get(SWISS)).toEqual({ state: 'counted' });
  });

  it.each([
    [
      'the chain already counted it',
      new CivicCredentialError('CONFLICT', 'already counted'),
      { state: 'counted' },
      { state: 'counted' },
    ],
    [
      'the count has not opened',
      new CivicCredentialError('REVEAL_NOT_OPEN', 'still open', true),
      { state: 'waiting', reason: 'count-not-open' },
      null,
    ],
    [
      'the count has closed',
      new CivicCredentialError('REVEAL_NOT_OPEN', 'closed'),
      { state: 'missed', reason: 'count-closed' },
      { state: 'missed', reason: 'count-closed' },
    ],
    [
      'the opening is gone',
      new CivicCredentialError('BALLOT_OPENING_NOT_FOUND', 'none held'),
      { state: 'missed', reason: 'opening-lost' },
      { state: 'missed', reason: 'opening-lost' },
    ],
    [
      'the pass authorization is stale',
      new CivicCredentialError('CREDENTIAL_NOT_FOUND', 'stale'),
      { state: 'waiting', reason: 'pass-missing' },
      null,
    ],
    [
      'the relay fails',
      new Error('502 Bad Gateway'),
      { state: 'waiting', reason: 'try-again' },
      null,
    ],
  ])('when %s', async (_label, failure, expected, marker) => {
    const markers = browserAnswerMarkerStore('s', memoryStorage());

    const outcome = await countSealedAnswer({
      referendumId: SWISS,
      actions: {
        revealVote: async () => {
          throw failure;
        },
      },
      credential,
      markers,
    });

    expect(outcome).toEqual(expected);
    expect(markers.get(SWISS)).toEqual(marker);
  });

  it('waits for the pass instead of giving up on the answer', async () => {
    const markers = browserAnswerMarkerStore('s', memoryStorage());
    const revealVote = vi.fn();

    const outcome = await countSealedAnswer({
      referendumId: SWISS,
      actions: { revealVote },
      credential: { getActionAuthorization: async () => null },
      markers,
    });

    expect(outcome).toEqual({ state: 'waiting', reason: 'pass-missing' });
    expect(revealVote).not.toHaveBeenCalled();
    expect(markers.get(SWISS)).toBeNull();
  });
});
