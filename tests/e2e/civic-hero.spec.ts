import { expect, test } from '@playwright/test';

const HEADLINE = /Your voice\.\s*Your choice\.|Tu voz\.\s*Tu elección\./;

test('the hero shows the guide before the lake, in the brand colours', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const stage = page.locator('.civic-art__stage');
  await expect(stage).toHaveAttribute('data-failed', 'false');
  await expect(page.locator('.civic-art__view')).toHaveJSProperty('naturalWidth', 1376);
  await expect(page.locator('.civic-art__guide')).toHaveJSProperty('naturalWidth', 760);

  // The arch is a half circle: its radius is half the width of the frame.
  const frame = page.locator('.civic-art__frame');
  const box = await frame.boundingBox();
  if (!box) throw new Error('The hero picture is missing');
  const radius = await frame.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).borderTopLeftRadius),
  );
  expect(Math.abs(radius - box.width / 2)).toBeLessThan(1.5);

  // One accent, and it is flat.
  const accent = page.locator('#landing-title em');
  await expect(accent).toHaveCSS('color', 'rgb(162, 79, 64)');
  await expect(accent).toHaveCSS('background-image', 'none');
  await expect(page.locator('.midnight-hero')).toHaveCSS('background-color', 'rgb(243, 237, 223)');
  await expect(page.locator('#landing-title')).toHaveCSS('font-family', /Source Serif 4/);
  await page.screenshot({ path: test.info().outputPath('hero-desktop.png') });

  await expect(page).not.toHaveURL(/#app/);
  await expect(
    page.getByRole('link', { name: 'Explore Midnight', exact: true }).last(),
  ).toHaveAttribute('href', 'https://midnight.network');
});

test('the landing page keeps its paper when the app is in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(page.locator('.midnight-hero')).toHaveCSS('background-color', 'rgb(243, 237, 223)');
  await expect(page.locator('#landing-title')).toHaveCSS('color', 'rgb(37, 40, 35)');
  await expect(page.locator('.finale-footer')).toHaveCSS('background-color', 'rgb(243, 237, 223)');
});

for (const width of [320, 390, 768]) {
  test(`the hero picture and the navigation fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.civic-art__view')).toHaveJSProperty('naturalWidth', 1376);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);

    // The wordmark, the action and the menu do not overlap.
    const edges = await page.evaluate(() =>
      ['.midnight-brand', '.midnight-nav__start', '.midnight-nav__toggle'].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box && box.width > 0 ? [box.left, box.right] : null;
      }),
    );
    const shown = edges.filter((edge): edge is number[] => edge !== null);
    for (let index = 1; index < shown.length; index += 1) {
      expect(shown[index]?.[0]).toBeGreaterThanOrEqual(shown[index - 1]?.[1] ?? 0);
    }

    // The headline keeps its three lines.
    const lines = await page.locator('#landing-title').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    });
    expect(lines).toBe(3);

    await page.locator('.civic-art__stage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`hero-${width}.png`) });
  });
}

test('reduced motion keeps the picture still', async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(test.info().project.use.baseURL ?? 'http://localhost:4173');
  for (const selector of ['.civic-art__view', '.civic-art__guide']) {
    await expect(page.locator(selector)).toHaveCSS('animation-name', 'none');
  }
  await context.close();
});

test('a missing picture leaves a fallback and a usable page', async ({ page }) => {
  await page.route('**/art/civic/alpine-lake.webp', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('.civic-art__stage')).toHaveAttribute('data-failed', 'true');
  await expect(page.locator('.civic-art__fallback')).toBeVisible();
  await expect(page.locator('.civic-art__guide')).toBeHidden();
  await page.getByRole('button', { name: 'Get started', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: HEADLINE, exact: true })).toBeVisible();
});
