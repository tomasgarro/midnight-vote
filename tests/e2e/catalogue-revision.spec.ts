import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
  video: { mode: 'on', size: { width: 390, height: 844 } },
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
    localStorage.setItem('cico-locale', 'en');
  });
  await page.goto('/#app');
});
test('one place at a time, source-backed chat and reduced motion', async ({ page }) => {
  const places = page.getByRole('group', { name: 'Consultation scope' });
  await expect(page.locator('.votes__results h2')).toHaveText(['Global']);
  await places.getByRole('button', { name: 'Switzerland' }).click();
  await expect(page.locator('.votes__results h2')).toHaveText(['Switzerland']);
  await expect(page.getByRole('heading', { name: 'Limiting fireworks' })).toBeVisible();
  await page.getByRole('button', { name: 'Cleisthenes', exact: true }).click();
  await page.getByRole('textbox').fill('Summarize the fireworks initiative');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('status')).toContainText('Finding catalogue context');
  await expect(page.locator('.catalogue-chat__answer')).toContainText('loud fireworks');
  await page.screenshot({ path: 'outputs/cleisthenes-fireworks-390.png' });
  // The answer is in one shape: in short, each side, the sources, the limits.
  await expect(page.locator('.chat-answer-section h3')).toHaveText([
    'In short',
    'What each side says',
    'Sources',
    'What I can’t tell you',
  ]);
  await expect(page.getByRole('link', { name: /UVEK/ })).toHaveAttribute('href', /uvek\.admin\.ch/);
  await page.getByRole('button', { name: 'Clear chat' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Topics', exact: true }).click();
  await page.getByRole('button', { name: 'Climate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Limiting fireworks' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});
test('budget reflection preserves choices on back and review editing', async ({ page }) => {
  // The civic pulse is outside the three steps. Its address opens it.
  await page.goto('/#app/pulse');
  await page.getByRole('button', { name: 'Start reflecting' }).click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
  await page.getByRole('button', { name: /Cost of living/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: /It depends on the circumstances/ }).click();
  await page.screenshot({ path: 'outputs/civic-budget-390.png' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /It depends on the circumstances/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Compare a mix/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Edit: Borrowing tolerance' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take a moment to look back.' })).toBeVisible();
  await expect(page.getByText('Compare a mix of approaches', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish reflection' }).click();
  await expect(page.getByText(/No answers were sent/)).toBeVisible();
});
