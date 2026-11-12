import { createPassport, type Passport } from '@midnight-passport/connect';
import {
  buildPassportLaunchUrl,
  createPassportNonceLedger,
  newPassportState,
  type PassportCallbackEnvelope,
  readPassportCallback,
  rememberPassportState,
  takePassportState,
  verifyPassportCallbackReply,
} from '@midnight-passport/connect/redirect';
import type { PassportVerificationReport } from 'midnight-vote-polls';

const ORIGIN = 'https://midnightpassport.com';
const STATE_KEY = 'midnight-vote/restart';
const VERIFICATION_KEY = 'midnight.vote/passport-verification-request';
const NETWORK = 'stagenet';
export interface MidnightPassportConnection {
  displayName?: string;
  account?: { address: string; network: string };
  transport: 'profile-consent' | 'signed-redirect';
  accountControl: 'unavailable';
}

function connection(
  profile: { displayName?: string; passportContract?: { address: string; network: string } },
  transport: MidnightPassportConnection['transport'],
): MidnightPassportConnection {
  if (profile.passportContract && profile.passportContract.network !== NETWORK)
    throw new Error(
      `Midnight Passport returned an account on ${profile.passportContract.network}; this integration expects ${NETWORK}.`,
    );
  return {
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.passportContract ? { account: { ...profile.passportContract } } : {}),
    transport,
    accountControl: 'unavailable',
  };
}

