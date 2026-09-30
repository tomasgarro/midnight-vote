/*
 * On-device proving (ADR-011): the page side of the prover worker.
 *
 * Each proof gets its own worker, which is terminated when the proof is done.
 * A proof holds several hundred megabytes while it runs, and a phone gets that
 * memory back only when the worker is gone.
 */
import type { DeviceKeyMaterialProvider } from 'midnight-referendum-api';

/** Matches the ledger's `ProvingProvider`, which midnight-js proves through. */
export interface DeviceProvingProvider {
  check(serializedPreimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(
    serializedPreimage: Uint8Array,
    keyLocation: string,
    overwriteBindingInput?: bigint,
  ): Promise<Uint8Array>;
}

export type DeviceProverRequest =
  | { readonly kind: 'run'; readonly op: 'check'; readonly preimage: Uint8Array }
  | {
      readonly kind: 'run';
      readonly op: 'prove';
      readonly preimage: Uint8Array;
      readonly bindingInput?: bigint;
    };

export interface DeviceProverKeys {
  readonly proverKey: Uint8Array;
  readonly verifierKey: Uint8Array;
  readonly ir: Uint8Array;
}

export type DeviceProverSupply =
  | {
      readonly kind: 'key';
      readonly keyLocation: string;
      readonly material?: DeviceProverKeys | null;
      readonly error?: string;
    }
  | {
      readonly kind: 'params';
      readonly k: number;
      readonly params?: Uint8Array;
      readonly error?: string;
    };

export type DeviceProverReply =
  | { readonly kind: 'need-key'; readonly keyLocation: string }
  | { readonly kind: 'need-params'; readonly k: number }
  | { readonly kind: 'checked'; readonly value: (bigint | undefined)[] }
  | { readonly kind: 'proved'; readonly proof: Uint8Array }
  | { readonly kind: 'failed'; readonly message: string };

/** The part of `Worker` this module uses, so a test can stand in for it. */
export interface ProverWorker {
  postMessage(message: DeviceProverRequest | DeviceProverSupply, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { data: DeviceProverReply }) => void): void;
  addEventListener(type: 'error', listener: (event: { message?: string }) => void): void;
  terminate(): void;
}

export interface WorkerProvingOptions {
  readonly createWorker: () => ProverWorker;
  readonly keyMaterial: DeviceKeyMaterialProvider;
  /** A proof that runs longer than this is abandoned. Ten minutes by default. */
  readonly timeoutMs?: number;
}

export const DEVICE_PROOF_TIMEOUT_MS = 10 * 60 * 1000;

function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createWorkerProvingProvider(options: WorkerProvingOptions): DeviceProvingProvider {
  const timeoutMs = options.timeoutMs ?? DEVICE_PROOF_TIMEOUT_MS;

  const run = <T>(
    request: DeviceProverRequest,
    read: (reply: DeviceProverReply) => T | undefined,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const worker = options.createWorker();
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        settle();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error('This device took too long to build the proof'))),
        timeoutMs,
      );

      worker.addEventListener('error', (event) =>
        finish(() => reject(new Error(event.message || 'The prover stopped unexpectedly'))),
      );
      worker.addEventListener('message', ({ data }) => {
        if (settled) return;
        if (data.kind === 'need-key') {
          const { keyLocation } = data;
          options.keyMaterial.lookupKey(keyLocation).then(
            (material) => {
              if (!settled) {
                worker.postMessage({ kind: 'key', keyLocation, material: material ?? null });
              }
            },
            (error: unknown) => {
              if (!settled) {
                worker.postMessage({
                  kind: 'key',
                  keyLocation,
                  error: reason(error, 'The circuit keys are unavailable'),
                });
              }
            },
          );
          return;
        }
        if (data.kind === 'need-params') {
          const { k } = data;
          options.keyMaterial.getParams(k).then(
            (params) => {
              if (!settled) worker.postMessage({ kind: 'params', k, params });
            },
            (error: unknown) => {
              if (!settled) {
                worker.postMessage({
                  kind: 'params',
                  k,
                  error: reason(error, 'The public parameters are unavailable'),
                });
              }
            },
          );
          return;
        }
        if (data.kind === 'failed') {
          finish(() => reject(new Error(data.message)));
          return;
        }
        const value = read(data);
        if (value !== undefined) finish(() => resolve(value));
      });

      // A copy goes to the worker. The caller keeps its own bytes.
      const preimage = new Uint8Array(request.preimage);
      worker.postMessage({ ...request, preimage }, [preimage.buffer]);
    });

  return {
    check: (serializedPreimage) =>
      run({ kind: 'run', op: 'check', preimage: serializedPreimage }, (reply) =>
        reply.kind === 'checked' ? reply.value : undefined,
      ),
    prove: (serializedPreimage, _keyLocation, overwriteBindingInput) =>
      run(
        {
          kind: 'run',
          op: 'prove',
          preimage: serializedPreimage,
          ...(overwriteBindingInput === undefined ? {} : { bindingInput: overwriteBindingInput }),
        },
        (reply) => (reply.kind === 'proved' ? reply.proof : undefined),
      ),
  };
}

/** Whether this browser can run the prover at all. It says nothing about speed. */
export function deviceProvingSupported(
  scope: { Worker?: unknown; WebAssembly?: unknown; crypto?: { subtle?: unknown } } = globalThis,
): boolean {
  return (
    typeof scope.Worker === 'function' &&
    typeof scope.WebAssembly === 'object' &&
    scope.WebAssembly !== null &&
    typeof scope.crypto?.subtle === 'object' &&
    scope.crypto.subtle !== null
  );
}

interface WakeLockScope {
  navigator?: {
    wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
  };
}

/**
 * Keeps the screen awake while a proof is built. A phone that locks its screen
 * suspends the page, and the proof with it. Resolves to the function that lets
 * the screen sleep again. A browser without the API does nothing.
 */
export async function keepScreenAwake(
  scope: WakeLockScope = globalThis as WakeLockScope,
): Promise<() => void> {
  try {
    const lock = await scope.navigator?.wakeLock?.request('screen');
    return () => {
      void lock?.release().catch(() => undefined);
    };
  } catch {
    return () => undefined;
  }
}
