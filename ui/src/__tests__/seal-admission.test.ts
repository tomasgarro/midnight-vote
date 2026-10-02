import { describe, expect, it, vi } from 'vitest';
import { sealWhenAdmitted } from '../integration/seal-admission';

const notAdmitted = () =>
  Object.assign(new Error('This consultation has not admitted this pass yet.'), {
    code: 'CREDENTIAL_NOT_ADMITTED',
  });

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

describe('sealing an answer with a pass that was just issued', () => {
  it('seals at once when the pass is admitted, and never says it is waiting', async () => {
    const { now, sleep } = clock();
    const onWaiting = vi.fn();
    const seal = vi.fn(async () => 'receipt');

    await expect(sealWhenAdmitted({ seal, onWaiting, now, sleep })).resolves.toBe('receipt');
    expect(seal).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('asks again by itself until the pass is admitted, then seals', async () => {
    const { now, sleep } = clock();
    const waiting: boolean[] = [];
    const seal = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(notAdmitted())
      .mockRejectedValueOnce(notAdmitted())
      .mockResolvedValueOnce('receipt');

    await expect(
      sealWhenAdmitted({
        seal,
        onWaiting: (value) => waiting.push(value),
        now,
        sleep,
        intervalMs: 8_000,
        waitMs: 180_000,
      }),
    ).resolves.toBe('receipt');
    expect(seal).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // Said once when the wait began, and once when it ended.
    expect(waiting).toEqual([true, false]);
  });

  it('gives the refusal back once the wait is spent', async () => {
    const { now, sleep } = clock();
    const waiting: boolean[] = [];
    const seal = vi.fn(async () => {
      throw notAdmitted();
    });

    await expect(
      sealWhenAdmitted({
        seal,
        onWaiting: (value) => waiting.push(value),
        now,
        sleep,
        intervalMs: 10_000,
        waitMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_ADMITTED' });
    // At 0, 10, 20 and 30 seconds. It does not start a pause it cannot finish in time.
    expect(seal).toHaveBeenCalledTimes(4);
    expect(now()).toBe(30_000);
    expect(waiting).toEqual([true, false]);
  });

  it.each([
    ['a pass that came too late', { code: 'CREDENTIAL_ADMISSION_CLOSED' }],
    ['an answer already sealed', { code: 'CONFLICT' }],
    ['a failure without a code', {}],
  ])('does not wait on %s', async (_name, fields) => {
    const { now, sleep } = clock();
    const onWaiting = vi.fn();
    const refusal = Object.assign(new Error('final'), fields);
    const seal = vi.fn(async () => {
      throw refusal;
    });

    await expect(sealWhenAdmitted({ seal, onWaiting, now, sleep })).rejects.toBe(refusal);
    expect(seal).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('stops waiting when a later attempt fails for another reason', async () => {
    const { now, sleep } = clock();
    const waiting: boolean[] = [];
    const relayDown = new Error('The relay is unavailable');
    const seal = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(notAdmitted())
      .mockRejectedValueOnce(relayDown);

    await expect(
      sealWhenAdmitted({ seal, onWaiting: (value) => waiting.push(value), now, sleep }),
    ).rejects.toBe(relayDown);
    expect(waiting).toEqual([true, false]);
  });
});
