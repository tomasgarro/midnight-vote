import type { ProvingProvider } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  type ZKConfigProvider,
  zkConfigToProvingKeyMaterial,
} from '@midnight-ntwrk/midnight-js-types';

/**
 * On-device proving (ADR-011). The proof is built by Midnight's WASM prover
 * inside the person's own browser, so the answer, its salt and the pass secret
 * are never sent to a proving server.
 *
 * This module supplies what that prover asks for: the circuit's keys and the
 * public parameters for its size. The prover itself runs in a worker owned by
 * the interface; here it is only a `ProvingProvider`.
 */

/** Key material in the shape `@midnight-ntwrk/zkir-v2` expects. */
export interface DeviceProvingKeyMaterial {
  readonly proverKey: Uint8Array;
  readonly verifierKey: Uint8Array;
  readonly ir: Uint8Array;
}

export interface DeviceKeyMaterialProvider {
  lookupKey(keyLocation: string): Promise<DeviceProvingKeyMaterial | undefined>;
  getParams(k: number): Promise<Uint8Array>;
}

/**
 * SHA-256 of Midnight's public parameter files, by circuit size `k`. Only the
 * sizes this app proves on a device are listed: `castVote` is k=15 and
 * `revealVote` is k=13. A file that does not match is refused, so a host that
 * serves altered parameters produces an error instead of a proof.
 */
export const MIDNIGHT_PARAMS_SHA256: Readonly<Record<number, string>> = {
  13: 'd3324910969c4cc54143b8045b649e5c3a4bd5fb7b8f85fe1b770f640ce1c803',
  15: '724c7c3d779148bb113c7ee9c034b2f27db16e6bdf315fde90105a9bad00b1de',
};

export interface DeviceKeyMaterialOptions<K extends string> {
  readonly zkConfigProvider: ZKConfigProvider<K>;
  /** The circuits a device may prove. Any other key location is refused. */
  readonly circuits: readonly K[];
  /** Where `bls_midnight_2p<k>` is served, normally the app's own origin. */
  readonly paramsBaseUrl: string;
  readonly paramsSha256?: Readonly<Record<number, string>>;
  readonly fetchImpl?: typeof fetch;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createDeviceKeyMaterialProvider<K extends string>(
  options: DeviceKeyMaterialOptions<K>,
): DeviceKeyMaterialProvider {
  const baseUrl = options.paramsBaseUrl.trim().replace(/\/+$/u, '');
  if (!baseUrl) throw new TypeError('paramsBaseUrl must not be empty');
  const digests = options.paramsSha256 ?? MIDNIGHT_PARAMS_SHA256;
  const allowed = new Set<string>(options.circuits);
  const keys = new Map<string, Promise<DeviceProvingKeyMaterial>>();
  const params = new Map<number, Promise<Uint8Array>>();

  const remember = <I, V>(cache: Map<I, Promise<V>>, id: I, load: () => Promise<V>) => {
    const held = cache.get(id);
    if (held) return held;
    const loading = load();
    cache.set(id, loading);
    // A failed download must not be remembered as the answer.
    loading.catch(() => {
      if (cache.get(id) === loading) cache.delete(id);
    });
    return loading;
  };

  return {
    lookupKey: async (keyLocation) => {
      if (!allowed.has(keyLocation)) return undefined;
      return remember(keys, keyLocation, async () =>
        zkConfigToProvingKeyMaterial(await options.zkConfigProvider.get(keyLocation as K)),
      );
    },
    getParams: (k) =>
      remember(params, k, async () => {
        const expected = digests[k];
        if (!Number.isInteger(k) || !expected) {
          throw new Error(`No pinned public parameters for circuit size ${k}`);
        }
        const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/bls_midnight_2p${k}`);
        if (!response.ok) {
          throw new Error(`Public parameters for size ${k} are unavailable (${response.status})`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
        if (digest !== expected) {
          throw new Error(`Public parameters for size ${k} failed their integrity check`);
        }
        return bytes;
      }),
  };
}

/** How long a device spent on one proof. Timing only; never the inputs. */
export interface DeviceProofTiming {
  readonly keyLocation: string;
  readonly milliseconds: number;
}

/**
 * Wraps the device prover so the interface can show that work is under way and
 * report how long it took. It observes timing and nothing else.
 */
export function observeDeviceProving(
  provider: ProvingProvider,
  observer: {
    readonly onStart?: (keyLocation: string) => void;
    readonly onFinish?: (timing: DeviceProofTiming) => void;
    readonly now?: () => number;
  },
): ProvingProvider {
  const now = observer.now ?? (() => Date.now());
  return {
    check: (preimage, keyLocation) => provider.check(preimage, keyLocation),
    prove: async (preimage, keyLocation, overwriteBindingInput) => {
      const started = now();
      observer.onStart?.(keyLocation);
      try {
        return await provider.prove(preimage, keyLocation, overwriteBindingInput);
      } finally {
        observer.onFinish?.({ keyLocation, milliseconds: now() - started });
      }
    },
  };
}
