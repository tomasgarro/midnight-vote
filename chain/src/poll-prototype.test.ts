import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBigintToBytes,
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  persistentCommit,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { sampleCoinPublicKey } from '@midnightntwrk/ledger-v9';
import { describe, expect, it } from 'vitest';
import {
  Contract,
  type Ledger,
  ledger,
  type Witnesses,
} from '../managed/poll-v3-prototype/contract/index.js';

// These tests execute the compiler's simulator, not a handwritten model.
// --skip-zk produces no proof keys or cryptographic proofs. The prototype's
// missing account authority and encrypted-opening binding remain release gates.
const OPEN = 1_000_000_000n;
const CLOSE = OPEN + 1_000n;
const POLL = new Uint8Array(32).fill(17);
const bytes32 = new CompactTypeBytes(32);
const vector3 = new CompactTypeVector(3, bytes32);

interface PrivateState {
  secret: Uint8Array;
  choices: bigint[];
  salts: Uint8Array[];
}

function bytes(seed: number, length = 32): Uint8Array {
  return new Uint8Array(length).fill(seed);
}

function pad(value: string): Uint8Array {
  const result = new Uint8Array(32);
  result.set(new TextEncoder().encode(value));
  return result;
}

function ballot(choice: bigint, salt: Uint8Array, poll: Uint8Array = POLL): Uint8Array {
  return persistentCommit(
    vector3,
    [pad('mv:prototype:ballot:'), poll, convertBigintToBytes(32, choice, 'ballot choice')],
    salt,
  );
}

const witnesses: Witnesses<PrivateState> = {
  voterSecret: ({ privateState }: WitnessContext<Ledger, PrivateState>) => [
    privateState,
    privateState.secret,
  ],
  tallyChoices: ({ privateState }: WitnessContext<Ledger, PrivateState>) => [
    privateState,
    privateState.choices,
  ],
  tallySalts: ({ privateState }: WitnessContext<Ledger, PrivateState>) => [
    privateState,
    privateState.salts,
  ],
};

async function setup(options = 3n, opening = OPEN, closing = CLOSE) {
  const privateState: PrivateState = {
    secret: bytes(1),
    choices: Array<bigint>(16).fill(0n),
    salts: Array.from({ length: 16 }, () => bytes(0)),
  };
  const contract = new Contract(witnesses);
  const initial = await contract.initialState(
    createConstructorContext(privateState, sampleCoinPublicKey()),
    POLL,
    opening,
    closing,
    options,
  );
  let state = initial.currentContractState.data;
  let zswap = initial.currentZswapLocalState;

  const context = (circuitId: string, time: bigint) =>
    createCircuitContext({
      circuitId,
      contractAddress: dummyContractAddress(),
      coinPublicKeyOrZswapState: zswap,
      contractState: state,
      privateState,
      time: Number(time),
    });

  return {
    privateState,
    read: () => ledger(state),
    async cast(seed: number, choice: bigint, time = OPEN + 100n, poll: Uint8Array = POLL) {
      privateState.secret = bytes(seed);
      const index = Number(ledger(state).ballotCount);
      const salt = bytes(seed + 50);
      const result = await contract.circuits.castBallot(
        context('castBallot', time),
        ballot(choice, salt, poll),
        bytes(seed, 1024),
      );
      state = result.context.callContext.currentQueryContext.state;
      zswap = result.context.callContext.currentZswapLocalState ?? zswap;
      privateState.choices[index] = choice;
      privateState.salts[index] = salt;
      return result;
    },
    async finalize(time = CLOSE) {
      const result = await contract.circuits.finalize(context('finalize', time));
      state = result.context.callContext.currentQueryContext.state;
      zswap = result.context.callContext.currentZswapLocalState ?? zswap;
      return result;
    },
  };
}

