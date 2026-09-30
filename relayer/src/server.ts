import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  MidnightBech32m,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { loadConfig, type RelayerConfig } from './config.js';
import { evaluateRelayerReadiness } from './readiness.js';
import { handleV2Route } from './v2-http.js';
import { MidnightIndexerReceiptResolver } from './v2-indexer.js';
import { createConfiguredV2Store } from './v2-runtime.js';
import { V2ActionService } from './v2-service.js';
import {
  balanceAndFinalize,
  deserializeFinalized,
  deserializeUnbound,
  type RelayerWallet,
  serializeFinalized,
  startRelayerWallet,
} from './wallet.js';

/**
 * Sponsored relayer for the referendum.
 *
 * The browser proves `castVote` locally and posts the proven transaction here.
 * This process balances it with its own DUST and submits it, so a citizen
 * needs no wallet, no extension and no funds.
 *
 * TRUST BOUNDARY. The relayer sees the proven transaction, which carries the
 * nullifier and the ballot commitment, plus the caller's IP. It cannot read
 * the choice — that stays sealed until reveal — and cannot tell which
 * eligibility leaf was used, because membership is proved in zero knowledge.
 * It can decline to submit, which is a liveness risk, not a privacy one.
 *
 * It binds to loopback by default. Do not expose it publicly without adding
 * authentication and rate limiting.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;

type Json = Record<string, unknown>;

/**
 * Addresses and keys are objects, not strings — `String(x)` yields
 * "[object Object]". The DApp Connector hands the SDK Bech32m text, so the
 * relayer must produce exactly that or `getCoinPublicKey()` feeds garbage into
 * every transaction.
 */
function bech32(networkId: string, item: unknown): string {
  return MidnightBech32m.encode(networkId, item as never).asString();
}

/**
 * Addresses carry an instance-level codec, but the bare coin and encryption
 * public keys expose only a static one, so they cannot go through
 * `MidnightBech32m.encode` and need their class codec named explicitly.
 */
function bech32CoinKey(networkId: string, key: unknown): string {
  return ShieldedCoinPublicKey.codec.encode(networkId, key as ShieldedCoinPublicKey).asString();
}

function bech32EncryptionKey(networkId: string, key: unknown): string {
  return ShieldedEncryptionPublicKey.codec
    .encode(networkId, key as ShieldedEncryptionPublicKey)
    .asString();
}

