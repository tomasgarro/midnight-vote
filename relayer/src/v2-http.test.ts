import { createServer, type Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { signV2Capability } from './v2-capability.js';
import { v2RequestHash } from './v2-hash.js';
import { handleV2Route } from './v2-http.js';
import { V2ActionService } from './v2-service.js';
import { InMemoryV2ActionStore } from './v2-store.js';
import type { V2ActionRequest, V2IndexerReceiptResolver } from './v2-types.js';

const secret = 'capability-secret';
const body: Omit<V2ActionRequest, 'idempotencyKey' | 'requestHash'> = {
  actionId: 'action-http',
  network: 'preview',
  contractAddress: 'contract-1',
  circuit: 'castVote',
  action: 'vote',
  tx: 'aabbcc',
};

function capabilityFor(request: typeof body, idempotencyKey = 'request-http'): string {
  return signV2Capability(
    {
      actionId: request.actionId,
      idempotencyKey,
      network: request.network,
      contractAddress: request.contractAddress,
      circuit: request.circuit,
      action: request.action,
      requestHash: v2RequestHash(request),
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    },
    secret,
  );
}

function service(
  store = new InMemoryV2ActionStore(),
  receiptResolver: V2IndexerReceiptResolver = { resolve: vi.fn(async () => null) },
) {
  return {
    store,
    service: new V2ActionService({
      store,
      executor: {
        balanceAndFinalize: vi.fn(async (tx) => `finalized-${tx}`),
        submit: vi.fn(async () => 'tx-http'),
      },
      receiptResolver,
      allowedNetworks: ['preview'],
      allowedContracts: ['contract-1'],
      allowedCircuits: ['castVote'],
      capabilitySecret: secret,
      confirmationRetryMs: 60_000,
    }),
  };
}

async function withServer<T>(
  options: Parameters<typeof handleV2Route>[3],
  operation: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request, response) => {
    void handleV2Route(request, response, new URL(request.url ?? '/', 'http://127.0.0.1'), options);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    return await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await close(server);
  }
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe('v2 HTTP routes', () => {
  it('accepts browser POSTs without a long-lived bearer and requires the capability', async () => {
    const { service: actionService } = service();
    await withServer(
      { service: actionService, capabilitySecret: secret, serviceAuthToken: 'service-only-token' },
      async (baseUrl) => {
        const accepted = await fetch(`${baseUrl}/v2/actions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'request-http',
            'x-action-capability': capabilityFor(body),
          },
          body: JSON.stringify(body),
        });
        expect(accepted.status).toBe(202);
        expect(await accepted.json()).toMatchObject({ actionId: 'action-http', status: 'pending' });

        const missingCapability = await fetch(`${baseUrl}/v2/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': 'request-missing' },
          body: JSON.stringify({
            ...body,
            actionId: 'action-missing',
            idempotencyKey: 'request-missing',
          }),
        });
        expect(missingCapability.status).toBe(401);
        expect(await missingCapability.json()).toEqual({ error: 'capability_invalid' });
      },
    );
  });

  it('serves sanitized job state and canonical receipts without bearer auth', async () => {
    const store = new InMemoryV2ActionStore();
    const input = {
      id: 'action-http',
      actionId: 'action-http',
      idempotencyKey: 'request-http',
      capabilityDigest: 'a'.repeat(64),
      requestHash: 'b'.repeat(64),
      txDigest: 'c'.repeat(64),
      network: 'preview',
      contractAddress: 'contract-1',
      circuit: 'castVote',
      action: 'vote' as const,
      now: '2026-01-01T00:00:00.000Z',
    };
    await store.createOrGet(input);
    await store.transition(input.id, 'authorized', {
      status: 'submitted',
      transactionId: 'tx-http',
    });
    const receipt = {
      status: 'confirmed' as const,
      action: 'vote' as const,
      network: 'preview' as const,
      transactionId: 'tx-http',
      transactionHash: 'hash-http',
      contractAddress: 'contract-1',
      circuit: 'castVote',
      blockHeight: 2,
      blockHash: 'block-http',
      blockTimestamp: '2026-01-01T00:00:00.000Z',
    };
    const resolver: V2IndexerReceiptResolver = { resolve: vi.fn(async () => receipt) };
    const { service: actionService } = service(store, resolver);
    await withServer(
      { service: actionService, capabilitySecret: secret, serviceAuthToken: 'service-only-token' },
      async (baseUrl) => {
        const job = await fetch(`${baseUrl}/v2/actions/action-http`);
        expect(job.status).toBe(200);
        expect(await job.json()).toMatchObject({ actionId: 'action-http', status: 'confirmed' });

        const canonical = await fetch(`${baseUrl}/v2/receipts/action-http`);
        expect(canonical.status).toBe(200);
        const payload = await canonical.json();
        expect(payload).toEqual(receipt);
        expect(payload).not.toHaveProperty('secret');
      },
    );
  });

  it('returns sanitized client errors for malformed JSON and unknown routes', async () => {
    const { service: actionService } = service();
    await withServer({ service: actionService, capabilitySecret: secret }, async (baseUrl) => {
      const malformed = await fetch(`${baseUrl}/v2/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ error: 'invalid_request' });

      const unknown = await fetch(`${baseUrl}/v2/unknown`);
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'not_found' });
    });
  });

  it('rejects operator circuits at the public HTTP boundary', async () => {
    const { service: actionService, store } = service();
    await withServer({ service: actionService, capabilitySecret: secret }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v2/actions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'operator-request',
        },
        body: JSON.stringify({
          ...body,
          actionId: 'operator-action',
          circuit: 'closeVote',
        }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'not_allowlisted' });
      expect(await store.get('operator-action')).toBeNull();
    });
  });
});

describe('v2 HTTP circuit boundary', () => {
  function countingService() {
    return new V2ActionService({
      store: new InMemoryV2ActionStore(),
      executor: {
        balanceAndFinalize: vi.fn(async (tx) => `finalized-${tx}`),
        submit: vi.fn(async () => 'tx-count'),
      },
      receiptResolver: { resolve: vi.fn(async () => null) },
      // Deliberately wider than the public boundary, to show that the HTTP
      // layer refuses an organizer circuit even if the allowlist were wrong.
      allowedCircuits: ['castVote', 'revealVote', 'closeVote'],
      allowedNetworks: ['preview'],
      allowedContracts: ['contract-1'],
      capabilitySecret: secret,
      confirmationRetryMs: 60_000,
    });
  }

  function post(baseUrl: string, request: typeof body, idempotencyKey: string) {
    return fetch(`${baseUrl}/v2/actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'x-action-capability': capabilityFor(request, idempotencyKey),
      },
      body: JSON.stringify(request),
    });
  }

  it('carries the count of a sealed answer', async () => {
    await withServer({ service: countingService(), capabilitySecret: secret }, async (baseUrl) => {
      const count = { ...body, actionId: 'action-count', circuit: 'revealVote' };
      const accepted = await post(baseUrl, count, 'request-count');
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toMatchObject({ actionId: 'action-count', status: 'pending' });
    });
  });

  it.each([['closeVote'], ['finalizeVote'], ['addCredential'], ['freeze']])(
    'refuses %s before it reaches the service',
    async (circuit) => {
      const service = countingService();
      const accept = vi.spyOn(service, 'accept');
      await withServer({ service, capabilitySecret: secret }, async (baseUrl) => {
        const refused = await post(
          baseUrl,
          { ...body, actionId: `action-${circuit}`, circuit },
          `request-${circuit}`,
        );
        expect(refused.status).toBe(403);
        expect(await refused.json()).toEqual({ error: 'not_allowlisted' });
      });
      expect(accept).not.toHaveBeenCalled();
    },
  );
});
