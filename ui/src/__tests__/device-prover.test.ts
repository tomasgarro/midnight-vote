import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkerProvingProvider,
  type DeviceProverReply,
  type DeviceProverRequest,
  type DeviceProverSupply,
  deviceProvingSupported,
  keepScreenAwake,
  type ProverWorker,
} from '../integration/device-prover';

type Sent = DeviceProverRequest | DeviceProverSupply;

/** A worker that records what the page sends and lets the test answer. */
class FakeWorker implements ProverWorker {
  readonly sent: Sent[] = [];
  terminated = false;
  private onMessage: ((event: { data: DeviceProverReply }) => void) | null = null;
  private onError: ((event: { message?: string }) => void) | null = null;

  postMessage(message: Sent): void {
    this.sent.push(message);
  }
  addEventListener(type: 'message' | 'error', listener: never): void {
    if (type === 'message') this.onMessage = listener;
    else this.onError = listener;
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: DeviceProverReply): void {
    this.onMessage?.({ data });
  }
  crash(message?: string): void {
    this.onError?.({ ...(message === undefined ? {} : { message }) });
  }
}

const keys = {
  proverKey: new Uint8Array([1]),
  verifierKey: new Uint8Array([2]),
  ir: new Uint8Array([3]),
};

function setup(overrides: { timeoutMs?: number } = {}) {
  const workers: FakeWorker[] = [];
  const keyMaterial = {
    lookupKey: vi.fn(async (keyLocation: string) =>
      keyLocation === 'castVote' ? keys : undefined,
    ),
    getParams: vi.fn(async (_k: number) => new Uint8Array([9])),
  };
  const provider = createWorkerProvingProvider({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    keyMaterial,
    ...overrides,
  });
  return { provider, workers, keyMaterial };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('proving in a worker', () => {
  it('builds a proof, supplies what the prover asks for, and ends the worker', async () => {
    const { provider, workers, keyMaterial } = setup();
    const preimage = new Uint8Array([5, 6, 7]);

    const proving = provider.prove(preimage, 'castVote', 11n);
    const worker = workers[0] as FakeWorker;
    expect(worker.sent[0]).toEqual({
      kind: 'run',
      op: 'prove',
      preimage: new Uint8Array([5, 6, 7]),
      bindingInput: 11n,
    });

    worker.reply({ kind: 'need-key', keyLocation: 'castVote' });
    worker.reply({ kind: 'need-params', k: 15 });
    await settle();
    expect(keyMaterial.lookupKey).toHaveBeenCalledExactlyOnceWith('castVote');
    expect(keyMaterial.getParams).toHaveBeenCalledExactlyOnceWith(15);
    expect(worker.sent.slice(1)).toEqual([
      { kind: 'key', keyLocation: 'castVote', material: keys },
      { kind: 'params', k: 15, params: new Uint8Array([9]) },
    ]);

    worker.reply({ kind: 'proved', proof: new Uint8Array([4, 2]) });
    expect(await proving).toEqual(new Uint8Array([4, 2]));
    expect(worker.terminated).toBe(true);
  });

  it('sends the worker a copy, so the caller keeps its own bytes', async () => {
    const { provider, workers } = setup();
    const preimage = new Uint8Array([5, 6, 7]);

    const proving = provider.prove(preimage, 'castVote');
    const sent = (workers[0] as FakeWorker).sent[0] as DeviceProverRequest;
    expect(sent.preimage).not.toBe(preimage);
    expect(sent).not.toHaveProperty('bindingInput');
    sent.preimage.fill(0);
    expect(preimage).toEqual(new Uint8Array([5, 6, 7]));

    (workers[0] as FakeWorker).reply({ kind: 'proved', proof: new Uint8Array([1]) });
    await proving;
  });

  it('uses a fresh worker for every proof', async () => {
    const { provider, workers } = setup();

    const first = provider.check(new Uint8Array([1]), 'castVote');
    (workers[0] as FakeWorker).reply({ kind: 'checked', value: [1n, undefined] });
    expect(await first).toEqual([1n, undefined]);

    const second = provider.prove(new Uint8Array([1]), 'castVote');
    (workers[1] as FakeWorker).reply({ kind: 'proved', proof: new Uint8Array([8]) });
    await second;

    expect(workers).toHaveLength(2);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('tells the prover when a circuit is not one the device may prove', async () => {
    const { provider, workers } = setup();

    const proving = provider.prove(new Uint8Array([1]), 'finalizeVote');
    const worker = workers[0] as FakeWorker;
    worker.reply({ kind: 'need-key', keyLocation: 'finalizeVote' });
    await settle();
    expect(worker.sent[1]).toEqual({ kind: 'key', keyLocation: 'finalizeVote', material: null });

    worker.reply({ kind: 'failed', message: 'no key material for finalizeVote' });
    await expect(proving).rejects.toThrow('no key material for finalizeVote');
    expect(worker.terminated).toBe(true);
  });

  it('passes on a parameter file that failed its integrity check', async () => {
    const { provider, workers, keyMaterial } = setup();
    keyMaterial.getParams.mockRejectedValueOnce(
      new Error('Public parameters for size 15 failed their integrity check'),
    );

    const proving = provider.prove(new Uint8Array([1]), 'castVote');
    const worker = workers[0] as FakeWorker;
    worker.reply({ kind: 'need-params', k: 15 });
    await settle();
    expect(worker.sent[1]).toEqual({
      kind: 'params',
      k: 15,
      error: 'Public parameters for size 15 failed their integrity check',
    });

    worker.reply({ kind: 'failed', message: 'params unavailable' });
    await expect(proving).rejects.toThrow('params unavailable');
  });

  it('reports a prover that crashed', async () => {
    const { provider, workers } = setup();

    const proving = provider.prove(new Uint8Array([1]), 'castVote');
    (workers[0] as FakeWorker).crash('out of memory');
    await expect(proving).rejects.toThrow('out of memory');

    const silent = provider.prove(new Uint8Array([1]), 'castVote');
    (workers[1] as FakeWorker).crash();
    await expect(silent).rejects.toThrow('The prover stopped unexpectedly');
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('gives up on a proof that takes too long, and ignores a late answer', async () => {
    vi.useFakeTimers();
    const { provider, workers } = setup({ timeoutMs: 60_000 });

    const proving = provider.prove(new Uint8Array([1]), 'castVote');
    const outcome = expect(proving).rejects.toThrow('This device took too long to build the proof');
    await vi.advanceTimersByTimeAsync(60_000);
    await outcome;

    const worker = workers[0] as FakeWorker;
    expect(worker.terminated).toBe(true);
    const sentBefore = worker.sent.length;
    worker.reply({ kind: 'need-params', k: 15 });
    worker.reply({ kind: 'proved', proof: new Uint8Array([1]) });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.sent).toHaveLength(sentBefore);
  });
});

describe('device support', () => {
  it('needs workers, WebAssembly and WebCrypto', () => {
    const full = { Worker: class {}, WebAssembly: {}, crypto: { subtle: {} } };
    expect(deviceProvingSupported(full)).toBe(true);
    expect(deviceProvingSupported({ ...full, Worker: undefined })).toBe(false);
    expect(deviceProvingSupported({ ...full, WebAssembly: undefined })).toBe(false);
    expect(deviceProvingSupported({ ...full, crypto: {} })).toBe(false);
    expect(deviceProvingSupported({})).toBe(false);
  });
});

describe('keeping the screen awake', () => {
  it('holds a wake lock until released', async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));

    const letSleep = await keepScreenAwake({ navigator: { wakeLock: { request } } });
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    expect(release).not.toHaveBeenCalled();

    letSleep();
    expect(release).toHaveBeenCalledOnce();
  });

  it('does nothing where the browser has no wake lock or refuses it', async () => {
    expect(() => void keepScreenAwake({})).not.toThrow();
    (await keepScreenAwake({}))();

    const refused = await keepScreenAwake({
      navigator: {
        wakeLock: {
          request: async () => {
            throw new Error('NotAllowedError');
          },
        },
      },
    });
    expect(() => refused()).not.toThrow();
  });
});