function send(response: ServerResponse, status: number, body: Json): void {
  // Balances and sync progress carry BigInts, which JSON.stringify throws on.
  const payload = JSON.stringify(body, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function applyCors(
  config: RelayerConfig,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!config.allowedOrigins.includes(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader(
    'access-control-allow-headers',
    'content-type, authorization, idempotency-key, x-request-hash, x-action-capability',
  );
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('vary', 'origin');
  return true;
}

async function readJson(request: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
}

function hexField(body: Json, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`"${field}" must be a hex-encoded transaction`);
  }
  return value.toLowerCase();
}

/** Serialises relayer work: two concurrent balances would pick the same coins. */
function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return async function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  console.log(`[relayer] network=${config.networkId} indexer=${config.indexerHttpUrl}`);
  console.log('[relayer] starting wallet and syncing — this can take a few minutes…');

  let wallet: RelayerWallet;
  try {
    wallet = await startRelayerWallet(config);
  } catch (error) {
    console.error('[relayer] wallet failed to start:', (error as Error).message);
    process.exitCode = 1;
    return;
  }

  const enqueue = createQueue();

  // Keep the newest state as it streams in. `waitForSyncedState()` blocks
  // until a full sync from genesis, which on a fresh wallet can take many
  // minutes — a status endpoint that hangs for that long is useless precisely
  // when you need it to tell you what is going on.
  let latest: Awaited<ReturnType<typeof wallet.facade.waitForSyncedState>> | null = null;
  wallet.facade.state().subscribe({
    next: (state) => {
      latest = state;
    },
    error: (error: unknown) => console.error('[relayer] state stream error:', error),
  });

  let v2Service: V2ActionService | null = null;
  let closeV2Store: (() => Promise<void>) | undefined;
  if (config.v2CapabilitySecret) {
    try {
      const configured = await createConfiguredV2Store(config);
      closeV2Store = configured.close;
      v2Service = new V2ActionService({
        store: configured.store,
        executor: {
          balanceAndFinalize: async (tx) =>
            serializeFinalized(
              await enqueue(() => balanceAndFinalize(wallet, deserializeUnbound(tx))),
            ),
          submit: (tx) => enqueue(() => wallet.facade.submitTransaction(deserializeFinalized(tx))),
          transactionId: (tx) => {
            try {
              // WalletFacade.submitTransaction() returns the final identifier.
              // Balancing can add identifiers, so using the first one creates a
              // false submission mismatch for the exact transaction submitted.
              return deserializeFinalized(tx).identifiers().at(-1);
            } catch {
              return undefined;
            }
          },
        },
        receiptResolver: new MidnightIndexerReceiptResolver({
          indexerHttpUrl: config.indexerHttpUrl,
          explorerBaseUrl: config.v2ExplorerBaseUrl,
        }),
        allowedNetworks: config.v2AllowedNetworks,
        allowedContracts: config.v2AllowedContracts,
        allowedCircuits: config.v2AllowedCircuits,
        submitDelayMaxMs: config.v2SubmitDelayMaxMs,
        validateTransaction: (tx) => {
          deserializeUnbound(tx);
        },
        capabilitySecret: config.v2CapabilitySecret,
      });
      await v2Service.start();
      console.log(`[relayer] v2 enabled with ${configured.durableKind} action store`);
    } catch (error) {
      console.error('[relayer] v2 store failed to start:', (error as Error).message);
      await wallet.stop().catch(() => undefined);
      await closeV2Store?.().catch(() => undefined);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(
      '[relayer] v2 action routes disabled: RELAYER_V2_CAPABILITY_SECRET is not configured',
    );
  }
  if (config.legacyApiEnabled) {
    console.warn(
      '[relayer] WARNING: compatibility-only /balance and /submit routes are explicitly enabled',
    );
  }

  const server = createServer((request, response) => {
    void (async () => {
      if (!applyCors(config, request, response)) {
        send(response, 403, { error: 'origin_not_allowed' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      try {
        if (
          await handleV2Route(request, response, url, {
            service: v2Service,
            capabilitySecret: config.v2CapabilitySecret,
            serviceAuthToken: config.v2AuthToken,
          })
        ) {
          return;
        }
        if (request.method === 'GET' && url.pathname === '/health') {
          const state = latest;
          if (!state) {
            send(response, 503, { synced: false, detail: 'wallet has not produced a state yet' });
            return;
          }
          const dustAtValue = url.searchParams.get('dustAt');
          const dustAt = dustAtValue === null ? new Date() : new Date(dustAtValue);
          const now = Date.now();
          if (
            Number.isNaN(dustAt.getTime()) ||
            dustAt.getTime() > now ||
            now - dustAt.getTime() > 15 * 60 * 1_000
          ) {
            send(response, 400, { error: 'invalid_dust_evaluation_time' });
            return;
          }
          send(response, 200, {
            synced: state.isSynced,
            networkId: config.networkId,
            v2ActionStore: config.v2DatabaseUrl ? 'postgresql' : 'local-file',
            legacyApiEnabled: config.legacyApiEnabled,
            progress: {
              shielded: state.shielded.progress,
              unshielded: state.unshielded.progress,
              dust: state.dust.progress,
            },
            // Public addresses only. Never any key material.
            unshieldedAddress: bech32(config.networkId, state.unshielded.address),
            shieldedAddress: bech32(config.networkId, state.shielded.address),
            dustAddress: bech32(config.networkId, state.dust.address),
            unshieldedBalances: Object.fromEntries(
              Object.entries(state.unshielded.balances).map(([k, v]) => [k, v.toString()]),
            ),
            dustBalance: state.dust.balance(dustAt).toString(),
            dustEvaluationTime: dustAt.toISOString(),
          });
          return;
        }

        if (request.method === 'GET' && url.pathname === '/ready') {
          const state = latest;
          const dustAtValue = url.searchParams.get('dustAt');
          const dustAt = dustAtValue === null ? new Date() : new Date(dustAtValue);
          const now = Date.now();
          if (
            Number.isNaN(dustAt.getTime()) ||
            dustAt.getTime() > now ||
            now - dustAt.getTime() > 15 * 60 * 1_000
          ) {
            send(response, 400, { error: 'invalid_dust_evaluation_time' });
            return;
          }
          const readiness = evaluateRelayerReadiness({
            state: state
              ? { isSynced: state.isSynced, dustBalance: state.dust.balance(dustAt) }
              : null,
            v2Enabled: Boolean(v2Service),
          });
          send(response, readiness.ready ? 200 : 503, {
            ...readiness,
            networkId: config.networkId,
            dustBalance: state?.dust.balance(dustAt).toString() ?? '0',
            dustEvaluationTime: dustAt.toISOString(),
          });
          return;
        }

        if (request.method === 'GET' && url.pathname === '/keys') {
          // Derived from the seed, so available long before a full sync.
          const state = latest;
          if (!state) {
            send(response, 503, { error: 'wallet_starting' });
            return;
          }
          send(response, 200, {
            coinPublicKey: bech32CoinKey(config.networkId, state.shielded.coinPublicKey),
            encryptionPublicKey: bech32EncryptionKey(
              config.networkId,
              state.shielded.encryptionPublicKey,
            ),
          });
          return;
        }

        if (config.legacyApiEnabled && request.method === 'POST' && url.pathname === '/balance') {
          const body = await readJson(request);
          const hex = hexField(body, 'tx');
          const balanced = await enqueue(() => balanceAndFinalize(wallet, deserializeUnbound(hex)));
          send(response, 200, { tx: serializeFinalized(balanced) });
          return;
        }

        if (config.legacyApiEnabled && request.method === 'POST' && url.pathname === '/submit') {
          const body = await readJson(request);
          const hex = hexField(body, 'tx');
          const txId = await enqueue(() =>
            wallet.facade.submitTransaction(deserializeFinalized(hex)),
          );
          console.log(`[relayer] submitted ${txId}`);
          send(response, 200, { txId });
          return;
        }

        send(response, 404, { error: 'not_found' });
      } catch (error) {
        const message = (error as Error).message ?? 'relayer_error';
        console.error(`[relayer] ${url.pathname} failed:`, message);
        send(response, 500, { error: 'relayer_error', detail: message });
      }
    })();
  });

  server.listen(config.port, config.host, () => {
    console.log(`[relayer] listening on http://${config.host}:${config.port}`);
    console.log(`[relayer] allowed origins: ${config.allowedOrigins.join(', ')}`);
  });

  const shutdown = async () => {
    console.log('\n[relayer] shutting down…');
    server.close();
    await wallet.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

await startServer();