describe('bounded Ledger 9 tally prototype — compiled simulator', () => {
  it('counts the complete accepted set without another voter action', async () => {
    const poll = await setup();
    await poll.cast(1, 0n);
    await poll.cast(2, 2n);
    await poll.cast(3, 0n);
    expect(poll.read().totals).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);
    // A separate tally caller needs the openings, not a participating device.
    poll.privateState.secret = bytes(200);
    await poll.finalize();
    expect(poll.read().ballotCount).toBe(3n);
    expect(poll.read().totals).toEqual([2n, 0n, 1n, 0n, 0n, 0n]);
    expect(poll.read().finalized).toBe(true);
  });

  it('rejects duplicate nullifiers before appending another commitment', async () => {
    const poll = await setup();
    await poll.cast(1, 0n);
    await expect(poll.cast(1, 1n)).rejects.toThrow('Already voted');
    expect(poll.read().ballotCount).toBe(1n);
  });

  it('enforces the before/at opening and before/at/after closing boundaries', async () => {
    const poll = await setup();
    await expect(poll.cast(1, 0n, OPEN - 1n)).rejects.toThrow('Voting is closed');
    await poll.cast(1, 0n, OPEN);
    await poll.cast(2, 1n, CLOSE - 1n);
    await expect(poll.cast(3, 0n, CLOSE)).rejects.toThrow('Voting is closed');
    await expect(poll.cast(3, 0n, CLOSE + 1n)).rejects.toThrow('Voting is closed');
    await expect(poll.finalize(CLOSE - 1n)).rejects.toThrow('Poll has not closed');
    await poll.finalize(CLOSE);
    expect(poll.read().totals).toEqual([1n, 1n, 0n, 0n, 0n, 0n]);
  });

  it('cannot omit an opening from the accepted set', async () => {
    const poll = await setup();
    await poll.cast(1, 0n);
    await poll.cast(2, 1n);
    poll.privateState.salts[1] = bytes(0);
    await expect(poll.finalize()).rejects.toThrow('Missing or mismatched opening');
    expect(poll.read().finalized).toBe(false);
  });

  it('rejects a changed choice or salt', async () => {
    const changedChoice = await setup();
    await changedChoice.cast(1, 0n);
    changedChoice.privateState.choices[0] = 1n;
    await expect(changedChoice.finalize()).rejects.toThrow('Missing or mismatched opening');
    const changedSalt = await setup();
    await changedSalt.cast(1, 0n);
    changedSalt.privateState.salts[0] = bytes(202);
    await expect(changedSalt.finalize()).rejects.toThrow('Missing or mismatched opening');
  });

  it('rejects reordered openings', async () => {
    const poll = await setup();
    await poll.cast(1, 0n);
    await poll.cast(2, 1n);
    [poll.privateState.choices[0], poll.privateState.choices[1]] = [
      poll.privateState.choices[1],
      poll.privateState.choices[0],
    ];
    [poll.privateState.salts[0], poll.privateState.salts[1]] = [
      poll.privateState.salts[1],
      poll.privateState.salts[0],
    ];
    await expect(poll.finalize()).rejects.toThrow('Missing or mismatched opening');
  });

  it('binds openings to this exact poll', async () => {
    const poll = await setup();
    await poll.cast(1, 0n, OPEN, bytes(99));
    await expect(poll.finalize()).rejects.toThrow('Missing or mismatched opening');
  });

  it('refuses an out-of-range ballot while counting', async () => {
    const poll = await setup();
    // Admission validity is deliberately not solved by this prototype.
    await poll.cast(1, 3n);
    await expect(poll.finalize()).rejects.toThrow('Invalid ballot choice');
    expect(poll.read().finalized).toBe(false);
  });

  it('cannot finalize twice or append a ballot after finalization', async () => {
    const poll = await setup();
    await poll.cast(1, 0n);
    await poll.finalize();
    await expect(poll.finalize()).rejects.toThrow('Already finalized');
    await expect(poll.cast(2, 1n, OPEN)).rejects.toThrow('Poll is finalized');
    expect(poll.read().totals).toEqual([1n, 0n, 0n, 0n, 0n, 0n]);
  });

  it('counts all six supported options and enforces its 16-ballot research bound', async () => {
    const poll = await setup(6n);
    for (let i = 0; i < 16; i++) await poll.cast(i + 1, BigInt(i % 6));
    await expect(poll.cast(17, 0n)).rejects.toThrow('Prototype capacity reached');
    await poll.finalize();
    expect(poll.read().totals).toEqual([3n, 3n, 3n, 3n, 2n, 2n]);
  });

  it('finalizes an empty poll as zero counts', async () => {
    const poll = await setup();
    await poll.finalize();
    expect(poll.read().totals).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);
  });

  it('rejects invalid immutable configuration', async () => {
    await expect(setup(1n)).rejects.toThrow('Invalid option count');
    await expect(setup(7n)).rejects.toThrow('Invalid option count');
    await expect(setup(3n, OPEN, OPEN)).rejects.toThrow('Invalid voting window');
    await expect(setup(3n, CLOSE, OPEN)).rejects.toThrow('Invalid voting window');
  });
});
