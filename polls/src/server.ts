import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { AccountAuthorization, UnsupportedAccountControl } from './authority.js';
import { randomToken } from './crypto.js';
import { LIVE_CAPABILITIES, releaseBlockers } from './model.js';
import { PassportVerificationStore } from './passport-store.js';
import { hashBrowserToken, PassportVerification } from './passport-verification.js';
import { PILOT_GATES } from './pilot-readiness.js';

function flowToken(cookie: string | undefined, name: string): string | null {
  const values = (cookie ?? '')
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

/** Live writes are deliberately unavailable until actual Midnight Passport account authority exists. */
export function createPollServer(
  origin = 'http://localhost:4173',
  options: { passportStore?: PassportVerificationStore } = {},
) {
  const authorization = new AccountAuthorization(new UnsupportedAccountControl(), origin);
  const secure = origin.startsWith('https:');
  const flowCookie = secure ? '__Host-mv_passport_verification' : 'mv_passport_verification';
  const store = options.passportStore ?? new PassportVerificationStore(':memory:');
  const passport = new PassportVerification(store, origin);
  store.prune(Date.now());
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Vary', 'Origin');
    const incomingOrigin = request.headers.origin;
    if (incomingOrigin && incomingOrigin !== origin) {
      response.writeHead(403);
      response.end(JSON.stringify({ error: 'origin-refused' }));
      return;
    }
    if (incomingOrigin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.writeHead(204);
      response.end();
      return;
    }
    const send = (status: number, body: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && request.url === '/health') {
      send(200, { status: 'development', liveReady: false });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/polls/capabilities') {
      send(200, { capabilities: LIVE_CAPABILITIES, blockers: releaseBlockers() });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/polls/readiness') {
      send(200, { pilotReady: false, gates: PILOT_GATES });
      return;
    }
    if (
      request.method !== 'POST' ||
      ![
        '/api/polls/challenges',
        '/api/polls/sessions',
        '/api/polls',
        '/api/polls/ballots',
        '/api/polls/passport/start',
        '/api/polls/passport/verify',
      ].includes(request.url ?? '')
    ) {
      send(404, { error: 'not-found' });
      return;
    }
    if (
      !incomingOrigin ||
      request.headers['content-type']?.split(';')[0].trim() !== 'application/json'
    ) {
      send(403, { error: 'origin-and-json-required' });
      return;
    }
    let body: Record<string, unknown>;
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16_384) {
          send(413, { error: 'payload-too-large' });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Object required');
      body = parsed as Record<string, unknown>;
    } catch {
      send(400, { error: 'invalid-json' });
      return;
    }
    if (request.url === '/api/polls/passport/start') {
      const browser = flowToken(request.headers.cookie, flowCookie) ?? randomToken();
      try {
        const flow = passport.start(body, hashBrowserToken(browser));
        response.setHeader(
          'Set-Cookie',
          `${flowCookie}=${browser}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600${secure ? '; Secure' : ''}`,
        );
        send(200, flow);
      } catch {
        send(400, { error: 'invalid-or-excessive-verification-request' });
      }
      return;
    }
    if (request.url === '/api/polls/passport/verify') {
      const browser = flowToken(request.headers.cookie, flowCookie);
      if (!browser || typeof body.challengeId !== 'string') {
        send(403, { error: 'verification-browser-binding-required' });
        return;
      }
      try {
        const report = passport.verify(body.challengeId, hashBrowserToken(browser), body.envelope);
        // A valid wallet signature is diagnostic evidence, never an organizer/voter session.
        send(200, { report });
      } catch {
        send(403, { error: 'passport-response-unverified' });
      }
      return;
    }
    if (request.url === '/api/polls/challenges') {
      try {
        const challenge = authorization.challenge({
          account: String(body.account ?? ''),
          network: String(body.network ?? ''),
          purpose: body.purpose as 'organizer' | 'vote',
          pollId: typeof body.pollId === 'string' ? body.pollId : undefined,
        });
        send(200, { challenge, proofCapability: 'unavailable' });
      } catch {
        send(400, { error: 'invalid-challenge' });
      }
      return;
    }
    if (request.url === '/api/polls/sessions') {
      try {
        await authorization.authorize(String(body.challengeId ?? ''), body.proof);
      } catch {
        send(403, { error: 'account-control-unverified' });
        return;
      }
    }
    send(503, { error: 'live-polls-unavailable', blockers: releaseBlockers() });
  });
  let maintenance: ReturnType<typeof setInterval> | undefined;
  server.once('listening', () => {
    maintenance = setInterval(() => store.prune(Date.now()), 60_000);
    maintenance.unref();
  });
  server.once('close', () => {
    if (maintenance) clearInterval(maintenance);
    if (!options.passportStore) store.close();
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.POLL_PORT ?? 5183);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid POLL_PORT');
  const passportStore = new PassportVerificationStore(
    process.env.POLL_AUTH_DB ?? 'polls/.state/passport-verification.sqlite',
  );
  const server = createPollServer(process.env.POLL_APP_ORIGIN ?? 'http://localhost:4173', {
    passportStore,
  });
  server.once('close', () => passportStore.close());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
  server.listen(port, '127.0.0.1', () =>
    console.log(
      `Development poll API listening on http://127.0.0.1:${port}; live writes are unavailable.`,
    ),
  );
}