export class MidnightPassportClient {
  private client: Passport | null = null;
  private generation = 0;
  private cancelPending: (() => void) | null = null;
  private verificationRequest: AbortController | null = null;
  private pendingProof: { challengeId: string; envelope: PassportCallbackEnvelope } | null = null;
  async connect(): Promise<MidnightPassportConnection> {
    assertRelyingPartyOrigin();
    this.cancel();
    const generation = this.generation;
    this.client = createPassport({ origin: ORIGIN, transport: 'auto', timeoutMs: 180_000 });
    const current = this.client;
    try {
      const result = await new Promise<Awaited<ReturnType<Passport['requestProfile']>>>(
        (resolve, reject) => {
          this.cancelPending = () => reject(new Error('Midnight Passport connection cancelled.'));
          current.requestProfile(['displayName', 'passportContract']).then(resolve, reject);
        },
      );
      if (generation !== this.generation)
        throw new Error('Midnight Passport connection cancelled.');
      if (!result.approved) throw new Error(result.message);
      return connection(result.profile, 'profile-consent');
    } finally {
      if (generation === this.generation) this.cancelPending = null;
    }
  }
  cancel(): void {
    this.generation++;
    const cancel = this.cancelPending;
    this.cancelPending = null;
    cancel?.();
    this.client?.destroy();
    this.client = null;
    this.verificationRequest?.abort();
    this.verificationRequest = null;
    this.pendingProof = null;
    try {
      sessionStorage.removeItem(VERIFICATION_KEY);
    } catch {
      // Profile consent still works when persistent browser storage is unavailable.
    }
  }
  /** A diagnostic signed response cannot issue a voting or organizer session. */
  async verifyAccount(account: { address: string; network: string }): Promise<void> {
    assertRelyingPartyOrigin();
    this.cancel();
    const request = new AbortController();
    this.verificationRequest = request;
    let response: Response;
    try {
      response = await fetch('/api/polls/passport/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: account.address,
          network: account.network,
          purpose: 'connect',
        }),
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) throw new Error('Account verification cancelled.');
      throw new Error(
        'The account-verification service is unavailable. Your profile is still connected.',
      );
    }
    if (!response.ok)
      throw new Error('The account-verification service could not start this request.');
    const flow: unknown = await response.json();
    if (!flow || typeof flow !== 'object')
      throw new Error('Invalid account-verification response.');
    const value = flow as Record<string, unknown>;
    if (
      typeof value.challengeId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.challengeId) ||
      typeof value.state !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.state) ||
      typeof value.launchUrl !== 'string' ||
      typeof value.expiresAt !== 'number' ||
      value.expiresAt <= Date.now()
    )
      throw new Error('Invalid account-verification response.');
    const url = new URL(value.launchUrl);
    if (
      url.origin !== ORIGIN ||
      url.pathname !== '/' ||
      url.searchParams.get('passportCallback') !==
        new URL('/passport-callback', location.origin).href ||
      url.searchParams.get('passportState') !== value.state ||
      url.searchParams.get('passportFields') !== 'passportContract'
    )
      throw new Error('The account-verification launch target is invalid.');
    if (request.signal.aborted) throw new Error('Account verification cancelled.');
    // Fail before navigation if the browser cannot persist the request across the redirect.
    sessionStorage.setItem(
      VERIFICATION_KEY,
      JSON.stringify({ challengeId: value.challengeId, state: value.state }),
    );
    rememberPassportState(STATE_KEY, value.state);
    location.assign(url.href);
  }

  async verifyCallbackOnServer(): Promise<PassportVerificationReport | null> {
    const proof = this.pendingProof;
    this.pendingProof = null;
    if (!proof) return null;
    const request = new AbortController();
    this.verificationRequest = request;
    let response: Response;
    try {
      response = await fetch('/api/polls/passport/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
        signal: request.signal,
      });
    } catch {
      throw new Error(
        'The account-verification service is unavailable. No account authority was granted.',
      );
    }
    if (!response.ok)
      throw new Error(
        'The server could not verify this Midnight Passport response. Connect again.',
      );
    const value = await response.json();
    const report = value?.report;
    if (
      report?.kind !== 'midnight.vote/passport-verification/v1' ||
      report.responseSignature !== 'verified' ||
      report.requestBinding !== 'verified' ||
      report.accountClaim !== 'matches-request' ||
      report.accountControl !== 'unavailable' ||
      report.authorized !== false ||
      !['preview', 'stagenet'].includes(report.accountNetwork) ||
      report.votingNetwork !== 'preview' ||
      report.networkCompatibility !==
        (report.accountNetwork === 'preview' ? 'matches' : 'mismatch') ||
      !Array.isArray(report.blockers) ||
      report.blockers.some((item: unknown) => typeof item !== 'string')
    )
      throw new Error('Invalid account-verification result. No account authority was granted.');
    if (request.signal.aborted) throw new Error('Account verification cancelled.');
    return report as PassportVerificationReport;
  }
  redirect(): void {
    assertRelyingPartyOrigin();
    this.cancel();
    const state = newPassportState();
    rememberPassportState(STATE_KEY, state);
    // A dedicated callback avoids leaking unrelated application fragments into the exchange.
    const callbackUrl = new URL('/passport-callback', location.origin).href;
    location.assign(
      buildPassportLaunchUrl({
        passportOrigin: ORIGIN,
        callbackUrl,
        fields: ['displayName', 'passportContract'],
        state,
      }),
    );
  }
  callback(): MidnightPassportConnection | null {
    this.pendingProof = null;
    const returned = readPassportCallback();
    const expectedState = takePassportState(STATE_KEY);
    const pending = sessionStorage.getItem(VERIFICATION_KEY);
    sessionStorage.removeItem(VERIFICATION_KEY);
    if (returned.kind === 'absent') return null;
    if (returned.kind === 'malformed') throw new Error(returned.reason);
    if (returned.kind === 'error')
      throw new Error('Midnight Passport did not complete the connection. Try connecting again.');
    if (!expectedState)
      throw new Error('This Midnight Passport response has no matching connection request.');
    const ledger = createPassportNonceLedger({ key: 'midnight-vote/restart-nonces' });
    const verdict = verifyPassportCallbackReply(returned.envelope, {
      expectedAudience: location.origin,
      expectedState,
      requireSignature: true,
      seenNonce: (nonce) => ledger.seen(nonce),
      maxAgeMs: 300_000,
    });
    if (!verdict.ok)
      throw new Error(`Midnight Passport redirect could not be verified: ${verdict.reason}`);
    ledger.record(verdict.payload.nonce);
    if (pending) {
      const request: unknown = JSON.parse(pending);
      if (
        !request ||
        typeof request !== 'object' ||
        !('challengeId' in request) ||
        typeof request.challengeId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(request.challengeId) ||
        !('state' in request) ||
        request.state !== expectedState
      )
        throw new Error(
          'This Midnight Passport reply does not match the server verification request.',
        );
      this.pendingProof = { challengeId: request.challengeId, envelope: returned.envelope };
    }
    return connection(verdict.payload.profile, 'signed-redirect');
  }
}

function assertRelyingPartyOrigin(): void {
  if (
    location.protocol !== 'https:' &&
    !(location.protocol === 'http:' && location.hostname === 'localhost')
  )
    throw new Error('Midnight Passport needs HTTPS or localhost.');
}
