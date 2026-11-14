import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createPollServer } from './server.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});
describe('live API authority boundary', () => {
  it('binds signed responses to the initiating browser and never turns them into sessions', async () => {
    server = createPollServer('https://midnight.vote');
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { origin: 'https://midnight.vote', 'content-type': 'application/json' };
    const post = (path: string, body: unknown, cookie?: string) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { ...headers, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const started = await post('/api/polls/passport/start', {
      account: 'victim',
      network: 'stagenet',
      purpose: 'connect',
    });
    expect(started.status).toBe(200);
    const cookieHeader = started.headers.get('set-cookie') ?? '';
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).toContain('; Secure');
    expect(cookieHeader.startsWith('__Host-')).toBe(true);
    expect(cookieHeader).toContain('Path=/;');
    const cookie = cookieHeader.split(';')[0];
    const flow = await started.json();
    const key = randomBytes(32);
    const payload = Buffer.from(
      JSON.stringify({
        protocol: 'org.midnight.passport.callback/v1',
        type: 'passport.callback.profile',
        version: 1,
        audience: 'https://midnight.vote',
        state: flow.state,
        issuedAt: Date.now(),
        nonce: randomBytes(24).toString('hex'),
        fields: ['passportContract'],
        profile: { passportContract: { address: 'victim', network: 'stagenet' } },
      }),
    );
    const body = {
      challengeId: flow.challengeId,
      envelope: {
        protocol: 'org.midnight.passport.callback/v1',
        type: 'passport.callback.response',
        scheme: 'bip340-schnorr-secp256k1-sha256',
        payload: payload.toString('base64url'),
        publicKey: Buffer.from(schnorr.getPublicKey(key)).toString('hex'),
        signature: Buffer.from(schnorr.sign(sha256(payload), key)).toString('hex'),
      },
    };
    expect((await post('/api/polls/passport/verify', body)).status).toBe(403);
    expect(
      (
        await post(
          '/api/polls/passport/verify',
          body,
          `__Host-mv_passport_verification=${'0'.repeat(64)}`,
        )
      ).status,
    ).toBe(403);
    const result = await post('/api/polls/passport/verify', body, cookie);
    expect(result.status).toBe(200);
    expect((await result.json()).report).toMatchObject({
      responseSignature: 'verified',
      authorized: false,
    });
    expect(result.headers.get('set-cookie')).toBeNull();
    expect((await post('/api/polls/passport/verify', body, cookie)).status).toBe(403);
    expect(
      (
        await post(
          '/api/polls/sessions',
          { challengeId: flow.challengeId, proof: body.envelope },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect((await post('/api/polls/ballots', {}, cookie)).status).toBe(503);
    const readiness = await (await fetch(`${base}/api/polls/readiness`)).json();
    expect(readiness.pilotReady).toBe(false);
    expect(readiness.gates.some((gate: { owner: string }) => gate.owner === 'upstream')).toBe(true);
    expect(readiness.gates.some((gate: { owner: string }) => gate.owner === 'midnight.vote')).toBe(
      true,
    );
  });
  it('refuses forged organizer sessions, browser-origin substitution, and all live writes', async () => {
    server = createPollServer('https://midnight.vote');
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { origin: 'https://midnight.vote', 'content-type': 'application/json' };
    const status = await (await fetch(`${base}/api/polls/capabilities`)).json();
    expect(status.capabilities.accountControl).toBe(false);
    const challengeResponse = await fetch(`${base}/api/polls/challenges`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ account: 'claimed', network: 'stagenet', purpose: 'organizer' }),
    });
    const { challenge } = await challengeResponse.json();
    expect(challenge.origin).toBe('https://midnight.vote');
    expect(
      (
        await fetch(`${base}/api/polls/sessions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            challengeId: challenge.id,
            proof: { profile: 'claimed', signature: 'unbound' },
          }),
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${base}/api/polls`, { method: 'POST', headers, body: '{}' })).status).toBe(
      503,
    );
    expect(
      (
        await fetch(`${base}/api/polls`, {
          method: 'POST',
          headers: { ...headers, origin: 'https://attacker.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
  });
});
