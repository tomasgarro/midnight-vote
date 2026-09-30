import { expect, test } from '@playwright/test';

test.use({ video: 'on' });

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 740 },
]) {
  test(`suggestions keep the app frame and keyboard stable at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
      localStorage.setItem('cico-locale', 'en');
    });
    await page.goto('/#app');
    await expect(page.locator('.votes__results').first()).toBeVisible();
    // The page says what it is before it lists anything.
    expect(
      await page.locator('.votes').evaluate((el) => {
        const sections = [...el.children];
        return (
          sections.indexOf(el.querySelector('.votes__head')!) <
          sections.indexOf(el.querySelector('.votes__results')!)
        );
      }),
    ).toBe(true);
    await page.getByRole('button', { name: 'Cleisthenes', exact: true }).click();
    const composer = page.locator('.catalogue-chat__composer');
    const before = await composer.boundingBox();
    const pageTop = await page.evaluate(() => window.scrollY);
    await page.getByRole('button', { name: 'Show global consultations', exact: true }).click();
    await expect(page.locator('.catalogue-chat__answer')).toBeVisible();
    await expect(page.getByRole('textbox')).not.toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(pageTop);
    expect((await composer.boundingBox())?.y).toBeCloseTo(before!.y, 0);
    await page
      .locator('.catalogue-chat__source')
      .first()
      .getByRole('button', { name: 'Summarize', exact: true })
      .click();
    await expect(page.locator('.catalogue-chat__answer')).toHaveCount(2);
    await expect(page.getByRole('textbox')).not.toBeFocused();
    expect((await composer.boundingBox())?.y).toBeCloseTo(before!.y, 0);
    await page.screenshot({ path: `outputs/chat-stable-${viewport.width}.png` });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    // `--surface` in the dark theme (#262723).
    await expect(page.locator('.chat-followups button').first()).toHaveCSS(
      'background-color',
      'rgb(38, 39, 35)',
    );
    await page.screenshot({ path: `outputs/chat-stable-dark-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Clear chat' }).click();
    await expect(page.getByRole('textbox')).not.toBeFocused();
  });
}

test('landing story animates on laptop height and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 740 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('.how-track')).toHaveAttribute('data-pinned', 'true');
  await page.getByRole('button', { name: '02 Prove', exact: true }).click();
  await expect(page.locator('.how-track')).toHaveAttribute('data-step', '2');
  await page.screenshot({ path: 'outputs/landing-laptop-motion.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.how-track')).toHaveAttribute('data-pinned', 'false');
  await expect(page.locator('.how-panel[aria-hidden="true"]')).toHaveCount(0);
});
