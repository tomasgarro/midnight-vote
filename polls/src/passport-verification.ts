import { createHash } from 'node:crypto';
import {
  buildPassportLaunchUrl,
  parsePassportCallbackReturn,
  verifyPassportCallbackReply,
} from '@midnight-passport/connect/redirect';
import type { AccountChallenge } from './authority.js';
import { randomToken } from './crypto.js';
import type { PassportVerificationStore } from './passport-store.js';
import type { PassportVerificationReport } from './pilot-readiness.js';

const WINDOW_MS = 300_000;
const CLOCK_SKEW_MS = 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const hashBrowserToken = hash;

/** Every signed state commits to the exact server-held application/account/purpose request. */
export function passportChallengeState(challenge: AccountChallenge): string {
  return hash(
    JSON.stringify([
      'midnight.vote/passport-request/v1',
      challenge.id,
      challenge.nonce,
      challenge.origin,
      challenge.account,
      challenge.network,
      challenge.purpose,
      challenge.pollId ?? null,
      challenge.expiresAt,
    ]),
  );
}

export class PassportVerification {
  constructor(
    private readonly store: PassportVerificationStore,
    private readonly origin: string,
    private readonly now: () => number = Date.now,
  ) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'))
    )
      throw new Error('Passport verification requires an HTTPS origin or localhost.');
  }

  start(input: Record<string, unknown>, browserHash: string) {
    if (
      typeof input.account !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,512}$/.test(input.account) ||
      typeof input.network !== 'string' ||
      !['stagenet', 'preview'].includes(input.network) ||
      typeof input.purpose !== 'string' ||
      !['connect', 'organizer', 'vote'].includes(input.purpose) ||
      (input.purpose === 'vote' &&
        (typeof input.pollId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.pollId))) ||
      (input.purpose !== 'vote' && input.pollId !== undefined)
    )
      throw new Error('Invalid account-verification request.');
    const challenge: AccountChallenge = {
      id: randomToken(),
      nonce: randomToken(),
      origin: this.origin,
      account: input.account,
      network: input.network as 'stagenet' | 'preview',
      purpose: input.purpose as AccountChallenge['purpose'],
      ...(input.purpose === 'vote' ? { pollId: input.pollId as string } : {}),
      expiresAt: this.now() + WINDOW_MS,
    };
    this.store.put(challenge, browserHash, this.now());
    const state = passportChallengeState(challenge);
    return {
      challengeId: challenge.id,
      state,
      expiresAt: challenge.expiresAt,
      launchUrl: buildPassportLaunchUrl({
        passportOrigin: 'https://midnightpassport.com',
        callbackUrl: new URL('/passport-callback', this.origin).href,
        fields: ['passportContract'],
        state,
      }),
    };
  }

  verify(id: string, browserHash: string, envelope: unknown): PassportVerificationReport {
    // Consumed before any cryptography; restart, retry and parallel callbacks cannot reuse it.
    const challenge = this.store.take(id, browserHash, this.now());
    if (!challenge)
      throw new Error('Verification request expired, already used or from another browser.');
    const wire = Buffer.from(JSON.stringify(envelope) ?? '').toString('base64url');
    if (wire.length > 24_000) throw new Error('Midnight Passport response is too large.');
    const parsed = parsePassportCallbackReturn(`#passportResponse=${wire}`);
    if (parsed.kind !== 'response') throw new Error('Malformed Midnight Passport response.');
    const verdict = verifyPassportCallbackReply(parsed.envelope, {
      expectedAudience: challenge.origin,
      expectedState: passportChallengeState(challenge),
      requireSignature: true,
      maxAgeMs: WINDOW_MS,
      now: this.now(),
    });
    if (!verdict.ok || !verdict.signed || !verdict.signerKey)
      throw new Error('Midnight Passport response signature or request binding is invalid.');
    const account = verdict.payload.profile.passportContract;
    if (
      !account ||
      account.address !== challenge.account ||
      account.network !== challenge.network ||
      !verdict.payload.fields.includes('passportContract') ||
      verdict.payload.issuedAt < challenge.expiresAt - WINDOW_MS - CLOCK_SKEW_MS
    )
      throw new Error(
        'Midnight Passport response does not match the requested account and network.',
      );
    const nonceHash = hash(
      JSON.stringify([challenge.origin, verdict.signerKey.toLowerCase(), verdict.payload.nonce]),
    );
    if (!this.store.claimNonce(nonceHash, verdict.payload.issuedAt + WINDOW_MS + CLOCK_SKEW_MS))
      throw new Error('Midnight Passport response was already used.');
    const network = challenge.network as 'stagenet' | 'preview';
    return {
      kind: 'midnight.vote/passport-verification/v1',
      responseSignature: 'verified',
      requestBinding: 'verified',
      accountClaim: 'matches-request',
      accountControl: 'unavailable',
      accountNetwork: network,
      votingNetwork: 'preview',
      networkCompatibility: network === 'preview' ? 'matches' : 'mismatch',
      authorized: false,
      blockers: [
        'The signing wallet key is not proven to be enrolled authority for this Midnight Passport account contract.',
        ...(network === 'preview' ? [] : ['This Stagenet account is not a Preview account.']),
      ],
    };
  }
}
