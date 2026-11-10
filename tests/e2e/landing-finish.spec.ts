import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`the doors and the harbour keep their actions usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    for (const selector of [
      '.start-door--answer .midnight-cta',
      '.start-agents',
      '.closeout .midnight-cta',
      '.closeout nav a[href="https://midnight.network"]',
    ]) {
      const action = page.locator(selector).first();
      // The harbour lies under the doors until they have scrolled away.
      if (selector.startsWith('.closeout'))
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      else await action.scrollIntoViewIfNeeded();
      const arrow = action.locator('.landing-action-arrow');
      await action.hover();
      await expect(arrow).toHaveCSS(
        'transform',
        'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)',
      );
      await page.mouse.move(0, 0);
      await expect(arrow).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    }

    // One invitation, in the harbour's sky; the quote is gone.
    const closeout = page.locator('.closeout');
    await expect(closeout.getByRole('heading', { level: 2 })).toHaveText(
      /Be part of a\s*bigger conversation\./u,
    );
    await expect(page.getByText(/Margaret Mead/u)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Get started/u })).toHaveCount(1);

    const scene = closeout.locator('.lake-scene video');
    await expect(scene).toHaveJSProperty('muted', true);
    await expect(scene).toHaveAttribute('playsinline', '');
    await expect(scene).toHaveAttribute(
      'poster',
      /\/art\/civic\/lake\/(desktop|phone)-start\.webp$/u,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`closeout-${width}.png`) });

    await closeout.getByRole('button', { name: 'Run a poll', exact: true }).click();
    await expect(page).toHaveURL(/#organizer$/u);
  });
}

test('tabbing into the harbour moves the doors out of the way', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.start-agents').focus();
  // The next stop is in the harbour, which is still under the doors panel.
  await page.keyboard.press('Tab');
  const focused = page.locator('.closeout :focus');
  await expect(focused).toHaveCount(1);
  await expect
    .poll(() =>
      focused.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return (
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el ||
          el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        );
      }),
    )
    .toBe(true);
});

test('the harbour is under the doors before they leave, and plays once uncovered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const video = page.locator('.closeout .lake-scene video');
  await expect(video).toHaveCount(0);

  // While the doors pass, the harbour already waits beneath them.
  await page.locator('.start').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const under = await page.evaluate(() => {
    const start = document.querySelector('.start')?.getBoundingClientRect();
    const scene = document.querySelector('.closeout')?.getBoundingClientRect();
    return start && scene ? { startBottom: start.bottom, sceneTop: scene.top } : null;
  });
  expect(under?.sceneTop).toBeLessThan(under?.startBottom ?? 0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.5);
  await expect(video).not.toHaveAttribute('loop', '');
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
  await expect(still).toHaveAttribute('src', /\/art\/civic\/lake\/(desktop|phone)-end\.webp$/u);
  await expect(page.locator('.closeout .lake-scene video')).toHaveCount(0);
  expect(requests.some((url) => url.endsWith('.mp4'))).toBe(false);
  await context.close();
});
