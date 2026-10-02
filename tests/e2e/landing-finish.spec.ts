import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`lakefront finish keeps navigation and arrow interactions usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    for (const selector of [
      '.midnight-hero__learn',
      '.how-panel:not([inert]) .how-action',
      '.finale-invitation .midnight-cta',
      '.finale-footer nav a[href="https://midnight.network"]',
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
      await page.keyboard.press('Tab');
      await action.focus();
      await expect(arrow).toHaveCSS(
        'transform',
        'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)',
      );
      await action.blur();
    }
    const landscape = page.locator('.finale-landscape img');
    await landscape.scrollIntoViewIfNeeded();
    await expect(landscape).toHaveJSProperty('naturalWidth', 1600);
    await expect(page.locator('.finale-guide-symbol')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`lakefront-${width}.png`) });
    const footer = page.locator('.finale-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toHaveCSS('background-color', 'rgb(37, 40, 35)');
    await expect(footer.getByRole('link', { name: 'Humans & agents' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`footer-${width}.png`) });
    await footer.getByRole('link', { name: 'How it works', exact: true }).click();
    await expect(page).toHaveURL(/#how-it-works/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const heroLink = page.locator('.midnight-hero__learn');
    await heroLink.hover();
    await expect(heroLink.locator('svg')).toHaveCSS('transform', 'none');
  });
}

for (const width of [320, 1440]) {
  test(`selective disclosure and the new city artwork stay readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/#discover');
    await expect(page.locator('.how-outro')).toHaveCSS('border-top-width', '0px');
    await expect(page.locator('.how-outro')).toHaveCSS('font-style', 'italic');
    await expect(page.locator('.how-outro')).toHaveCSS(
      'font-size',
      width === 320 ? '21px' : '26px',
    );
    const panel = page.locator('.future-panel');
    await expect(panel.getByText('On the horizon · Selective disclosure')).toBeVisible();
    await expect(panel.getByText('Starting now · AI for civic understanding')).toBeVisible();
    await expect(page.locator('.disclosure-proof')).toBeVisible();
    await page.locator('.disclosure-scene').scrollIntoViewIfNeeded();
    await expect(page.locator('.disclosure-proof')).toHaveCSS('opacity', '1');
    await page.screenshot({
      path: test.info().outputPath(`human-disclosure-${width}.png`),
      fullPage: true,
    });
    const toggle = page.getByRole('group', { name: 'Explore participation for humans or agents' });
    await toggle.getByRole('button', { name: /Agents/ }).click();
    const city = page.locator('.future-city-image');
    await expect(city).toHaveJSProperty('naturalWidth', 1122);
    await expect(page.locator('.future-city-note')).toHaveCount(0);
    expect((await city.boundingBox())?.height).toBeLessThan(480);
    await city.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`city-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await toggle.getByRole('button', { name: 'Humans', exact: true }).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.disclosure-proof')).toHaveCSS('animation-name', 'none');
  });
}
