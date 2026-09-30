import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createReferendumV2WalletlessProviders,
  InMemoryWalletlessPendingActionStore,
  type WalletlessActionCapabilityIssuer,
  walletlessActionRequestHash,
} from './midnight-v2-relayer-providers.js';

const scope = {
  credentialAuthorization: 'credential:issued-1',
  contractAddress: 'contract-1',
  circuit: 'castVote' as const,
  action: 'vote' as const,
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('v2 walletless providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires Lace proving in the browser and never contacts an HTTP proof server', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://app.test' },
      navigator: { userAgent: 'vitest' },
    });
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/keys')) {
        return response(200, { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;
    const api = {
      getProvingProvider: vi.fn(async () => ({}) as never),
    } as unknown as ConnectedAPI;

    await createReferendumV2WalletlessProviders({
      relayUrl: 'https://relay.test',
      networkId: 'preview',
      indexerUri: 'https://indexer.test/api/v4/graphql',
      indexerWsUri: 'wss://indexer.test/api/v4/graphql/ws',
      capabilityIssuer: { issue: vi.fn(async () => 'capability') },
      zkConfigBaseUrl: 'https://app.test/managed/referendum-v2',
      fetchImpl,
      api,
    });

    expect(api.getProvingProvider).toHaveBeenCalledOnce();
    expect(requests).toEqual(['https://relay.test/keys']);
  });

  it('fails closed when a browser caller has no connected Lace API', async () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://app.test' },
      navigator: { userAgent: 'vitest' },
    });

    await expect(
      createReferendumV2WalletlessProviders({
        relayUrl: 'https://relay.test',
        proofServerUri: 'https://proof.test',
        networkId: 'preview',
        indexerUri: 'https://indexer.test/api/v4/graphql',
        indexerWsUri: 'wss://indexer.test/api/v4/graphql/ws',
        capabilityIssuer: { issue: vi.fn(async () => 'capability') },
        zkConfigBaseUrl: 'https://app.test/managed/referendum-v2',
        fetchImpl: vi.fn() as typeof fetch,
      }),
    ).rejects.toThrow(/require a connected Lace API for proving/iu);
  });

  it('allows hosted proving in a browser only with its disclosure flag', async () => {
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
    const base = {
      relayUrl: 'https://relay.test',
      networkId: 'preview' as const,
      indexerUri: 'https://indexer.test/api/v4/graphql',
      indexerWsUri: 'wss://indexer.test/api/v4/graphql/ws',
      capabilityIssuer: { issue: vi.fn(async () => 'capability') },
      zkConfigBaseUrl: 'https://app.test/managed/referendum-v2',
      fetchImpl,
    };

    const runtime = await createReferendumV2WalletlessProviders({
      ...base,
      hostedProving: { proofServerUri: 'https://proof.test', disclosureAccepted: true },
    });
    expect(runtime.provingParty).toBe('hosted-server');
    expect(runtime.providers.proofProvider).toBeDefined();

    // A config file or a cast cannot switch the mode on without the flag.
    await expect(
      createReferendumV2WalletlessProviders({
        ...base,
        hostedProving: { proofServerUri: 'https://proof.test' } as never,
      }),
    ).rejects.toThrow(/accepted its disclosure/iu);
    await expect(
      createReferendumV2WalletlessProviders({
        ...base,
        hostedProving: {
          proofServerUri: 'https://proof.test',
          disclosureAccepted: 'yes',
        } as never,
      }),
    ).rejects.toThrow(/accepted its disclosure/iu);

    // The witness never travels over plain HTTP to a remote host.
    await expect(
      createReferendumV2WalletlessProviders({
        ...base,
        hostedProving: { proofServerUri: 'http://proof.test', disclosureAccepted: true },
      }),
    ).rejects.toThrow(/must use HTTPS/iu);
  });

  it('keeps device proving to a single prover', async () => {
    vi.stubGlobal('window', undefined);
    const base = {
      relayUrl: 'https://relay.test',
      networkId: 'preview' as const,
      indexerUri: 'https://indexer.test/api/v4/graphql',
      indexerWsUri: 'wss://indexer.test/api/v4/graphql/ws',
      capabilityIssuer: { issue: vi.fn(async () => 'capability') },
      zkConfigBaseUrl: 'https://app.test/managed/referendum-v2',
      fetchImpl: vi.fn() as typeof fetch,
      deviceProving: { provingProvider: { check: vi.fn(), prove: vi.fn() } },
    };
    const api = { getProvingProvider: vi.fn(async () => ({}) as never) } as unknown as ConnectedAPI;

    await expect(createReferendumV2WalletlessProviders({ ...base, api })).rejects.toThrow(
      /cannot be combined with another prover/iu,
    );
    await expect(
      createReferendumV2WalletlessProviders({ ...base, proofServerUri: 'https://proof.test' }),
    ).rejects.toThrow(/cannot be combined with another prover/iu);
    await expect(
      createReferendumV2WalletlessProviders({
        ...base,
        hostedProving: { proofServerUri: 'https://proof.test', disclosureAccepted: true },
      }),
    ).rejects.toThrow(/cannot be combined with another prover/iu);
    await expect(
      createReferendumV2WalletlessProviders({
        ...base,
        deviceProving: { provingProvider: {} as never },
      }),
    ).rejects.toThrow(/requires a proving provider/iu);
    expect(api.getProvingProvider).not.toHaveBeenCalled();
    expect(base.fetchImpl).not.toHaveBeenCalled();
  });

  it('never combines hosted proving with a wallet or a second proof server', async () => {
    vi.stubGlobal('window', undefined);
    const base = {
      relayUrl: 'https://relay.test',
      networkId: 'preview' as const,
      indexerUri: 'https://indexer.test/api/v4/graphql',
      indexerWsUri: 'wss://indexer.test/api/v4/graphql/ws',
      capabilityIssuer: { issue: vi.fn(async () => 'capability') },
      zkConfigBaseUrl: 'https://app.test/managed/referendum-v2',
      fetchImpl: vi.fn() as typeof fetch,
      hostedProving: { proofServerUri: 'https://proof.test', disclosureAccepted: true as const },
    };
    const api = { getProvingProvider: vi.fn(async () => ({}) as never) } as unknown as ConnectedAPI;

    await expect(createReferendumV2WalletlessProviders({ ...base, api })).rejects.toThrow(
      /browser proving must stay in the wallet/iu,
    );
    expect(api.getProvingProvider).not.toHaveBeenCalled();
    await expect(
      createReferendumV2WalletlessProviders({ ...base, proofServerUri: 'https://other.test' }),
    ).rejects.toThrow(/mutually exclusive/iu);
  });

  it('uses the relay request digest shared by the capability and atomic action', async () => {
    const issued: Parameters<WalletlessActionCapabilityIssuer['issue']>[0][] = [];
    let posted: Record<string, unknown> | null = null;
    const capabilityIssuer: WalletlessActionCapabilityIssuer = {
      issue: vi.fn(async (request) => {
        issued.push(request);
        return 'signed.one-time.capability';
      }),
    };
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/keys')) {
        return response(200, { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' });
      }
      if (url.endsWith('/v2/actions') && init?.method === 'POST') {
        posted = JSON.parse(String(init.body));
        return response(202, {
          actionId: posted?.actionId,
          status: 'pending',
          requestHash: posted?.requestHash,
          network: 'undeployed',
          contractAddress: 'contract-1',
          circuit: 'castVote',
        });
      }
      if (url.includes('/v2/receipts/')) {
        return response(200, canonicalReceipt('tx-1'));
      }
      if (url.includes('/v2/actions/')) {
        return response(200, {
          actionId: issued[0]?.actionId,
          status: 'pending',
          requestHash: issued[0]?.requestHash,
          network: 'undeployed',
          contractAddress: 'contract-1',
          circuit: 'castVote',
          transactionId: 'tx-1',
        });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;
    const runtime = await createReferendumV2WalletlessProviders({
      relayUrl: 'http://localhost:8790',
      proofServerUri: 'http://localhost:6300',
      networkId: 'undeployed',
      indexerUri: 'http://localhost:8088/api/v4/graphql',
      indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
      capabilityIssuer,
      fetchImpl,
      zkConfigBaseUrl: 'http://localhost:4173/managed/referendum-v2',
      pollIntervalMs: 10,
      submissionTimeoutMs: 100,
    });
    const proven = { serialize: () => Uint8Array.from([0xab, 0xcd]) };

    const transactionId = await runtime.actionContext.run(scope, async () => {
      const forwarded = await runtime.providers.walletProvider.balanceTx(proven as never);
      return runtime.providers.midnightProvider.submitTx(forwarded);
    });

    const expectedHash = await walletlessActionRequestHash({
      action: 'vote',
      contractAddress: 'contract-1',
      circuit: 'castVote',
      network: 'undeployed',
      tx: 'abcd',
    });
    expect(transactionId).toBe('tx-1');
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({
      requestHash: expectedHash,
      credentialAuthorization: scope.credentialAuthorization,
    });
    expect(posted).toMatchObject({ requestHash: expectedHash, tx: 'abcd' });
    expect(JSON.stringify(posted)).not.toContain(scope.credentialAuthorization);
    expect(requests.some((url) => url.endsWith('/balance') || url.endsWith('/submit'))).toBe(false);
    expect(requests.some((url) => url.includes('/v2/receipts/'))).toBe(true);
    expect(runtime.getLastActionTrace()).toMatchObject({
      requestHash: expectedHash,
      transactionId: 'tx-1',
      status: 'confirmed',
    });
  });

  it('recovers a previously accepted action after a provider restart without resubmitting', async () => {
    const pendingStore = new InMemoryWalletlessPendingActionStore();
    const capabilityIssuer = { issue: vi.fn(async () => 'capability') };
    let postCount = 0;
    let actionId = '';
    let requestHash = '';
    const firstFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/keys')) {
        return response(200, { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' });
      }
      if (init?.method === 'POST') {
        postCount += 1;
        const body = JSON.parse(String(init.body));
        actionId = body.actionId;
        requestHash = body.requestHash;
        throw new Error('connection dropped after relay acceptance');
      }
      throw new Error('unexpected first request');
    }) as typeof fetch;
    const common = {
      relayUrl: 'http://localhost:8790',
      proofServerUri: 'http://localhost:6300',
      networkId: 'undeployed' as const,
      indexerUri: 'http://localhost:8088/api/v4/graphql',
      indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
      capabilityIssuer,
      pendingStore,
      zkConfigBaseUrl: 'http://localhost:4173/managed/referendum-v2',
      pollIntervalMs: 10,
      submissionTimeoutMs: 100,
    };
    const first = await createReferendumV2WalletlessProviders({ ...common, fetchImpl: firstFetch });
    const proven = { serialize: () => Uint8Array.from([1, 2]) };
    await expect(
      first.actionContext.run(scope, async () =>
        first.providers.midnightProvider.submitTx(
          await first.providers.walletProvider.balanceTx(proven as never),
        ),
      ),
    ).rejects.toThrow('connection dropped');

    const secondFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/keys')) {
        return response(200, { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' });
      }
      if (String(input).includes('/v2/receipts/')) {
        return response(200, canonicalReceipt('tx-recovered'));
      }
      if (String(input).includes('/v2/actions/')) {
        return response(200, {
          actionId,
          status: 'pending',
          requestHash,
          network: 'undeployed',
          contractAddress: 'contract-1',
          circuit: 'castVote',
          transactionId: 'tx-recovered',
        });
      }
      throw new Error('restart attempted to submit again');
    }) as typeof fetch;
    const second = await createReferendumV2WalletlessProviders({
      ...common,
      fetchImpl: secondFetch,
    });
    const recovered = await second.actionContext.run(scope, async () =>
      second.providers.midnightProvider.submitTx(
        await second.providers.walletProvider.balanceTx(proven as never),
      ),
    );

    expect(recovered).toBe('tx-recovered');
    expect(postCount).toBe(1);
    expect(capabilityIssuer.issue).toHaveBeenCalledTimes(1);
  });

  it('does not treat a relay transaction id as a canonical receipt', async () => {
    const capabilityIssuer = { issue: vi.fn(async () => 'capability') };
    let receiptPolls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/keys')) {
        return response(200, { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' });
      }
      if (url.endsWith('/v2/actions') && init?.method === 'POST') {
        const request = JSON.parse(String(init.body));
        return response(202, {
          actionId: request.actionId,
          status: 'pending',
          requestHash: request.requestHash,
          network: 'undeployed',
          contractAddress: 'contract-1',
          circuit: 'castVote',
          transactionId: 'tx-indexer-gated',
        });
      }
      if (url.includes('/v2/receipts/')) {
        receiptPolls += 1;
        return receiptPolls === 1
          ? response(202, { status: 'pending' })
          : response(200, canonicalReceipt('tx-indexer-gated'));
      }
      if (url.includes('/v2/actions/')) {
        return response(200, {
          actionId: url.split('/').at(-1),
          status: 'pending',
          requestHash: 'pending',
          network: 'undeployed',
          contractAddress: 'contract-1',
          circuit: 'castVote',
          transactionId: 'tx-indexer-gated',
        });
      }
      throw new Error(`unexpected URL ${url}`);
    }) as typeof fetch;
    const runtime = await createReferendumV2WalletlessProviders({
      relayUrl: 'http://localhost:8790',
      proofServerUri: 'http://localhost:6300',
      networkId: 'undeployed',
      indexerUri: 'http://localhost:8088/api/v4/graphql',
      indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
      capabilityIssuer,
      fetchImpl,
      zkConfigBaseUrl: 'http://localhost:4173/managed/referendum-v2',
      pollIntervalMs: 10,
      submissionTimeoutMs: 100,
    });
    const proven = { serialize: () => Uint8Array.from([3, 4]) };
    const transactionId = await runtime.actionContext.run(scope, async () =>
      runtime.providers.midnightProvider.submitTx(
        await runtime.providers.walletProvider.balanceTx(proven as never),
      ),
    );

    expect(transactionId).toBe('tx-indexer-gated');
    expect(receiptPolls).toBe(2);
  });
});

function canonicalReceipt(transactionId: string) {
  return {
    status: 'confirmed',
    action: 'vote',
    network: 'undeployed',
    transactionId,
    transactionHash: `hash-${transactionId}`,
    contractAddress: 'contract-1',
    circuit: 'castVote',
    blockHeight: 7,
    blockHash: 'block-7',
    blockTimestamp: '2026-08-29T00:00:00.000Z',
  };
}
