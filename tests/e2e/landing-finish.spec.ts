import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`the ways in and the harbour keep their actions usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    for (const selector of [
      '.vote-row--learn .midnight-cta',
      '.vote-row--groups .midnight-cta',
      '.closeout .midnight-cta',
      '.closeout__links a[href="https://midnight.network"]',
    ]) {
      const action = page.locator(selector).first();
      await action.scrollIntoViewIfNeeded();
      const arrow = action.locator('.landing-action-arrow');
      await action.hover();
      await expect(arrow).toHaveCSS(
        'transform',
        'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)',
      );
      await page.mouse.move(0, 0);
      await expect(arrow).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    }

    // What midnight.vote does, in three rows, and nothing else under them.
    await expect(page.locator('.vote-row')).toHaveCount(3);
    await expect(page.getByText(/Ask Cleisthenes/u)).toBeVisible();
    await expect(page.getByText(/And agents\?|This is a demo/u)).toHaveCount(0);

    // One invitation, in the harbour's sky; the links sit in the sky too, and the water stays clear.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const closeout = page.locator('.closeout');
    await expect(closeout.getByRole('heading', { level: 2 })).toHaveText(
      /Be part of a\s*bigger conversation\./u,
    );
    await expect(page.getByText(/Margaret Mead/u)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Get started/u })).toHaveCount(1);
    const layout = await page.evaluate(() => {
      const scene = document.querySelector('.closeout')?.getBoundingClientRect();
      const links = document.querySelector('.closeout__links')?.getBoundingClientRect();
      return scene && links ? (links.bottom - scene.top) / scene.height : 1;
    });
    expect(layout).toBeLessThan(0.62);

    const scene = closeout.locator('.lake-scene video');
    await expect(scene).toHaveJSProperty('muted', true);
    await expect(scene).toHaveAttribute('playsinline', '');
    await expect(scene).toHaveAttribute(
      'poster',
      /\/art\/civic\/lake\/(desktop|phone)-poster\.webp$/u,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`closeout-${width}.png`) });

    await closeout.getByRole('button', { name: 'Run a poll', exact: true }).click();
    await expect(page).toHaveURL(/#organizer$/u);
  });
}

test('the harbour follows the doors and loops once it is in view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const video = page.locator('.closeout .lake-scene video');
  await expect(video).toHaveCount(0);

  // The doors panel's rounded bottom lies over the top of the picture.
  await page.locator('.start').evaluate((el) => el.scrollIntoView({ block: 'end' }));
  const join = await page.evaluate(() => {
    const start = document.querySelector('.start')?.getBoundingClientRect();
    const scene = document.querySelector('.closeout')?.getBoundingClientRect();
    return start && scene ? start.bottom - scene.top : 0;
  });
  expect(join).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.5);
  await expect(video).toHaveAttribute('loop', '');
});

test('reduced motion gets the finished harbour and never fetches the clip', async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(test.info().project.use.baseURL ?? 'http://localhost:4173');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const still = page.locator('.closeout .lake-scene img');
  await expect(still).toHaveAttribute('src', /\/art\/civic\/lake\/(desktop|phone)-poster\.webp$/u);
  await expect(page.locator('.closeout .lake-scene video')).toHaveCount(0);
  expect(requests.some((url) => url.endsWith('.mp4'))).toBe(false);
  await context.close();
});
