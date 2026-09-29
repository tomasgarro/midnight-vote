import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReferendumV2ProviderRuntime,
  REFERENDUM_V2_EXECUTION_MODES,
} from './midnight-v2-provider-runtime.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function walletApi(overrides: Partial<ConnectedAPI> = {}): ConnectedAPI {
  return {
    getConfiguration: vi.fn(async () => ({
      indexerUri: 'http://localhost:8088/api/v4/graphql',
      indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
      substrateNodeUri: 'http://localhost:9944',
      networkId: 'undeployed',
    })),
    getShieldedAddresses: vi.fn(async () => ({
      shieldedCoinPublicKey: 'coin-key',
      shieldedEncryptionPublicKey: 'encryption-key',
    })),
    getProvingProvider: vi.fn(async () => ({}) as never),
    ...overrides,
  } as unknown as ConnectedAPI;
}

describe('referendum v2 provider runtime composition', () => {
  it('exposes exactly the two wallet modes and the disclosed hosted-proving mode', () => {
    expect(REFERENDUM_V2_EXECUTION_MODES).toEqual([
      'direct-wallet',
      'sponsored-wallet',
      'sponsored-hosted-proving',
    ]);
  });

  it('composes hosted proving for a browser without a wallet', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://app.test' },
      navigator: { userAgent: 'vitest' },
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/keys')) {
        return response(200, { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' });
      }
      throw new Error(`unexpected URL ${String(input)}`);
    }) as typeof fetch;

    const runtime = await createReferendumV2ProviderRuntime({
      mode: 'sponsored-hosted-proving',
      options: {
        relayUrl: 'https://relay.test',
        networkId: 'preview',
        indexerUri: 'https://indexer.test/api/v4/graphql',
        indexerWsUri: 'wss://indexer.test/api/v4/graphql/ws',
        capabilityIssuer: { issue: vi.fn(async () => 'capability') },
        zkConfigBaseUrl: 'https://app.test/managed/referendum-v2',
        fetchImpl,
        hostedProving: { proofServerUri: 'https://proof.test', disclosureAccepted: true },
      },
    });

    expect(runtime.mode).toBe('sponsored-hosted-proving');
    if (runtime.mode !== 'sponsored-hosted-proving') {
      throw new Error('Expected the hosted-proving runtime');
    }
    expect(runtime.provingParty).toBe('hosted-server');
    expect(runtime.actionContext).toBeDefined();
    // Composition itself contacts the relay for its keys and nothing else.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dispatches direct-wallet to Lace-backed providers', async () => {
    vi.stubGlobal('window', undefined);
    const api = walletApi();

    const runtime = await createReferendumV2ProviderRuntime({
      mode: 'direct-wallet',
      api,
      options: { zkConfigBaseUrl: 'http://localhost:4173/managed/referendum-v2' },
    });

    expect(runtime.mode).toBe('direct-wallet');
    expect(runtime.providers.walletProvider).toBeDefined();
    expect(api.getProvingProvider).toHaveBeenCalledOnce();
  });

  it('dispatches sponsored-wallet to Lace proving plus the atomic relay', async () => {
    vi.stubGlobal('window', undefined);
    const api = walletApi();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/keys')) {
        return response(200, { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' });
      }
      throw new Error(`unexpected URL ${String(input)}`);
    }) as typeof fetch;

    const runtime = await createReferendumV2ProviderRuntime({
      mode: 'sponsored-wallet',
      api,
      options: {
        relayUrl: 'http://localhost:8790',
        networkId: 'undeployed',
        indexerUri: 'http://localhost:8088/api/v4/graphql',
        indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
        capabilityIssuer: { issue: vi.fn(async () => 'capability') },
        zkConfigBaseUrl: 'http://localhost:4173/managed/referendum-v2',
        fetchImpl,
      },
    });

    expect(runtime.mode).toBe('sponsored-wallet');
    if (runtime.mode !== 'sponsored-wallet') {
      throw new Error('Expected the sponsored-wallet runtime');
    }
    expect(runtime.actionContext).toBeDefined();
    expect(runtime.getLastActionTrace()).toBeNull();
    expect(api.getProvingProvider).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
