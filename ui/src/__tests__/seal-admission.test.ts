import { describe, expect, it, vi } from 'vitest';
import { type PassAdmission, sealWhenAdmitted } from '../integration/seal-admission';

/** A clock that only moves when the code under test sleeps. */
function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: vi.fn(async (milliseconds: number) => {
      time += milliseconds;
    }),
  };
}

/** A pass whose standing changes from one question to the next. */
function standings(...values: PassAdmission[]) {
  let asked = 0;
  return vi.fn(async () => values[Math.min(asked++, values.length - 1)] as PassAdmission);
}

describe('sealing an answer with a pass that was just issued', () => {
  it('seals at once when the pass is admitted, and never says it is waiting', async () => {
    const { now, sleep } = clock();
    const onWaiting = vi.fn();
    const seal = vi.fn(async () => 'receipt');

    await expect(
      sealWhenAdmitted({ seal, admission: standings('admitted'), onWaiting, now, sleep }),
    ).resolves.toBe('receipt');
    expect(seal).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('asks by itself until the pass is admitted, and stops waiting before it seals', async () => {
    const { now, sleep } = clock();
    const events: string[] = [];
    const admission = standings('pending', 'pending', 'admitted');
    const seal = vi.fn(async () => {
      events.push('seal');
      return 'receipt';
    });

    await expect(
      sealWhenAdmitted({
        seal,
        admission,
        onWaiting: (waiting) => events.push(waiting ? 'waiting' : 'admitted'),
        now,
        sleep,
        intervalMs: 8_000,
        waitMs: 180_000,
      }),
    ).resolves.toBe('receipt');
    expect(admission).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // The wait is over before the proof starts, so the screen can show the proof.
    expect(events).toEqual(['waiting', 'admitted', 'seal']);
    expect(seal).toHaveBeenCalledTimes(1);
  });

  it('lets the sealing give the refusal once the wait is spent', async () => {
    const { now, sleep } = clock();
    const waiting: boolean[] = [];
    const refusal = Object.assign(new Error('not admitted'), { code: 'CREDENTIAL_NOT_ADMITTED' });
    const admission = standings('pending');
    const seal = vi.fn(async () => {
      throw refusal;
    });

    await expect(
      sealWhenAdmitted({
        seal,
        admission,
        onWaiting: (value) => waiting.push(value),
        now,
        sleep,
        intervalMs: 10_000,
        waitMs: 30_000,
      }),
    ).rejects.toBe(refusal);
    // Asked at 0, 10, 20 and 30 seconds. It starts no pause it cannot finish in time.
    expect(admission).toHaveBeenCalledTimes(4);
    expect(now()).toBe(30_000);
    expect(waiting).toEqual([true, false]);
    expect(seal).toHaveBeenCalledTimes(1);
  });

  it.each(['closed', 'no-pass'] as const)(
    'does not wait on a pass that is %s: the sealing says why',
    async (standing) => {
      const { now, sleep } = clock();
      const onWaiting = vi.fn();
      const refusal = new Error('final');
      const seal = vi.fn(async () => {
        throw refusal;
      });

      await expect(
        sealWhenAdmitted({ seal, admission: standings(standing), onWaiting, now, sleep }),
      ).rejects.toBe(refusal);
      expect(sleep).not.toHaveBeenCalled();
      expect(onWaiting).not.toHaveBeenCalled();
    },
  );

  it('ends the wait when the question itself fails, and seals nothing', async () => {
    const { now, sleep } = clock();
    const waiting: boolean[] = [];
    const indexerDown = new Error('The indexer is unavailable');
    const admission = vi
      .fn<() => Promise<PassAdmission>>()
      .mockResolvedValueOnce('pending')
      .mockRejectedValueOnce(indexerDown);
    const seal = vi.fn(async () => 'receipt');

    await expect(
      sealWhenAdmitted({ seal, admission, onWaiting: (value) => waiting.push(value), now, sleep }),
    ).rejects.toBe(indexerDown);
    expect(waiting).toEqual([true, false]);
    expect(seal).not.toHaveBeenCalled();
  });

  it('seals at once with an adapter that cannot be asked', async () => {
    const seal = vi.fn(async () => 'receipt');
    await expect(sealWhenAdmitted({ seal })).resolves.toBe('receipt');
    expect(seal).toHaveBeenCalledTimes(1);
  });
});
