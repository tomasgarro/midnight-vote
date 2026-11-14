import { expect, type Page, test } from '@playwright/test';

/** The Midnight Passport steps and the midnight.vote rows, as the landing titles them. */
const STEPS = [
  'One place for your money',
  'Show only what is asked.',
  'No seed phrase.',
  'A name, not a string of code.',
  'Your agents act for you',
] as const;
const ROWS = [
  'Understand before you answer.',
  'Polls for your own groups.',
  'Referendums, country by country.',
] as const;

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

/** Scrolls the pinned stage to a point of its timeline, in screens of scrolling. */
const scrollStage = (page: Page, screens: number) =>
  page.locator('.journey').evaluate((el, at) => {
    const total = 7.2; // the timeline's length in screens (PassportJourney.tsx)
    const top = window.scrollY + el.getBoundingClientRect().top;
    const distance = (el as HTMLElement).offsetHeight - innerHeight;
    window.scrollTo({ top: top + (distance * at) / total, behavior: 'instant' });
  }, screens);

for (const width of [320, 390]) {
  test(`the landing leads into the poll workspace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Your voice. Your choice. Your secret.',
    );
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`landing-${width}.png`) });

    // The header's way in, and back.
    await page
      .locator('.landing-header')
      .getByRole('button', { name: /Try a poll/u })
      .click();
    await expect(page).toHaveURL(/#polls$/u);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The rows after the passport are ways in too.
    const rows = page.getByRole('region', { name: /proves who you are/u });
    // with motion on, each row builds itself as it comes up
    await page.locator('.vote-row--groups').evaluate((row) => row.scrollIntoView());
    const organise = rows.getByRole('button', { name: /Set up a poll/u });
    await expect(organise).toBeVisible();
    await noOverflow(page);
    await organise.click();
    await expect(page).toHaveURL(/#organizer$/u);
  });
}

test('reduced motion lays the five steps and the three rows out as a page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.journey')).toHaveAttribute('data-motion', 'off');
  for (const title of [...STEPS, ...ROWS]) {
    const heading = page.getByRole('heading', { name: new RegExp(title, 'u') });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
  }
  await page.screenshot({ path: test.info().outputPath('landing-still.png'), fullPage: true });

  // the header steps aside while the page scrolls down; it is there again at the top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.landing-header').getByRole('link', { name: 'How it works' }).click();
  await expect(page.locator('#how-it-works')).toBeInViewport();
  await page
    .locator('.closeout')
    .getByRole('button', { name: /Get started/u })
    .click();
  await expect(page).toHaveURL(/#polls$/u);
});

test('the passport steps play forwards and back while the stage stays in place', async ({
  page,
}) => {
  // the steps are drawn in WebGL, which is slow in a headless browser's software renderer
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await expect(page.locator('.journey')).toHaveAttribute('data-motion', 'on');
  const stage = page.locator('.journey-stage');
  for (const index of [0, 1, 2, 3, 4, 2, 0]) {
    // the middle of each step: 3.0 screens in, 0.8 per step
    await scrollStage(page, 3.0 + index * 0.8 + 0.45);
    const step = page.locator(`.pc-part--${index + 1} .pc-part__text`);
    await expect(step).toHaveCSS('opacity', '1');
    await expect(step.getByRole('heading', { level: 3 })).toContainText(STEPS[index]);
    await expect.poll(async () => Math.round((await stage.boundingBox())?.y ?? -1)).toBe(0);
    if (index === 0 || index === 4)
      await page.screenshot({ path: test.info().outputPath(`step-${index + 1}.png`) });
  }
});

for (const width of [390, 1440]) {
  test(`the header stays usable over the stage at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    await scrollStage(page, 3.5);
    // scrolling back up brings the header back over the night
    await page.mouse.wheel(0, -200);
    const header = page.locator('.landing-header');
    await expect(header).toHaveAttribute('data-hidden', 'false');
    expect(
      await header.evaluate((bar) => {
        const r = bar.getBoundingClientRect();
        return [0.15, 0.5, 0.85].every((f) =>
          bar.contains(document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2)),
        );
      }),
    ).toBe(true);
    await noOverflow(page);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page
      .getByRole('navigation', { name: 'Footer navigation' })
      .getByRole('button', { name: 'Run a poll', exact: true })
      .click();
    await expect(page).toHaveURL(/#organizer$/u);
  });
}
