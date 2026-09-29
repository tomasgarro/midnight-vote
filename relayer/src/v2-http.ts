import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { V2ActionService } from './v2-service.js';
import { isCitizenCircuit, V2ActionError } from './v2-types.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
type Json = Record<string, unknown>;

export interface V2HttpRouteOptions {
  readonly service: V2ActionService | null;
  readonly capabilitySecret: string;
  /** Optional additive auth for trusted service-to-service callers. */
  readonly serviceAuthToken?: string;
}

/**
 * Handles the walletless citizen HTTP surface. It is structurally limited to
 * the citizen circuits, `castVote` and `revealVote`, whatever the service
 * allowlist says; operator circuits never cross this public boundary. Returns
 * false for non-v2 paths so explicitly enabled compatibility mode can be
 * handled by the legacy server code.
 */
export async function handleV2Route(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: V2HttpRouteOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith('/v2/')) return false;
  if (!options.capabilitySecret || !options.service) {
    send(response, 503, { error: 'v2_disabled' });
    return true;
  }
  if (!authorizeOptionalServiceToken(request, options.serviceAuthToken ?? '')) {
    send(response, 401, { error: 'unauthorized' });
    return true;
  }

  try {
    const actionMatch = /^\/v2\/actions\/([^/]+)$/u.exec(url.pathname);
    const receiptMatch = /^\/v2\/receipts\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'POST' && url.pathname === '/v2/actions') {
      const body = await readJson(request);
      if (
        !isCitizenCircuit(body.circuit) ||
        (body.action !== undefined && body.action !== 'vote')
      ) {
        send(response, 403, { error: 'not_allowlisted' });
        return true;
      }
      const job = await options.service.accept(body, {
        idempotencyKey: headerValue(request, 'idempotency-key'),
        requestHash: headerValue(request, 'x-request-hash'),
        capability: headerValue(request, 'x-action-capability'),
      });
      send(response, job.status === 'confirmed' ? 200 : 202, job as unknown as Json);
      return true;
    }
    if (request.method === 'GET' && actionMatch?.[1]) {
      const actionId = decode(actionMatch[1]);
      const job = await options.service.get(actionId);
      if (!job) {
        send(response, 404, { error: 'not_found' });
        return true;
      }
      send(response, 200, job as unknown as Json);
      return true;
    }
    if (request.method === 'GET' && receiptMatch?.[1]) {
      const actionId = decode(receiptMatch[1]);
      const job = await options.service.get(actionId);
      if (!job) {
        send(response, 404, { error: 'not_found' });
        return true;
      }
      const receipt = await options.service.getReceipt(actionId);
      if (receipt) {
        send(response, 200, receipt as unknown as Json);
      } else if (job.status === 'failed' || job.status === 'recovery_required') {
        send(response, 409, { error: 'receipt_unavailable', status: job.status });
      } else {
        send(response, 202, {
          actionId,
          status: 'pending',
          ...(job.transactionId ? { transactionId: job.transactionId } : {}),
        });
      }
      return true;
    }
    send(response, 404, { error: 'not_found' });
    return true;
  } catch (error) {
    if (error instanceof V2ActionError) {
      send(response, error.httpStatus, { error: error.code });
    } else if (error instanceof SyntaxError || error instanceof RequestBodyError) {
      send(response, 400, { error: 'invalid_request' });
    } else {
      send(response, 500, { error: 'internal_error' });
    }
    return true;
  }
}

/** Static auth is deliberately optional; capability auth is checked by the service. */
export function authorizeOptionalServiceToken(
  request: IncomingMessage,
  expectedToken: string,
): boolean {
  if (!expectedToken) return true;
  const value = request.headers.authorization;
  if (!value) return true;
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  if (!match?.[1]) return false;
  const provided = Buffer.from(match[1], 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readJson(request: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RequestBodyError('request body is too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new V2ActionError('invalid_request', 'action id is invalid', 400);
  }
}

function send(response: ServerResponse, status: number, body: Json): void {
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

class RequestBodyError extends Error {}
