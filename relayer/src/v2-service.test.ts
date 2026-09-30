import { describe, expect, it, vi } from 'vitest';
import { signV2Capability } from './v2-capability.js';
import { v2RequestHash } from './v2-hash.js';
import { V2ActionService } from './v2-service.js';
import { InMemoryV2ActionStore } from './v2-store.js';
import type { V2ActionRequest, V2IndexerReceiptResolver, V2RelayerExecutor } from './v2-types.js';

const secret = 'capability-secret';
const baseRequest: Omit<V2ActionRequest, 'idempotencyKey' | 'requestHash'> = {
  actionId: 'action-1',
  network: 'preview',
  contractAddress: 'contract-1',
  circuit: 'castVote',
  action: 'vote',
  tx: 'aabbcc',
};

function headersFor(
  request: Omit<V2ActionRequest, 'idempotencyKey' | 'requestHash'> & {
    idempotencyKey?: string;
  },
) {
  const idempotencyKey = request.idempotencyKey ?? 'request-1';
  const requestHash = v2RequestHash(request);
  const { idempotencyKey: _ignored, ...hashInput } = request;
  const token = signV2Capability(
    {
      actionId: request.actionId,
      idempotencyKey,
      network: request.network,
      contractAddress: request.contractAddress,
      circuit: request.circuit,
      action: request.action,
      requestHash,
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    },
    secret,
  );
  return {
    idempotencyKey,
    capability: token,
    requestHash,
    hashInput,
  };
}

function makeService(
  store = new InMemoryV2ActionStore(),
  executor: V2RelayerExecutor = {
    balanceAndFinalize: vi.fn(async (tx) => `finalized-${tx}`),
    submit: vi.fn(async () => 'tx-1'),
  },
  receiptResolver: V2IndexerReceiptResolver = { resolve: vi.fn(async () => null) },
) {
  return {
    store,
    executor,
    receiptResolver,
    service: new V2ActionService({
      store,
      executor,
      receiptResolver,
      allowedNetworks: ['preview'],
      allowedContracts: ['contract-1'],
      allowedCircuits: ['castVote'],
      capabilitySecret: secret,
      confirmationRetryMs: 60_000,
      idFactory: () => 'reservation',
    }),
  };
}

