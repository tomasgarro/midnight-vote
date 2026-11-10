import { expect, type Page, test } from '@playwright/test';

const HEADLINE = /Your voice\.\s*Your choice\.\s*Your secret\./u;

const reveal = (page: Page) =>
  page
    .locator('.hero-hand')
    .evaluate((el) => Number.parseFloat(el.style.getPropertyValue('--reveal-radius')) || 0);

test('the hand stands between two columns, in the brand colours', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.journey')).toHaveAttribute('data-motion', 'on');
  await expect(page.locator('.hero-hand__picture').first()).toHaveJSProperty('naturalWidth', 1672);
  await expect(page.locator('.ph-column')).toHaveCount(2);

  // The columns stand at the two edges, and the hand between them.
  const [left, right] = await page
    .locator('.ph-column')
    .evaluateAll((columns) => columns.map((column) => column.getBoundingClientRect()));
  const hand = await page.locator('.hero-hand').boundingBox();
  if (!hand || !left || !right) throw new Error('The opening is missing a part');
  expect(hand.x + hand.width / 2).toBeCloseTo(720, -1);

  const accent = page.locator('#landing-title em');
  await expect(accent).toHaveCSS('color', 'rgb(162, 79, 64)');
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

  await page.mouse.move(rect.x + rect.width * 0.93, rect.y + rect.height * 0.7);
  await expect.poll(() => reveal(page)).toBeGreaterThan(10);
  await expect.poll(() => reveal(page)).toBeLessThan(16);
  await page.mouse.move(rect.x + rect.width * 0.3585, rect.y + rect.height * 0.3311);
  await expect.poll(() => reveal(page)).toBeGreaterThan(rect.width * 0.32);
  const masks = await page
    .locator('.hero-hand__window')
    .evaluateAll((windows) => windows.map((el) => getComputedStyle(el).maskImage));
  expect(masks[0]).toContain('radial-gradient');
  expect(masks[1]).toContain('radial-gradient');
  expect(masks[0]).not.toEqual(masks[1]);
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

  await page.evaluate(() => window.scrollTo(0, 1250));
  await expect.poll(() => mark.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(page.locator('.ph')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.pc-ground')).toHaveCSS('background-color', 'rgb(27, 28, 32)');
  await page.screenshot({ path: test.info().outputPath('zoom-mark.png') });

  // The second part: the squares have left the ring for the poll card.
  await page.evaluate(() => window.scrollTo(0, 3100));
  await expect
    .poll(() =>
      page
        .locator('.pc-mark .midnight-mark__square--1')
        .evaluate((el) => getComputedStyle(el).transform),
    )
    .not.toBe('none');
  await expect(page.locator('.pc-part--2 .pc-part__text')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('chapter-rules.png') });
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
    await expect(page.locator('.journey')).toHaveAttribute('data-motion', 'off');
    await expect(page.locator('.hero-hand__picture').first()).toHaveJSProperty(
      'naturalWidth',
      1672,
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);

    // The name and the action share the header without touching.
    const brand = await page.locator('.landing-header .midnight-brand').boundingBox();
    const start = await page.locator('.landing-header__start').boundingBox();
    if (!brand || !start) throw new Error('The header is missing a part');
    expect(start.x).toBeGreaterThanOrEqual(brand.x + brand.width);

    // The headline keeps whole sentences, one per line.
    const lines = await page
      .locator('#landing-title')
      .evaluate((el) =>
        Math.round(
          el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight),
        ),
      );
    expect(lines).toBe(3);
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
  for (const title of ['Prove who you are.', 'Ask your question.', 'Count it in the open.']) {
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
  await page.route('**/art/passport/human-hand.webp', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('.hero-hand')).toHaveAttribute('data-failed', 'true');
  await expect(page.locator('.hero-hand__fallback')).toBeVisible();
  await page
    .locator('.ph-actions')
    .getByRole('button', { name: /Try a poll/u })
    .click();
  await expect(page).toHaveURL(/#polls$/u);
});
