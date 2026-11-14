import { webcrypto } from 'node:crypto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PollWorkspace from '../views/PollWorkspace';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  cancel: vi.fn(),
  verifyAccount: vi.fn(),
  callback: vi.fn(),
  verifyCallback: vi.fn(),
}));
vi.mock('../integration/midnight-passport-client', () => ({
  MidnightPassportClient: class {
    connect = mocks.connect;
    cancel = mocks.cancel;
    verifyAccount = mocks.verifyAccount;
    callback = mocks.callback;
    verifyCallbackOnServer = mocks.verifyCallback;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.callback.mockReturnValue(null);
  mocks.verifyCallback.mockResolvedValue(null);
  vi.stubGlobal('crypto', webcrypto);
  window.localStorage.clear();
  window.history.replaceState(null, '', '/#connect');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps a newer connection pending when a cancelled attempt rejects late', async () => {
  let rejectFirst: (error: Error) => void = () => {};
  let resolveSecond: (value: unknown) => void = () => {};
  mocks.connect.mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectFirst = reject;
    }),
  );
  mocks.connect.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSecond = resolve;
    }),
  );
  render(<PollWorkspace />);
  await waitFor(() =>
    expect(window.localStorage.getItem('midnight.vote/restart/demo-polls/v2')).toBeTruthy(),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create or connect Midnight Passport' }));
  await user.click(screen.getByRole('button', { name: 'Cancel connection' }));
  await user.click(screen.getByRole('button', { name: 'Create or connect Midnight Passport' }));
  await act(async () => rejectFirst(new Error('obsolete failure')));
  expect(
    (screen.getByRole('button', { name: 'Waiting for Midnight Passport…' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.queryByText('obsolete failure')).toBeNull();
  await act(async () =>
    resolveSecond({
      displayName: 'Alex',
      account: { address: 'account', network: 'stagenet' },
      transport: 'profile-consent',
      accountControl: 'unavailable',
    }),
  );
  expect(await screen.findByRole('heading', { name: 'Your profile is connected.' })).toBeTruthy();
});

it('shows an unavailable verifier without losing the connected profile or granting authority', async () => {
  mocks.connect.mockResolvedValue({
    displayName: 'Alex',
    account: { address: 'account', network: 'stagenet' },
    transport: 'profile-consent',
    accountControl: 'unavailable',
  });
  mocks.verifyAccount.mockRejectedValue(new Error('Account-verification service unavailable.'));
  render(<PollWorkspace />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create or connect Midnight Passport' }));
  await user.click(await screen.findByRole('button', { name: 'Check account verification' }));
  expect(await screen.findByText('Account-verification service unavailable.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Your profile is connected.' })).toBeTruthy();
  expect(
    screen.getByText('Unavailable — profile consent is not an account-control proof'),
  ).toBeTruthy();
  expect(screen.getByText('Different network — this is a Stagenet account')).toBeTruthy();
});

it('consumes a redirect once and finishes verification under React StrictMode', async () => {
  window.history.replaceState(null, '', '/passport-callback#signed-test-fixture');
  mocks.callback.mockReturnValue({
    account: { address: 'account', network: 'stagenet' },
    transport: 'signed-redirect',
    accountControl: 'unavailable',
  });
  mocks.verifyCallback.mockResolvedValue({
    kind: 'midnight.vote/passport-verification/v1',
    responseSignature: 'verified',
    requestBinding: 'verified',
    authorized: false,
    blockers: ['Upstream account proof unavailable.'],
  });
  render(
    <StrictMode>
      <PollWorkspace />
    </StrictMode>,
  );
  expect(await screen.findByRole('heading', { name: 'Server verification result' })).toBeTruthy();
  expect(mocks.callback).toHaveBeenCalledTimes(1);
  expect(mocks.verifyCallback).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe('#connect');
});

it('ignores an old callback result after disconnect and reconnect', async () => {
  window.history.replaceState(null, '', '/passport-callback#signed-test-fixture');
  let resolve: (value: unknown) => void = () => {};
  mocks.callback.mockReturnValue({
    displayName: 'Old',
    account: { address: 'old', network: 'stagenet' },
    transport: 'signed-redirect',
    accountControl: 'unavailable',
  });
  mocks.verifyCallback.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mocks.connect.mockResolvedValue({
    displayName: 'New',
    account: { address: 'new', network: 'stagenet' },
    transport: 'profile-consent',
    accountControl: 'unavailable',
  });
  render(<PollWorkspace />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Disconnect profile' }));
  await user.click(screen.getByRole('button', { name: 'Create or connect Midnight Passport' }));
  expect(await screen.findByRole('link', { name: 'New' })).toBeTruthy();
  await act(async () => resolve({ responseSignature: 'verified', blockers: ['Old result'] }));
  expect(screen.queryByRole('heading', { name: 'Server verification result' })).toBeNull();
  expect(screen.queryByText('Old result')).toBeNull();
});
