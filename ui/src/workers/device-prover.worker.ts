/// <reference lib="webworker" />
/*
 * Builds one proof with Midnight's WASM prover, then is terminated by the page.
 *
 * The prover runs here so the page stays responsive during a proof that takes
 * minutes on a phone. The witness arrives from the page and the proof goes
 * back to the page. This worker makes no network request of its own: it asks
 * the page for keys and public parameters, and the page checks them first.
 */
import type {
  DeviceProverKeys,
  DeviceProverReply,
  DeviceProverRequest,
  DeviceProverSupply,
} from '@/integration/device-prover';

declare const self: DedicatedWorkerGlobalScope;

interface Waiting {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

const waiting = new Map<string, Waiting>();

function post(reply: DeviceProverReply, transfer: Transferable[] = []): void {
  self.postMessage(reply, transfer);
}

function ask<T>(key: string, reply: DeviceProverReply): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.set(key, { resolve: resolve as (value: unknown) => void, reject });
    post(reply);
  });
}

const keyMaterial = {
  lookupKey: (keyLocation: string) =>
    ask<DeviceProverKeys | undefined>(`key:${keyLocation}`, { kind: 'need-key', keyLocation }),
  getParams: (k: number) => ask<Uint8Array>(`params:${k}`, { kind: 'need-params', k }),
};

function supply(message: DeviceProverSupply): void {
  const key = message.kind === 'key' ? `key:${message.keyLocation}` : `params:${message.k}`;
  const held = waiting.get(key);
  if (!held) return;
  waiting.delete(key);
  if (message.error !== undefined) held.reject(new Error(message.error));
  else if (message.kind === 'key') held.resolve(message.material ?? undefined);
  else held.resolve(message.params);
}

async function run(request: DeviceProverRequest): Promise<void> {
  try {
    // Loaded here, not at the top, so a slow or failed load is reported
    // instead of leaving a silent worker.
    const zkir = await import('@midnight-ntwrk/zkir-v2');
    if (request.op === 'check') {
      post({ kind: 'checked', value: await zkir.check(request.preimage, keyMaterial) });
      return;
    }
    const proof = await zkir.prove(request.preimage, keyMaterial, request.bindingInput);
    // The prover can return a view over WASM memory. Copy it, so the whole
    // memory is not cloned along with the proof.
    const copy = new Uint8Array(proof);
    post({ kind: 'proved', proof: copy }, [copy.buffer]);
  } catch (error) {
    post({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener(
  'message',
  (event: MessageEvent<DeviceProverRequest | DeviceProverSupply>) => {
    const message = event.data;
    if (message.kind === 'run') void run(message);
    else supply(message);
  },
);
