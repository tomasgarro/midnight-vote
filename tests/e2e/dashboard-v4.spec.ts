import { expect, test } from '@playwright/test';
import { PULSE_COPY } from '../../ui/src/pulse/pulse-copy';

test.use({ video: { mode: 'on', size: { width: 390, height: 844 } } });

for (const [width, locale, theme] of [
  [320, 'en', 'light'],
  [390, 'es', 'dark'],
  [768, 'fr', 'light'],
  [1440, 'en', 'dark'],
] as const) {
  test(`three destinations and reflection ${width} ${locale} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(
      ({ locale, theme }) => {
        sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
        localStorage.setItem('cico-locale', locale);
        localStorage.setItem('cico-theme', theme);
      },
      { locale, theme },
    );
    await page.goto('/#app');
    await expect(page.locator('.votes__results').first()).toBeVisible();
    await expect(page.locator('.votes__pulse')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `outputs/dashboard-${width}-${locale}.png` });
    // Three destinations, each with one heading, and one of them current.
    const destinations = page.locator('.chrome-nav button');
    await expect(destinations).toHaveCount(3);
    for (const index of [1, 2, 0]) {
      await destinations.nth(index).click();
      await expect(destinations.nth(index)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.chrome-nav [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('.app-shell h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `outputs/dashboard-${width}-tab-${index}.png` });
    }
    // Every part of You opens in full and leads back to its summary.
    await destinations.nth(2).click();
    const summary = page.locator('.you-row');
    await expect(summary).toHaveCount(4);
    for (const index of [0, 1]) {
      await summary.nth(index).click();
      await expect(page.locator('.app-shell h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.locator('.you-back').click();
      await expect(summary).toHaveCount(4);
    }
    // The civic pulse is outside the three steps. Its address opens it.
    await page.goto('/#app/pulse');
    const t = PULSE_COPY[locale];
    await page.getByRole('button', { name: t.start, exact: true }).click();
    await page.getByRole('button', { name: t.begin, exact: true }).click();
    await page.getByRole('button', { name: new RegExp(t.priorities[0][0]) }).click();
    await page.screenshot({ path: `outputs/reflection-${width}-${locale}.png` });
    await page.getByRole('button', { name: t.next, exact: true }).click();
    await page.getByRole('button', { name: t.back, exact: true }).click();
    await expect(
      page.getByRole('button', { name: new RegExp(t.priorities[0][0]) }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: t.next, exact: true }).click();
    await page.getByRole('button', { name: t.skip, exact: true }).click();
    await page.getByRole('button', { name: t.skip, exact: true }).click();
    await page.getByRole('button', { name: t.skip, exact: true }).click();
    await page.getByRole('button', { name: t.skip, exact: true }).click();
    await page.getByRole('button', { name: t.finish, exact: true }).click();
    await expect(page.getByRole('heading', { name: t.completeTitle })).toBeVisible();
    await info.attach('completed reflection', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('catalogue answers, follow-ups and consultation return preserve the conversation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
    localStorage.setItem('cico-locale', 'en');
  });
  await page.goto('/#app');
  await page.getByRole('button', { name: 'Cleisthenes', exact: true }).click();
  await page.getByRole('button', { name: 'Show global consultations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open verification rules' })).toBeVisible();
  await page.getByRole('button', { name: 'Summarize', exact: true }).first().click();
  await expect(page.locator('.catalogue-chat__answer')).toHaveCount(2);
  const input = page.getByRole('textbox', { name: 'Ask about a consultation' });
  await input.fill('What are the arguments?');
  await input.press('Enter');
  await expect(page.locator('.catalogue-chat__answer').last()).toContainText(
    'What I can’t tell you',
  );
  await page.screenshot({ path: 'outputs/dashboard-chat-mobile.png' });
  await page.getByRole('button', { name: 'Read consultation', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Open verification rules' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.catalogue-chat__question').last()).toContainText(
    'What are the arguments?',
  );
  await input.fill('Summarize imaginary moon project');
  await input.press('Enter');
  await expect(page.locator('.catalogue-chat__answer').last()).toContainText('Which consultation');
  await page.getByRole('button', { name: 'Clear chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show global consultations' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cleisthenes', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Approximate the reduced space available while a phone keyboard is open.
  await page.setViewportSize({ width: 390, height: 420 });
  await input.focus();
  await expect(input).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Send question' })).toBeInViewport();
});
