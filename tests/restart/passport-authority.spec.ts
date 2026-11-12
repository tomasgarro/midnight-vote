import { randomBytes } from 'node:crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { expect, test } from '@playwright/test';

test('a real server checks an attacker-signed callback without authorizing the claimed account', async ({
  page,
}) => {
  await page.goto('/#connect');
  const flow = await page.evaluate(async () => {
    const response = await fetch('/api/polls/passport/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: 'victim-account-fixture',
        network: 'stagenet',
        purpose: 'connect',
      }),
    });
    if (!response.ok) throw new Error(`Start failed: ${response.status}`);
    const value = await response.json();
    sessionStorage.setItem('passport.connect.state.midnight-vote/restart', value.state);
    sessionStorage.setItem(
      'midnight.vote/passport-verification-request',
      JSON.stringify({ challengeId: value.challengeId, state: value.state }),
    );
    return value;
  });
  const key = randomBytes(32);
  const bytes = Buffer.from(
    JSON.stringify({
      protocol: 'org.midnight.passport.callback/v1',
      type: 'passport.callback.profile',
      version: 1,
      audience: 'http://localhost:4183',
      state: flow.state,
      issuedAt: Date.now(),
      nonce: randomBytes(24).toString('hex'),
      fields: ['passportContract'],
      profile: { passportContract: { address: 'victim-account-fixture', network: 'stagenet' } },
    }),
  );
  const envelope = {
    protocol: 'org.midnight.passport.callback/v1',
    type: 'passport.callback.response',
    scheme: 'bip340-schnorr-secp256k1-sha256',
    payload: bytes.toString('base64url'),
    publicKey: Buffer.from(schnorr.getPublicKey(key)).toString('hex'),
    signature: Buffer.from(schnorr.sign(sha256(bytes), key)).toString('hex'),
  };
  const wire = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  await page.goto(`/passport-callback#passportResponse=${wire}`);
  await expect(page.getByRole('heading', { name: 'Server verification result' })).toBeVisible();
  await expect(page.getByText('Response signature and fresh request: verified.')).toBeVisible();
  await expect(
    page.getByText('Account authority: unavailable. Live voting remains blocked.'),
  ).toBeVisible();
  await expect(page.getByText('Different network — this is a Stagenet account')).toBeVisible();
  await expect(page).toHaveURL('/#connect');
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('midnight.vote/passport-verification-request'),
    ),
  ).toBeNull();
  const replay = await page.evaluate(
    async ({ challengeId, envelope }) => {
      const result = await fetch('/api/polls/passport/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, envelope }),
      });
      return result.status;
    },
    { challengeId: flow.challengeId, envelope },
  );
  expect(replay).toBe(403);
});
