import { expect, test } from '@playwright/test';

test('mobile refinements: document arrows align and Demo can switch back to real Passport', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cico-locale', 'en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#app');
  await page.getByRole('button', { name: 'Already have Passport? Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Use demo Passport', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No real account');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await page.getByRole('button', { name: 'Use my real Passport', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect Midnight Passport', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Demo profile selected')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use demo Passport', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Verify my passport', exact: true }).click();
  const back = page.getByRole('button', { name: 'Previous step', exact: true });
  const forward = page.getByRole('button', { name: 'Continue', exact: true });
  const b = await back.boundingBox();
  const f = await forward.boundingBox();
  expect(Math.abs((b?.y ?? -1000) - (f?.y ?? 0))).toBeLessThan(3);
  await page.screenshot({ path: test.info().outputPath('document-arrows.png'), fullPage: true });
  await forward.click();
  await back.click();
  await expect(page.getByRole('heading', { name: /not a robot/i })).toBeVisible();
});

test('mobile refinements: Pulse saves only on request, restores, shares locally and deletes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('cico-locale', 'en');
    sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
  });
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') requests.push(r.url());
  });
  // The civic pulse is outside the three steps. Its address opens it.
  const open = async () => page.goto('/#app/pulse');
  await open();
  await page.getByRole('button', { name: 'Start reflecting', exact: true }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.getByRole('button', { name: /Cost of living/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Finish reflection', exact: true }).click();
  const summaryChoice = page
    .locator('.pulse-reflection-summary')
    .getByText('Cost of living', { exact: true });
  await summaryChoice.scrollIntoViewIfNeeded();
  expect(
    await summaryChoice.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }),
  ).toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem('midnight-civic-reflection-v1')),
  ).toBeNull();
  await page.getByRole('button', { name: 'Save on this device', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('saved-pulse.png'), fullPage: true });
  await page.getByRole('button', { name: 'Return to the app', exact: true }).click();
  await open();
  await expect(
    page.getByRole('button', { name: 'Review saved reflection', exact: true }),
  ).toBeVisible();
  await page.reload();
  await open();
  await page.getByRole('button', { name: 'Review saved reflection', exact: true }).click();
  await expect(page.getByText('Cost of living', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish reflection', exact: true }).click();
  await page.getByRole('button', { name: 'Explore with Cleisthenes', exact: true }).click();
  await expect(page.locator('.catalogue-chat__reflection')).toContainText('Cost of living');
  await expect(page.locator('.catalogue-chat__reflection')).toContainText(
    'Generative AI is not connected',
  );
  await page.getByRole('button', { name: 'Consultations', exact: true }).click();
  await expect(page).toHaveURL(/#app$/);
  await open();
  await page.getByRole('button', { name: 'Delete saved reflection', exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('midnight-civic-reflection-v1')),
  ).toBeNull();
  expect(requests).toEqual([]);
});
