import { expect, type Page, test } from '@playwright/test';

const HEADLINE = /Your voice\.\s*Your choice\.\s*Your secret\./u;

/** Where the symbol sits in the hand frame, as the page was told (hero-assets.ts). */
const symbolAt = (page: Page) =>
  page.locator('.hero-hand').evaluate((el) => ({
    x: Number.parseFloat(el.style.getPropertyValue('--sx')),
    y: Number.parseFloat(el.style.getPropertyValue('--sy')),
  }));

const reveal = (page: Page) =>
  page
    .locator('.hero-hand')
    .evaluate((el) => Number.parseFloat(el.style.getPropertyValue('--reveal-radius')) || 0);

test('the hand stands inside the portico, under one turning word', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.journey')).toHaveAttribute('data-motion', 'on');
  await expect(page.locator('.hero-hand__canvas')).toHaveCount(1);
  await expect(page.locator('.hero-hand__poster')).toHaveCount(0);

  // The whole portico fills the frame, and the hand stands in its middle.
  const portico = await page.locator('.ph-portico__whole').boundingBox();
  const hand = await page.locator('.hero-hand').boundingBox();
  if (!hand || !portico) throw new Error('The opening is missing a part');
  expect(portico.width).toBeGreaterThanOrEqual(1440);
  expect(hand.x + hand.width / 2).toBeCloseTo(720, -1);

  // One line; its last word turns from voice to choice to secret.
  await expect(page.locator('.ph-rotor em')).toHaveText(['voice.', 'choice.', 'secret.']);
  const shown = () =>
    page
      .locator('.ph-rotor em')
      .evaluateAll((words) =>
        words
          .filter((word) => Number(getComputedStyle(word).opacity) > 0.9)
          .map((w) => w.textContent),
      );
  await expect.poll(shown).toEqual(['voice.']);
  await expect.poll(shown, { timeout: 6000 }).toEqual(['choice.']);
  await expect(page.locator('.ph-copy')).not.toContainText(/Be part of the conversation/u);

  // the turning word is paper on a flat terracotta plate
  const accent = page.locator('#landing-title em').first();
  await expect(accent).toHaveCSS('color', 'rgb(255, 253, 248)');
  await expect(page.locator('.ph-rotor')).toHaveCSS('background-color', 'rgb(162, 79, 64)');
  await expect(accent).toHaveCSS('background-image', 'none');
  await expect(page.locator('#landing-title')).toHaveCSS('font-family', /Source Serif 4/u);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADLINE);
  await page.screenshot({ path: test.info().outputPath('hero-desktop.png') });
});

test('the agent hand opens under the mouse, and closes when the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const stage = page.locator('.hero-hand');
  await expect(stage).toHaveAttribute('data-interactive', 'true');
  const rect = await stage.boundingBox();
  if (!rect) throw new Error('The hand is missing');

  // Far from the passport and the palm, the circle stays small.
  await page.mouse.move(rect.x + rect.width * 0.05, rect.y + rect.height * 0.85);
  await expect.poll(() => reveal(page)).toBeGreaterThan(10);
  await expect.poll(() => reveal(page)).toBeLessThan(16);
  // On the symbol it opens wide; the shader draws the agent inside it.
  const symbol = await symbolAt(page);
  await page.mouse.move(rect.x + rect.width * symbol.x, rect.y + rect.height * symbol.y);
  await expect.poll(() => reveal(page)).toBeGreaterThan(rect.width * 0.32);
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('hero-reveal.png') });

  await page.mouse.wheel(0, 600);
  await expect.poll(() => reveal(page)).toBe(0);
  await expect(page).not.toHaveURL(/#/u);
});

test('scrolling flies through the columns into the symbol, which carries the chapter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const mark = page.locator('.pc-mark');
  await expect(mark).toHaveCSS('opacity', '0');

  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect.poll(() => mark.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(page.locator('.ph')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.pc-ground')).toHaveCSS('background-color', 'rgb(29, 27, 23)');
  await page.screenshot({ path: test.info().outputPath('zoom-mark.png') });

  // The first step: the symbol has left the stage to the card and the words.
  await page.evaluate(() => window.scrollTo(0, 3220));
  await expect(page.locator('.pc-part--1 .pc-part__text')).toHaveCSS('opacity', '1');
  await expect(page.locator('.pc-part--1 .pc-part__figure')).toHaveCSS('opacity', '1');
  await expect.poll(() => mark.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await page.screenshot({ path: test.info().outputPath('chapter-home.png') });

  // The last step: the agent's pass shows what it just did.
  await page.evaluate(() => window.scrollTo(0, 6300));
  await expect(page.locator('.pc-part--5 .pc-part__text')).toHaveCSS('opacity', '1');
  await expect(page.locator('.pc-pass__did')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('chapter-agent.png') });
});

test('the landing page keeps its paper when the app is in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(page.locator('.journey')).toHaveCSS('background-color', 'rgb(243, 237, 223)');
  await expect(page.locator('#landing-title')).toHaveCSS('color', 'rgb(37, 40, 35)');
  await expect(page.locator('.closeout')).toHaveCSS('background-color', 'rgb(243, 237, 223)');
});

for (const width of [320, 390, 768]) {
  test(`the opening and the header fit at ${width}px`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    // The scenes play from 360 px wide; narrower is a plain page.
    await expect(page.locator('.journey')).toHaveAttribute(
      'data-motion',
      width >= 360 ? 'on' : 'off',
    );
    await expect(page.locator('.hero-hand__canvas')).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);

    // The name and the action share the header without touching.
    const brand = await page.locator('.landing-header .midnight-brand').boundingBox();
    const start = await page.locator('.landing-header__start').boundingBox();
    if (!brand || !start) throw new Error('The header is missing a part');
    expect(start.x).toBeGreaterThanOrEqual(brand.x + brand.width);

    // The headline is one line, with the turning word.
    const lines = await page
      .locator('#landing-title')
      .evaluate((el) =>
        Math.round(
          el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight),
        ),
      );
    expect(lines).toBe(1);
    // Phones never fetch the agent's full picture.
    expect(requests.some((url) => url.includes('agent-hand.webp'))).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`hero-${width}.png`) });
  });
}

test('reduced motion lays the whole story out, with nothing moving', async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(test.info().project.use.baseURL ?? 'http://localhost:4173');
  await expect(page.locator('.journey')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('.hero-hand')).toHaveAttribute('data-interactive', 'false');
  for (const title of [
    'One place for your money',
    'Show only what is asked.',
    'No seed phrase.',
    'A name, not a string of code.',
    'Your agents act for you',
    'Understand before you answer.',
    'Polls for your own groups.',
    'Referendums, country by country.',
  ]) {
    const part = page.getByRole('heading', { name: new RegExp(title, 'u') });
    await part.scrollIntoViewIfNeeded();
    await expect(part).toBeVisible();
  }
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === 'running').length,
    ),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((entry) => /gsap/u.test(entry.name)),
    ),
  ).toBe(false);
  await context.close();
});

test('a missing hand leaves words on the cover and a usable page', async ({ page }) => {
  await page.route('**/art/passport/hands-2x2.*', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('.hero-hand')).toHaveAttribute('data-failed', 'true');
  await expect(page.locator('.hero-hand__fallback')).toBeVisible();
  await page
    .locator('.ph-actions')
    .getByRole('button', { name: /Try a poll/u })
    .click();
  await expect(page).toHaveURL(/#polls$/u);
});
