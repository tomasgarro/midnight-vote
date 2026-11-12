import { expect, test } from '@playwright/test';

test('explores polls, saves one simulated answer, exports encrypted recovery and restores it', async ({
  page,
}) => {
  await page.goto('/#polls');
  await expect(page.getByRole('heading', { name: 'Understand before you answer.' })).toBeVisible();
  await expect(page.getByText(/Sign-in uses the real Midnight Passport/)).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: 'on Sundays?' });
  await card.getByRole('button', { name: 'Open poll' }).click();
  // Cleisthenes' briefing comes with the poll, marked as an example.
  await expect(page.getByText('Quieter, safer Sundays for people on foot.')).toBeVisible();
  await expect(page.getByText(/An example briefing written for this demo/)).toBeVisible();
  await page.getByRole('radio', { name: 'Yes', exact: true }).check();
  await page.getByRole('button', { name: 'Save a demo answer' }).click();
  await expect(page.getByRole('heading', { name: 'Your demo answer is saved.' })).toBeVisible();
  await page.getByRole('link', { name: 'Keep a receipt' }).click();
  await page.getByLabel('Recovery passphrase').fill('this is a private recovery phrase');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted receipt' }).click();
  const download = await downloadEvent;
  const path = await download.path();
  if (!path) throw new Error('No downloaded receipt');
  await page.getByRole('button', { name: 'Clear private receipt from this view' }).click();
  await page.getByLabel('Recovery passphrase').fill('this is a private recovery phrase');
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(
    page.getByText('Your private opening matches the ballot commitment.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^Yes$/ })).toBeVisible();
  await expect(page.getByText('Blockchain confirmation — not established')).toBeVisible();
  await expect(page.getByText('Aggregate proof — not established')).toBeVisible();
});

test('publishes immutable demo rules and refuses regional eligibility without a credential', async ({
  page,
}) => {
  await page.goto('/#organizer');
  await page
    .getByLabel('Question', { exact: true })
    .fill('Should we improve the community garden?');
  await page.getByLabel('Context', { exact: true }).fill('Non-binding local demonstration.');
  await page.getByRole('radio', { name: /^Private totals/ }).check();
  await page.getByLabel('Who may answer?').selectOption('residence');
  await page.getByLabel('Required claim value').fill('Geneva');
  const closing = new Date(Date.now() + 3600_000);
  const local = new Date(closing.getTime() - closing.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel('Closes', { exact: true }).fill(local);
  await page.getByRole('button', { name: 'Publish demo on this device' }).click();
  await expect(
    page.getByText('Demo poll published on this device.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Polls', exact: true }).first().click();
  const card = page
    .getByRole('article')
    .filter({ hasText: 'Should we improve the community garden?' });
  await card.getByRole('button', { name: 'Open poll' }).click();
  await expect(
    page.getByText('Requires verified residence: Geneva.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save a demo answer' })).toBeDisabled();
});

test('shows Midnight Passport network and capability boundaries and has no horizontal overflow', async ({
  page,
}) => {
  await page.goto('/#connect');
  await expect(
    page.getByRole('heading', { name: 'Sign in with Midnight Passport.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Current account network: Stagenet.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create or connect Midnight Passport' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect using a full-page redirect' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('requires explicit public disclosure consent and counts after closing without another voter action', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  await page.goto('/#polls');
  const card = page.getByRole('article').filter({ hasText: 'Should our next meeting be hybrid?' });
  await card.getByRole('button', { name: 'Open poll' }).click();
  await page.getByRole('radio', { name: 'Yes', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Save a demo answer' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand that a public poll/ }).check();
  await page.getByRole('button', { name: 'Save a demo answer' }).click();
  await expect(page.getByRole('heading', { name: 'Your demo answer is saved.' })).toBeVisible();
  await page.clock.fastForward(8 * 86400_000);
  await expect(page.getByRole('heading', { name: 'Local demonstration totals' })).toBeVisible();
  await expect(page.getByText('Simulated account: Yes')).toBeVisible();
});
