import type { ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import { describe, expect, it, vi } from 'vitest';
import {
  createDeviceKeyMaterialProvider,
  MIDNIGHT_PARAMS_SHA256,
  observeDeviceProving,
} from './device-proving.js';

type Circuit = 'castVote' | 'revealVote';

function zkConfig() {
  const get = vi.fn(async (circuitId: Circuit) => ({
    circuitId,
    proverKey: new Uint8Array([1, circuitId.length]),
    verifierKey: new Uint8Array([2]),
    zkir: new Uint8Array([3]),
  }));
  return { provider: { get } as unknown as ZKConfigProvider<Circuit>, get };
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function served(bytes: Uint8Array<ArrayBuffer>, status = 200) {
  return vi.fn(
    async () => new Response(status === 200 ? bytes : null, { status }),
  ) as unknown as typeof fetch;
}

describe('device key material', () => {
  it('hands the prover the keys of an allowed circuit, fetched once', async () => {
    const { provider, get } = zkConfig();
    const material = createDeviceKeyMaterialProvider({
      zkConfigProvider: provider,
      circuits: ['castVote', 'revealVote'],
      paramsBaseUrl: 'https://midnight.vote/zk-params',
    });

    const first = await material.lookupKey('castVote');
    const second = await material.lookupKey('castVote');

    expect(first).toEqual({
      proverKey: new Uint8Array([1, 8]),
      verifierKey: new Uint8Array([2]),
      ir: new Uint8Array([3]),
    });
    expect(second).toBe(first);
    expect(get).toHaveBeenCalledExactlyOnceWith('castVote');
  });

  it('refuses a circuit the device has no business proving', async () => {
    const { provider, get } = zkConfig();
    const material = createDeviceKeyMaterialProvider({
      zkConfigProvider: provider,
      circuits: ['castVote', 'revealVote'],
      paramsBaseUrl: 'https://midnight.vote/zk-params',
    });

    expect(await material.lookupKey('finalizeVote')).toBeUndefined();
    expect(await material.lookupKey('midnight/zswap/spend')).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('accepts public parameters only when they match the pinned digest', async () => {
    const genuine = new Uint8Array([9, 9, 9]);
    const fetchImpl = served(genuine);
    const material = createDeviceKeyMaterialProvider({
      zkConfigProvider: zkConfig().provider,
      circuits: ['castVote'],
      paramsBaseUrl: 'https://midnight.vote/zk-params/',
      paramsSha256: { 15: await sha256(genuine) },
      fetchImpl,
    });

    expect(await material.getParams(15)).toEqual(genuine);
    expect(await material.getParams(15)).toEqual(genuine);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'https://midnight.vote/zk-params/bls_midnight_2p15',
    );
  });

  it('refuses altered parameters, and tries again on the next request', async () => {
    const genuine = new Uint8Array([9, 9, 9]);
    const responses = [new Uint8Array([6, 6, 6]), genuine];
    const fetchImpl = vi.fn(
      async () => new Response(responses.shift() ?? null),
    ) as unknown as typeof fetch;
    const material = createDeviceKeyMaterialProvider({
      zkConfigProvider: zkConfig().provider,
      circuits: ['castVote'],
      paramsBaseUrl: 'https://midnight.vote/zk-params',
      paramsSha256: { 15: await sha256(genuine) },
      fetchImpl,
    });

    await expect(material.getParams(15)).rejects.toThrow(/integrity check/u);
    expect(await material.getParams(15)).toEqual(genuine);
  });

  it('fails closed for a size it has no digest for, without fetching', async () => {
    const fetchImpl = served(new Uint8Array([1]));
    const material = createDeviceKeyMaterialProvider({
      zkConfigProvider: zkConfig().provider,
      circuits: ['castVote'],
      paramsBaseUrl: 'https://midnight.vote/zk-params',
      fetchImpl,
    });

    await expect(material.getParams(16)).rejects.toThrow(/No pinned public parameters/u);
    await expect(material.getParams(1.5)).rejects.toThrow(/No pinned public parameters/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a missing parameter file instead of proving with nothing', async () => {
    const material = createDeviceKeyMaterialProvider({
      zkConfigProvider: zkConfig().provider,
      circuits: ['castVote'],
      paramsBaseUrl: 'https://midnight.vote/zk-params',
      fetchImpl: served(new Uint8Array(), 404),
    });

    await expect(material.getParams(15)).rejects.toThrow(/unavailable \(404\)/u);
    expect(() =>
      createDeviceKeyMaterialProvider({
        zkConfigProvider: zkConfig().provider,
        circuits: ['castVote'],
        paramsBaseUrl: '  ',
      }),
    ).toThrow(/paramsBaseUrl/u);
  });

  it('pins the two sizes this app proves on a device', () => {
    expect(Object.keys(MIDNIGHT_PARAMS_SHA256)).toEqual(['13', '15']);
    for (const digest of Object.values(MIDNIGHT_PARAMS_SHA256)) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('pins the same digests as the script that downloads the files', async () => {
    const script = new URL('../../../scripts/fetch-zk-params.mjs', import.meta.url).href;
    const downloaded = (await import(/* @vite-ignore */ script)) as {
      MIDNIGHT_PARAMS_SHA256: Record<string, string>;
    };
    expect({ ...downloaded.MIDNIGHT_PARAMS_SHA256 }).toEqual({ ...MIDNIGHT_PARAMS_SHA256 });
  });
});

describe('observing device proving', () => {
  it('reports timing and passes the proof through unchanged', async () => {
    const proof = new Uint8Array([7]);
    const inner = {
      check: vi.fn(async () => [1n]),
      prove: vi.fn(async () => proof),
    };
    const clock = [1_000, 43_500];
    const onStart = vi.fn();
    const onFinish = vi.fn();
    const observed = observeDeviceProving(inner, {
      onStart,
      onFinish,
      now: () => clock.shift() ?? 0,
    });
    const preimage = new Uint8Array([5]);

    expect(await observed.prove(preimage, 'revealVote', 4n)).toBe(proof);
    expect(inner.prove).toHaveBeenCalledExactlyOnceWith(preimage, 'revealVote', 4n);
    expect(onStart).toHaveBeenCalledExactlyOnceWith('revealVote');
    expect(onFinish).toHaveBeenCalledExactlyOnceWith({
      keyLocation: 'revealVote',
      milliseconds: 42_500,
    });
    expect(await observed.check(preimage, 'revealVote')).toEqual([1n]);
  });

  it('still reports the end of a proof that failed', async () => {
    const onFinish = vi.fn();
    const observed = observeDeviceProving(
      {
        check: async () => [],
        prove: async () => {
          throw new Error('out of memory');
        },
      },
      { onFinish, now: () => 0 },
    );

    await expect(observed.prove(new Uint8Array(), 'castVote')).rejects.toThrow('out of memory');
    expect(onFinish).toHaveBeenCalledOnce();
  });
});
