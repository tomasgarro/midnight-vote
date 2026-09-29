import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { BallotOpening } from './passport-v2/ports.js';
import {
  type BallotOpeningRecordStore,
  browserBallotOpeningVault,
  createBallotOpeningVault,
  deserializePrivateStateFromStorage,
  inMemoryPrivateStateProvider,
  serializePrivateStateForStorage,
} from './private-state.js';

describe('browser private-state serialization', () => {
  it('round-trips byte arrays and Merkle path bigint values', () => {
    const original = {
      voterSecret: new Uint8Array([1, 2, 255]),
      voterPath: {
        leaf: new Uint8Array([9, 8]),
        path: [{ sibling: { field: 42n }, goes_left: true }],
      },
    };

    const restored = deserializePrivateStateFromStorage<typeof original>(
      serializePrivateStateForStorage(original),
    );

    expect(restored.voterSecret).toEqual(original.voterSecret);
    expect(restored.voterPath.leaf).toEqual(original.voterPath.leaf);
    expect(restored.voterPath.path[0]?.sibling.field).toBe(42n);
    expect(restored.voterPath.path[0]?.goes_left).toBe(true);
  });

  it('isolates the same private-state ID by contract address', async () => {
    const provider = inMemoryPrivateStateProvider<'voter', { secret: Uint8Array }>();
    const firstAddress = 'contract-a' as ContractAddress;
    const secondAddress = 'contract-b' as ContractAddress;

    provider.setContractAddress(firstAddress);
    await provider.set('voter', { secret: new Uint8Array([1]) });
    provider.setContractAddress(secondAddress);
    await provider.set('voter', { secret: new Uint8Array([2]) });

    expect(await provider.get('voter')).toEqual({ secret: new Uint8Array([2]) });
    provider.setContractAddress(firstAddress);
    expect(await provider.get('voter')).toEqual({ secret: new Uint8Array([1]) });
  });
});

function opening(
  saltByte: number,
  status: BallotOpening['status'] = 'sealing',
  referendumId = 'ch-2026-11-29-ahv',
): BallotOpening {
  return {
    referendumId,
    contractAddress: 'contract-a',
    choice: 'YES',
    voteSalt: new Uint8Array(32).fill(saltByte),
    ballotCommitment: new Uint8Array(32).fill(saltByte + 100),
    status,
  };
}

/** A store that yields between read and write, as IndexedDB does. */
function slowStore(): BallotOpeningRecordStore & { readonly records: Map<string, unknown> } {
  const records = new Map<string, unknown>();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 1));
  return {
    records,
    get: async (id) => {
      await pause();
      return records.get(id);
    },
    set: async (id, openings) => {
      await pause();
      // Round-trip through the storage format, as the encrypted store does.
      records.set(
        id,
        deserializePrivateStateFromStorage(serializePrivateStateForStorage(openings)),
      );
    },
    remove: async (id) => {
      await pause();
      records.delete(id);
    },
  };
}

