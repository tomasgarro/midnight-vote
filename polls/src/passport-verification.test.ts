import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { afterEach, describe, expect, it } from 'vitest';
import { PassportVerificationStore } from './passport-store.js';
import { hashBrowserToken, PassportVerification } from './passport-verification.js';

const NOW = Date.parse('2026-11-09T18:00:00Z');
const ORIGIN = 'https://midnight.vote';
const browserHash = hashBrowserToken('a secret HttpOnly browser token');
const request = { account: 'victim-account', network: 'stagenet', purpose: 'organizer' };
const stores: PassportVerificationStore[] = [];
const directories: string[] = [];
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/** Real attacker BIP340 keys. These have no relationship to the claimed account. */
function signedReply(
  state: string,
  overrides: Record<string, unknown> = {},
  key = randomBytes(32),
) {
  const payload = Buffer.from(
    JSON.stringify({
      protocol: 'org.midnight.passport.callback/v1',
      type: 'passport.callback.profile',
      version: 1,
      audience: ORIGIN,
      state,
      issuedAt: NOW,
      nonce: randomBytes(24).toString('hex'),
      fields: ['passportContract'],
      profile: { passportContract: { address: request.account, network: request.network } },
      ...overrides,
    }),
  );
  return {
    protocol: 'org.midnight.passport.callback/v1',
    type: 'passport.callback.response',
    scheme: 'bip340-schnorr-secp256k1-sha256',
    payload: payload.toString('base64url'),
    publicKey: hex(schnorr.getPublicKey(key)),
    signature: hex(schnorr.sign(sha256(payload), key)),
  };
}
function setup(path = ':memory:', now = () => NOW) {
  const store = new PassportVerificationStore(path);
  stores.push(store);
  return { store, verifier: new PassportVerification(store, ORIGIN, now) };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('server-side Midnight Passport response verification', () => {
  it('checks a real signature but refuses attacker-signed claims of victim account authority', () => {
    const { verifier } = setup();
    const flow = verifier.start(request, browserHash);
    const launch = new URL(flow.launchUrl);
    expect(launch.origin).toBe('https://midnightpassport.com');
    expect(launch.searchParams.get('passportCallback')).toBe(`${ORIGIN}/passport-callback`);
    expect(launch.searchParams.get('passportState')).toBe(flow.state);
    const report = verifier.verify(flow.challengeId, browserHash, signedReply(flow.state));
    expect(report).toMatchObject({
      responseSignature: 'verified',
      requestBinding: 'verified',
      accountControl: 'unavailable',
      networkCompatibility: 'mismatch',
      authorized: false,
    });
    expect(JSON.stringify(report)).not.toContain('victim-account');
    expect(report.blockers).toHaveLength(2);
  });
  it('does not grant authority even when a signed claim names Preview', () => {
    const { verifier } = setup();
    const flow = verifier.start({ ...request, network: 'preview' }, browserHash);
    const report = verifier.verify(
      flow.challengeId,
      browserHash,
      signedReply(flow.state, {
        profile: { passportContract: { address: request.account, network: 'preview' } },
      }),
    );
    expect(report.networkCompatibility).toBe('matches');
    expect(report.authorized).toBe(false);
  });
  it('supports tagged Ledger 9 signature encoding through the official parser', () => {
    const { verifier } = setup();
    const flow = verifier.start(request, browserHash);
    const proof = signedReply(flow.state);
    expect(
      verifier.verify(flow.challengeId, browserHash, {
        ...proof,
        publicKey: `schnorr:${proof.publicKey}`,
        signature: `schnorr:${proof.signature}`,
      }).responseSignature,
    ).toBe('verified');
  });
  it.each([
    ['wrong origin', { audience: 'https://attacker.example' }],
    ['wrong request', { state: 'a state selected by the attacker' }],
    ['future response', { issuedAt: NOW + 60_001 }],
    ['stale response', { issuedAt: NOW - 300_001 }],
    ['other account', { profile: { passportContract: { address: 'other', network: 'stagenet' } } }],
    [
      'other network',
      { profile: { passportContract: { address: request.account, network: 'preview' } } },
    ],
    ['no account consent', { fields: [], profile: {} }],
    ['payment response', { type: 'passport.callback.tx' }],
  ])('rejects a correctly signed %s and burns its request', (_, overrides) => {
    const { verifier } = setup();
    const flow = verifier.start(request, browserHash);
    expect(() =>
      verifier.verify(flow.challengeId, browserHash, signedReply(flow.state, overrides)),
    ).toThrow();
    expect(() => verifier.verify(flow.challengeId, browserHash, signedReply(flow.state))).toThrow(
      'expired, already used',
    );
  });
  it.each(['unsigned', 'bad signature', 'wrong scheme', 'malformed key', 'changed payload'])(
    '%s never verifies',
    (kind) => {
      const { verifier } = setup();
      const flow = verifier.start(request, browserHash);
      const reply = signedReply(flow.state);
      const proof = {
        ...reply,
        ...(kind === 'unsigned' ? { scheme: 'none' } : {}),
        ...(kind === 'bad signature' ? { signature: '0'.repeat(128) } : {}),
        ...(kind === 'wrong scheme' ? { scheme: 'ecdsa' } : {}),
        ...(kind === 'malformed key' ? { publicKey: 'not-a-key' } : {}),
        ...(kind === 'changed payload' ? { payload: Buffer.from('{}').toString('base64url') } : {}),
      };
      expect(() => verifier.verify(flow.challengeId, browserHash, proof)).toThrow();
    },
  );
  it('requires the initiating browser and leaves its request usable after a different browser tries', () => {
    const { verifier } = setup();
    const flow = verifier.start(request, browserHash);
    expect(() =>
      verifier.verify(flow.challengeId, 'other-browser', signedReply(flow.state)),
    ).toThrow();
    expect(verifier.verify(flow.challengeId, browserHash, signedReply(flow.state)).authorized).toBe(
      false,
    );
  });
  it('expires requests and binds the poll and purpose inside the signed state', () => {
    let now = NOW;
    const { verifier } = setup(':memory:', () => now);
    const organizer = verifier.start(request, browserHash);
    const vote = verifier.start({ ...request, purpose: 'vote', pollId: 'community' }, browserHash);
    expect(organizer.state).not.toBe(vote.state);
    expect(() =>
      verifier.verify(vote.challengeId, browserHash, signedReply(organizer.state)),
    ).toThrow();
    now += 300_000;
    expect(() =>
      verifier.verify(organizer.challengeId, browserHash, signedReply(organizer.state)),
    ).toThrow();
  });
  it('limits outstanding work and rejects invalid networks and poll scopes', () => {
    const { verifier } = setup();
    for (const invalid of [
      { ...request, network: 'mainnet' },
      { ...request, purpose: 'vote' },
      { ...request, purpose: 'vote', pollId: '../other' },
      { ...request, pollId: 'unexpected' },
    ])
      expect(() => verifier.start(invalid, browserHash)).toThrow();
    for (let i = 0; i < 5; i++) verifier.start(request, browserHash);
    expect(() => verifier.start(request, browserHash)).toThrow('Too many');
  });
});

describe('durable and atomic verification storage', () => {
  function database() {
    const directory = mkdtempSync(join(tmpdir(), 'midnight-vote-auth-'));
    directories.push(directory);
    return join(directory, 'requests.sqlite');
  }
  it('preserves outstanding requests and replay history through service restart', () => {
    const path = database();
    const first = setup(path);
    const flow = first.verifier.start(request, browserHash);
    const key = randomBytes(32);
    const nonce = randomBytes(24).toString('hex');
    first.store.close();
    stores.splice(stores.indexOf(first.store), 1);
    const second = setup(path);
    second.verifier.verify(flow.challengeId, browserHash, signedReply(flow.state, { nonce }, key));
    second.store.close();
    stores.splice(stores.indexOf(second.store), 1);
    const third = setup(path);
    expect(() =>
      third.verifier.verify(flow.challengeId, browserHash, signedReply(flow.state)),
    ).toThrow();
    const retry = third.verifier.start(request, browserHash);
    expect(() =>
      third.verifier.verify(
        retry.challengeId,
        browserHash,
        signedReply(retry.state, { nonce }, key),
      ),
    ).toThrow('already used');
  });
  it('allows only one consumer across independent SQLite connections', () => {
    const path = database();
    const first = setup(path);
    const second = setup(path);
    const flow = first.verifier.start(request, browserHash);
    first.verifier.verify(flow.challengeId, browserHash, signedReply(flow.state));
    expect(() =>
      second.verifier.verify(flow.challengeId, browserHash, signedReply(flow.state)),
    ).toThrow();
    expect(first.store.claimNonce('shared-nonce', NOW + 300_000)).toBe(true);
    expect(second.store.claimNonce('shared-nonce', NOW + 300_000)).toBe(false);
  });
  it('normalizes tagged uppercase keys before recording nonce identity', () => {
    const { verifier } = setup();
    const key = randomBytes(32);
    const nonce = randomBytes(24).toString('hex');
    const first = verifier.start(request, browserHash);
    verifier.verify(first.challengeId, browserHash, signedReply(first.state, { nonce }, key));
    const second = verifier.start(request, browserHash);
    const reply = signedReply(second.state, { nonce }, key);
    expect(() =>
      verifier.verify(second.challengeId, browserHash, {
        ...reply,
        publicKey: `schnorr:${reply.publicKey.toUpperCase()}`,
      }),
    ).toThrow('already used');
  });
  it('prunes expired request and nonce records without removing current requests', () => {
    const { verifier, store } = setup();
    const flow = verifier.start(request, browserHash);
    expect(store.claimNonce('expired-nonce', NOW - 1)).toBe(true);
    store.prune(NOW);
    expect(store.claimNonce('expired-nonce', NOW + 10)).toBe(true);
    expect(verifier.verify(flow.challengeId, browserHash, signedReply(flow.state)).authorized).toBe(
      false,
    );
    const expired = verifier.start(request, browserHash);
    store.prune(NOW + 300_000);
    expect(store.take(expired.challengeId, browserHash, NOW)).toBeNull();
  });
});
