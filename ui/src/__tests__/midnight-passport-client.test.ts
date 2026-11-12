import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidnightPassportClient } from '../integration/midnight-passport-client';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  destroy: vi.fn(),
  read: vi.fn(),
  take: vi.fn(),
  verify: vi.fn(),
  record: vi.fn(),
}));
vi.mock('@midnight-passport/connect', () => ({
  createPassport: () => ({ requestProfile: mocks.request, destroy: mocks.destroy }),
}));
vi.mock('@midnight-passport/connect/redirect', () => ({
  buildPassportLaunchUrl: vi.fn(),
  newPassportState: vi.fn(),
  rememberPassportState: vi.fn(),
  readPassportCallback: mocks.read,
  takePassportState: mocks.take,
  verifyPassportCallbackReply: mocks.verify,
  createPassportNonceLedger: () => ({ seen: () => false, record: mocks.record }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/#connect');
});
afterEach(() => vi.unstubAllGlobals());
describe('official Midnight Passport connector boundary', () => {
  it('rejects an insecure relying-party origin before opening Midnight Passport', async () => {
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'example.test' });
    await expect(new MidnightPassportClient().connect()).rejects.toThrow('HTTPS or localhost');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('requests only the two supported profile fields and never upgrades consent to account authority', async () => {
    mocks.request.mockResolvedValue({
      approved: true,
      profile: {
        displayName: 'Alex',
        passportContract: { address: 'account', network: 'stagenet' },
      },
    });
    const result = await new MidnightPassportClient().connect();
    expect(mocks.request).toHaveBeenCalledWith(['displayName', 'passportContract']);
    expect(result.account?.network).toBe('stagenet');
    expect(result.accountControl).toBe('unavailable');
  });
  it('preserves partial consent without manufacturing an account', async () => {
    mocks.request.mockResolvedValue({ approved: true, profile: { displayName: 'Alex' } });
    expect((await new MidnightPassportClient().connect()).account).toBeUndefined();
  });
  it('refuses a different account network and surfaces provider refusal', async () => {
    mocks.request.mockResolvedValueOnce({
      approved: true,
      profile: { passportContract: { address: 'account', network: 'mainnet' } },
    });
    await expect(new MidnightPassportClient().connect()).rejects.toThrow('expects stagenet');
    mocks.request.mockResolvedValueOnce({ approved: false, message: 'The person declined.' });
    await expect(new MidnightPassportClient().connect()).rejects.toThrow('declined');
  });
  it('ignores a late response after cancellation', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.request.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const client = new MidnightPassportClient();
    const waiting = client.connect();
    client.cancel();
    resolve({ approved: true, profile: { displayName: 'Late' } });
    await expect(waiting).rejects.toThrow('cancelled');
  });
  it('refuses a signed redirect without a locally outstanding request', () => {
    mocks.read.mockReturnValue({ kind: 'response', envelope: {} });
    mocks.take.mockReturnValue(null);
    expect(() => new MidnightPassportClient().callback()).toThrow('no matching');
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('requires audience/state/freshness/signature verification but keeps account control unavailable', () => {
    mocks.read.mockReturnValue({ kind: 'response', envelope: { payload: 'signed' } });
    mocks.take.mockReturnValue('state');
    mocks.verify.mockReturnValue({
      ok: true,
      payload: {
        nonce: 'nonce',
        profile: { passportContract: { address: 'account', network: 'stagenet' } },
      },
    });
    const result = new MidnightPassportClient().callback();
    expect(mocks.verify.mock.calls[0]?.[1]).toMatchObject({
      expectedAudience: window.location.origin,
      expectedState: 'state',
      requireSignature: true,
      maxAgeMs: 300_000,
    });
    expect(mocks.record).toHaveBeenCalledWith('nonce');
    expect(result?.transport).toBe('signed-redirect');
    expect(result?.accountControl).toBe('unavailable');
  });

  it.each(['origin', 'callback', 'state', 'fields'])(
    'refuses a server launch with the wrong %s',
    async (part) => {
      const url = new URL('https://midnightpassport.com/');
      url.searchParams.set('passportCallback', `${window.location.origin}/passport-callback`);
      url.searchParams.set('passportState', 'b'.repeat(64));
      url.searchParams.set('passportFields', 'passportContract');
      if (part === 'origin') url.hostname = 'attacker.example';
      if (part === 'callback')
        url.searchParams.set('passportCallback', 'https://attacker.example/');
      if (part === 'state') url.searchParams.set('passportState', 'wrong-state');
      if (part === 'fields') url.searchParams.set('passportFields', 'displayName');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            challengeId: 'a'.repeat(64),
            state: 'b'.repeat(64),
            expiresAt: Date.now() + 300_000,
            launchUrl: url.href,
          }),
        }),
      );
      await expect(
        new MidnightPassportClient().verifyAccount({ address: 'account', network: 'stagenet' }),
      ).rejects.toThrow('launch target');
    },
  );

  it('cancels a delayed start response before it can persist state or navigate', async () => {
    let resolve: (value: unknown) => void = () => {};
    const json = new Promise((done) => {
      resolve = done;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => json }));
    const client = new MidnightPassportClient();
    const start = client.verifyAccount({ address: 'account', network: 'stagenet' });
    await Promise.resolve();
    client.cancel();
    const url = new URL('https://midnightpassport.com/');
    url.searchParams.set('passportCallback', `${window.location.origin}/passport-callback`);
    url.searchParams.set('passportState', 'b'.repeat(64));
    url.searchParams.set('passportFields', 'passportContract');
    resolve({
      challengeId: 'a'.repeat(64),
      state: 'b'.repeat(64),
      expiresAt: Date.now() + 300_000,
      launchUrl: url.href,
    });
    await expect(start).rejects.toThrow('cancelled');
    expect(sessionStorage.getItem('midnight.vote/passport-verification-request')).toBeNull();
  });

  it('sends the callback proof once and refuses a server response that claims unsupported authority', async () => {
    mocks.read.mockReturnValue({ kind: 'response', envelope: { payload: 'signed' } });
    mocks.take.mockReturnValue('state');
    mocks.verify.mockReturnValue({
      ok: true,
      payload: {
        nonce: 'nonce',
        profile: { passportContract: { address: 'account', network: 'stagenet' } },
      },
    });
    sessionStorage.setItem(
      'midnight.vote/passport-verification-request',
      JSON.stringify({ challengeId: 'a'.repeat(64), state: 'state' }),
    );
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ report: { authorized: true } }) });
    vi.stubGlobal('fetch', fetch);
    const client = new MidnightPassportClient();
    client.callback();
    await expect(client.verifyCallbackOnServer()).rejects.toThrow(
      'Invalid account-verification result',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      challengeId: 'a'.repeat(64),
      envelope: { payload: 'signed' },
    });
    expect(await client.verifyCallbackOnServer()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('midnight.vote/passport-verification-request')).toBeNull();
  });

  it('does not forward a callback with mismatched stored server state', async () => {
    mocks.read.mockReturnValue({ kind: 'response', envelope: { payload: 'signed' } });
    mocks.take.mockReturnValue('state');
    mocks.verify.mockReturnValue({ ok: true, payload: { nonce: 'nonce', profile: {} } });
    sessionStorage.setItem(
      'midnight.vote/passport-verification-request',
      JSON.stringify({ challengeId: 'a'.repeat(64), state: 'other-state' }),
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = new MidnightPassportClient();
    expect(() => client.callback()).toThrow('does not match');
    expect(await client.verifyCallbackOnServer()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