describe('ballot opening vault', () => {
  it('keeps every attempt when writes arrive together', async () => {
    const store = slowStore();
    // Two instances, as when the interface rebuilds its ports mid-action.
    const first = createBallotOpeningVault(store, 'preview:issuer:1');
    const second = createBallotOpeningVault(store, 'preview:issuer:1');

    await Promise.all([first.save(opening(1)), second.save(opening(2)), first.save(opening(3))]);

    const held = await second.list('ch-2026-11-29-ahv');
    expect(held.map((item) => item.voteSalt[0])).toEqual([1, 2, 3]);
  });

  it('replaces the stored opening that has the same commitment', async () => {
    const vault = createBallotOpeningVault(slowStore(), 'preview:issuer:1');
    await vault.save(opening(1));
    await vault.save(opening(2));
    await vault.save({ ...opening(1, 'sealed'), sealedAt: '2026-10-05T10:00:00.000Z' });

    const held = await vault.list('ch-2026-11-29-ahv');
    expect(held).toHaveLength(2);
    expect(held.find((item) => item.voteSalt[0] === 1)).toMatchObject({
      status: 'sealed',
      sealedAt: '2026-10-05T10:00:00.000Z',
    });
    expect(held.find((item) => item.voteSalt[0] === 2)?.status).toBe('sealing');
  });

  it('restores salts and commitments as bytes after storage', async () => {
    const vault = createBallotOpeningVault(slowStore(), 'preview:issuer:1');
    await vault.save(opening(7));

    const [held] = await vault.list('ch-2026-11-29-ahv');
    expect(held?.voteSalt).toBeInstanceOf(Uint8Array);
    expect(held?.voteSalt).toEqual(new Uint8Array(32).fill(7));
    expect(held?.ballotCommitment).toEqual(new Uint8Array(32).fill(107));
  });

  it('clears one referendum and leaves the others', async () => {
    const vault = createBallotOpeningVault(slowStore(), 'preview:issuer:1');
    await vault.save(opening(1));
    await vault.save(opening(2, 'sealed', 'fr-2026-consultation'));

    await vault.clear('ch-2026-11-29-ahv');

    expect(await vault.list('ch-2026-11-29-ahv')).toEqual([]);
    expect(await vault.list('fr-2026-consultation')).toHaveLength(1);
  });

  it('rejects the save when storage fails, so no answer is sealed without its opening', async () => {
    const store = slowStore();
    const failing: BallotOpeningRecordStore = {
      ...store,
      set: async () => {
        throw new Error('QuotaExceededError');
      },
    };
    const vault = createBallotOpeningVault(failing, 'preview:issuer:1');

    await expect(vault.save(opening(1))).rejects.toThrow('QuotaExceededError');
    // A failed write does not block the next one.
    await expect(vault.list('ch-2026-11-29-ahv')).resolves.toEqual([]);
  });

  it('refuses an opening it could not use later', async () => {
    const vault = createBallotOpeningVault(slowStore(), 'preview:issuer:1');

    expect(() => vault.save({ ...opening(1), voteSalt: new Uint8Array(31) })).toThrow(
      /incomplete/u,
    );
    expect(() => vault.save({ ...opening(1), choice: 'MAYBE' as never })).toThrow(/incomplete/u);
    expect(() => vault.save({ ...opening(1), referendumId: ' ' })).toThrow(/referendum id/u);
    expect(() => createBallotOpeningVault(slowStore(), '  ')).toThrow(/scope/u);
  });

  it('ignores stored entries that are damaged or belong to another referendum', async () => {
    const store = slowStore();
    const vault = createBallotOpeningVault(store, 'preview:issuer:1');
    await vault.save(opening(1));
    const [recordId] = [...store.records.keys()];
    const stored = store.records.get(recordId as string) as unknown[];
    store.records.set(recordId as string, [
      ...stored,
      { ...opening(2), voteSalt: 'not-bytes' },
      opening(3, 'sealed', 'another-referendum'),
      null,
    ]);

    const held = await vault.list('ch-2026-11-29-ahv');
    expect(held.map((item) => item.voteSalt[0])).toEqual([1]);
  });

  it('hands out copies, so a caller cannot change what is stored', async () => {
    const vault = createBallotOpeningVault(slowStore(), 'preview:issuer:1');
    const original = opening(1);
    await vault.save(original);
    original.voteSalt.fill(9);

    const [held] = await vault.list('ch-2026-11-29-ahv');
    expect(held?.voteSalt[0]).toBe(1);
    held?.voteSalt.fill(8);
    expect((await vault.list('ch-2026-11-29-ahv'))[0]?.voteSalt[0]).toBe(1);
  });

  it('reports memory-only storage and separates scopes without IndexedDB', async () => {
    const preview = browserBallotOpeningVault('preview:issuer:1');
    const again = browserBallotOpeningVault('preview:issuer:1');
    const other = browserBallotOpeningVault('preview:issuer:2');

    expect(await preview.durability()).toBe('memory');
    expect(await preview.requestPersistence()).toBe(false);

    await preview.save(opening(1));
    expect(await again.list('ch-2026-11-29-ahv')).toHaveLength(1);
    expect(await other.list('ch-2026-11-29-ahv')).toEqual([]);

    await again.clear('ch-2026-11-29-ahv');
    expect(await preview.list('ch-2026-11-29-ahv')).toEqual([]);
  });
});