describe('v2 walletless action service', () => {
  it('requires the one-time capability and rejects nested private material', async () => {
    const { service } = makeService();
    await expect(
      service.accept({ ...baseRequest, metadata: { choice: true } }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      service.accept({ ...baseRequest, idempotencyKey: 'request-1' }),
    ).rejects.toMatchObject({
      code: 'capability_invalid',
    });
  });

  it('accepts a proved transaction and confirms only after an indexer observation', async () => {
    const receipt = {
      status: 'confirmed' as const,
      action: 'vote' as const,
      network: 'preview' as const,
      transactionId: 'tx-1',
      transactionHash: 'hash-1',
      contractAddress: 'contract-1',
      circuit: 'castVote',
      blockHeight: 4,
      blockHash: 'block-4',
      blockTimestamp: '2026-01-01T00:00:00.000Z',
    };
    const resolver = { resolve: vi.fn(async () => null as typeof receipt | null) };
    const { service, store } = makeService(undefined, undefined, resolver);
    const body = { ...baseRequest };
    const headers = headersFor(body);
    const accepted = await service.accept(body, headers);
    expect(accepted).toMatchObject({ actionId: 'action-1', status: 'pending' });
    await service.waitForIdle('action-1');
    expect((await store.get('action-1'))?.status).toBe('indexer_pending');
    expect(await service.getReceipt('action-1')).toBeNull();

    resolver.resolve.mockResolvedValue(receipt);
    await expect(service.getReceipt('action-1')).resolves.toEqual(receipt);
    expect(await store.get('action-1')).toMatchObject({
      status: 'confirmed',
      transitions: [
        'authorized',
        'validated',
        'dust_reserved',
        'finalized',
        'submitted',
        'indexer_pending',
        'confirmed',
      ],
    });
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'tx-1',
        contractAddress: 'contract-1',
        circuit: 'castVote',
      }),
    );
  });

  it('submits a concurrent duplicate at most once and keeps its DUST lease exclusive', async () => {
    const executor = {
      balanceAndFinalize: vi.fn(async (tx: string) => `finalized-${tx}`),
      submit: vi.fn(async () => 'tx-1'),
    };
    const { service, store } = makeService(undefined, executor);
    const body = { ...baseRequest };
    const headers = headersFor(body);
    const [first, duplicate] = await Promise.all([
      service.accept(body, headers),
      service.accept(body, headers),
    ]);
    expect(first.actionId).toBe('action-1');
    expect(duplicate.actionId).toBe('action-1');
    await service.waitForIdle('action-1');
    expect(executor.balanceAndFinalize).toHaveBeenCalledTimes(1);
    expect(executor.submit).toHaveBeenCalledTimes(1);
    expect((await store.get('action-1'))?.status).toBe('indexer_pending');

    const secondBody = { ...baseRequest, actionId: 'action-2', tx: baseRequest.tx };
    const secondHeaders = headersFor({ ...secondBody, idempotencyKey: 'request-2' });
    await expect(service.accept(secondBody, secondHeaders)).resolves.toMatchObject({
      actionId: 'action-1',
      status: 'pending',
    });
    expect(executor.submit).toHaveBeenCalledTimes(1);
  });

  it('marks a node response with a different deterministic id as a safe failure', async () => {
    const executor = {
      balanceAndFinalize: vi.fn(async () => 'finalized-aabbcc'),
      submit: vi.fn(async () => 'node-id'),
      transactionId: vi.fn(() => 'derived-id'),
    };
    const { service, store } = makeService(undefined, executor);
    const body = { ...baseRequest };
    await service.accept(body, headersFor(body));
    await service.waitForIdle('action-1');
    expect(await store.get('action-1')).toMatchObject({
      status: 'failed',
      errorCode: 'submission_id_mismatch',
    });
  });

  it('rejects request-hash and allowlist mismatches before wallet work', async () => {
    const executor = {
      balanceAndFinalize: vi.fn(async (tx: string) => tx),
      submit: vi.fn(async () => 'tx-1'),
    };
    const { service } = makeService(undefined, executor);
    const body = { ...baseRequest };
    const headers = headersFor(body);
    await expect(
      service.accept({ ...body, requestHash: 'f'.repeat(64) }, headers),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    const unsupported = { ...body, contractAddress: 'other-contract' };
    await expect(service.accept(unsupported, headersFor(unsupported))).rejects.toMatchObject({
      code: 'not_allowlisted',
    });
    expect(executor.balanceAndFinalize).not.toHaveBeenCalled();
  });

  it('recovers an already-submitted job after restart without resubmitting', async () => {
    const store = new InMemoryV2ActionStore();
    const input = {
      id: 'action-restart',
      actionId: 'action-restart',
      idempotencyKey: 'request-restart',
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
      transactionId: 'tx-restart',
    });
    const receipt = {
      status: 'confirmed' as const,
      action: 'vote' as const,
      network: 'preview' as const,
      transactionId: 'tx-restart',
      transactionHash: 'hash-restart',
      contractAddress: 'contract-1',
      circuit: 'castVote',
      blockHeight: 8,
      blockHash: 'block-restart',
      blockTimestamp: '2026-01-01T00:00:00.000Z',
    };
    const executor = {
      balanceAndFinalize: vi.fn(),
      submit: vi.fn(),
    };
    const resolver = { resolve: vi.fn(async () => receipt) };
    const { service } = makeService(store, executor, resolver);
    await service.start();
    await expect(service.getReceipt(input.id)).resolves.toEqual(receipt);
    expect(executor.balanceAndFinalize).not.toHaveBeenCalled();
    expect(executor.submit).not.toHaveBeenCalled();
  });
});

describe('spreading submissions in time', () => {
  function delayedService(random: () => number, submitDelayMaxMs = 20_000) {
    const executor: V2RelayerExecutor = {
      balanceAndFinalize: vi.fn(async (tx) => `finalized-${tx}`),
      submit: vi.fn(async () => 'tx-1'),
    };
    const store = new InMemoryV2ActionStore();
    const service = new V2ActionService({
      store,
      executor,
      receiptResolver: { resolve: vi.fn(async () => null) },
      allowedNetworks: ['preview'],
      allowedContracts: ['contract-1'],
      allowedCircuits: ['castVote', 'revealVote'],
      capabilitySecret: secret,
      confirmationRetryMs: 60_000,
      idFactory: () => 'reservation',
      submitDelayMaxMs,
      random,
    });
    return { service, store, executor };
  }

  it('holds a new action for a random wait before it reaches the wallet', async () => {
    vi.useFakeTimers();
    try {
      const { service, store, executor } = delayedService(() => 0.5);
      const body = { ...baseRequest };
      const accepted = await service.accept(body, headersFor(body));
      expect(accepted.status).toBe('pending');

      await vi.advanceTimersByTimeAsync(9_999);
      expect(executor.balanceAndFinalize).not.toHaveBeenCalled();
      expect((await store.get('action-1'))?.status).toBe('authorized');

      await vi.advanceTimersByTimeAsync(2);
      await service.waitForIdle('action-1');
      expect(executor.submit).toHaveBeenCalledOnce();
      expect((await store.get('action-1'))?.status).toBe('indexer_pending');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a retry skip the wait or start a second one', async () => {
    vi.useFakeTimers();
    try {
      const { service, executor } = delayedService(() => 0.5);
      const body = { ...baseRequest };
      const headers = headersFor(body);
      await service.accept(body, headers);
      await vi.advanceTimersByTimeAsync(5_000);
      await service.accept(body, headers);
      expect(executor.balanceAndFinalize).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_001);
      await service.waitForIdle('action-1');
      expect(executor.balanceAndFinalize).toHaveBeenCalledOnce();
      expect(executor.submit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['the lowest sample', 0, 0],
    ['the highest sample', 0.999_999, 20_000],
    ['a sample above the range', 7, 20_000],
    ['a sample below the range', -3, 0],
    ['a sample that is not a number', Number.NaN, 0],
  ])('keeps the wait inside its bound for %s', async (_label, sample, expectedMs) => {
    vi.useFakeTimers();
    try {
      const { service, executor } = delayedService(() => sample);
      const body = { ...baseRequest };
      await service.accept(body, headersFor(body));
      if (expectedMs > 0) {
        await vi.advanceTimersByTimeAsync(expectedMs - 1);
        expect(executor.balanceAndFinalize).not.toHaveBeenCalled();
      }
      await vi.advanceTimersByTimeAsync(1);
      await service.waitForIdle('action-1');
      expect(executor.submit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('submits at once when no wait is configured, and refuses a negative one', async () => {
    const { service, executor } = delayedService(() => 0.9, 0);
    const body = { ...baseRequest };
    await service.accept(body, headersFor(body));
    await service.waitForIdle('action-1');
    expect(executor.submit).toHaveBeenCalledOnce();

    expect(() => delayedService(() => 0, -1)).toThrow(/non-negative whole number/u);
    expect(() => delayedService(() => 0, 1.5)).toThrow(/non-negative whole number/u);
  });

  it('carries the count for a citizen and still refuses an organizer circuit', async () => {
    const { service, executor } = delayedService(() => 0, 0);
    const count = { ...baseRequest, actionId: 'action-count', circuit: 'revealVote' };
    const accepted = await service.accept(count, {
      ...headersFor({ ...count, idempotencyKey: 'request-count' }),
    });
    expect(accepted).toMatchObject({ actionId: 'action-count', status: 'pending' });
    await service.waitForIdle('action-count');
    expect(executor.submit).toHaveBeenCalledOnce();

    const close = { ...baseRequest, actionId: 'action-close', circuit: 'closeVote' };
    await expect(
      service.accept(close, headersFor({ ...close, idempotencyKey: 'request-close' })),
    ).rejects.toMatchObject({ code: 'not_allowlisted' });
  });
});
