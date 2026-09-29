import { expect, test } from '@playwright/test';

test.use({ video: { mode: 'on', size: { width: 390, height: 900 } } });

for (const width of [320, 390]) {
  test(`landing to full demo onboarding stays usable at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Your voice.Your choice.Your secret.',
    );
    await page.screenshot({ path: test.info().outputPath(`landing-${width}.png`), fullPage: true });
    const noOverflow = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    };
    await noOverflow();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('link', { name: 'How it works', exact: true })
      .click();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
    await expect(page.getByRole('heading', { name: /A little less exposure/ })).toBeInViewport();
    await page.getByRole('button', { name: 'Explore Passport', exact: true }).click();
    await expect(
      page.getByRole('heading', {
        name: /Your voice\.\s*Your choice\.|Tu voz\.\s*Tu elección\./,
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`welcome-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await expect(page.getByRole('heading', { name: /A voice of your own/ })).toBeVisible();
    await expect(page.getByText('Try a zero-knowledge proof')).toHaveCount(0);
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath(`privacy-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: /Meet your\s*Midnight Passport/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Previous step' }).click();
    await expect(page.getByRole('heading', { name: /A voice of your own/ })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.screenshot({
      path: test.info().outputPath(`passport-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Use demo Passport', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Demo profile selected');
    await page.screenshot({ path: test.info().outputPath(`consent-${width}.png`), fullPage: true });
    await noOverflow();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: /Your passport\.\s*Just the essentials/ }),
    ).toBeVisible();
    await page.getByText('Try with a simulated pass', { exact: true }).click();
    // The native radio is visually hidden; users tap its visible label.
    await page.getByRole('radio', { name: 'Argentina', exact: true }).check();
    await expect(page.getByRole('radio', { name: /Argentina/ })).toBeChecked();
    await page.screenshot({
      path: test.info().outputPath(`eligibility-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Create my simulated pass', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your simulated pass is ready.' }),
    ).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: test.info().outputPath(`success-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'See the consultations', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Try the civic pulse', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: /Your voice\.\s*Your choice\.|Tu voz\.\s*Tu elección\./,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Try the civic pulse', exact: true }),
    ).toBeVisible();
    await noOverflow();
  });
}

test('reduced motion keeps the proof interaction and landing navigation functional', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.civic-art__view')).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('button', { name: 'Pause background animation' })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('landing-desktop.png'), fullPage: true });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Our purpose', exact: true })
    .click();
  await expect(page.locator('.finale-quote blockquote')).toBeInViewport();
  await page.getByRole('button', { name: 'Get started', exact: true }).first().click();
  await expect(
    page.getByRole('heading', {
      name: /Your voice\.\s*Your choice\.|Tu voz\.\s*Tu elección\./,
      exact: true,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator('.finale-quote blockquote')).toBeVisible();
});

test('desktop story advances, reverses, and keeps the stage in place', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/#how-it-works');
  const track = page.locator('.how-track');
  const stage = page.locator('.how-stage');
  await expect(track).toHaveAttribute('data-pinned', 'true');
  const intro = page.locator('.how-intro');
  for (const fraction of [0, 1, 0]) {
    await intro.evaluate((el, fraction) => {
      const top = scrollY + el.getBoundingClientRect().top - 110;
      scrollTo({
        top: top + (el.clientHeight - (innerHeight - 110)) * fraction,
        behavior: 'instant',
      });
    }, fraction);
    await expect
      .poll(() => intro.evaluate((el) => Number(el.style.getPropertyValue('--headline-progress'))))
      .toBe(fraction);
    await page.screenshot({ path: test.info().outputPath(`headline-${fraction}.png`) });
  }
  const move = async (fraction: number) => {
    await track.evaluate((el, fraction) => {
      const stage = el.querySelector('.how-stage') as HTMLElement;
      const top = window.scrollY + el.getBoundingClientRect().top - 110;
      window.scrollTo({
        top: top + ((el as HTMLElement).offsetHeight - stage.offsetHeight) * fraction,
        behavior: 'instant',
      });
    }, fraction);
  };
  for (const [fraction, step] of [
    [0.08, '1'],
    [0.45, '2'],
    [0.8, '3'],
    [0.45, '2'],
    [0.08, '1'],
  ] as const) {
    await move(fraction);
    await expect(track).toHaveAttribute('data-step', step);
    await expect.poll(async () => Math.round((await stage.boundingBox())?.y ?? -1)).toBe(110);
    await expect(page.locator('.how-panel:not([inert])')).toHaveCount(1);
    const navigation = await page.locator('.how-progress').boundingBox();
    const artwork = await page.locator('.how-panel:not([inert]) .how-art').boundingBox();
    expect(navigation && artwork && navigation.y + navigation.height <= artwork.y).toBeTruthy();
    await expect(page.locator('.how-panel:not([inert])')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: test.info().outputPath(`story-step-${step}.png`) });
  }
  await page.getByRole('button', { name: '03 Participate' }).click();
  await expect(track).toHaveAttribute('data-step', '3');
  await page.getByRole('button', { name: '01 Connect' }).click();
  await expect(track).toHaveAttribute('data-step', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(track).toHaveAttribute('data-pinned', 'false');
  await expect(page.locator('.how-panel:not([inert])')).toHaveCount(3);
  expect(await stage.evaluate((el) => getComputedStyle(el).position)).toBe('static');
});

for (const width of [390, 1440]) {
  test(`finale toggle and navbar stacking stay usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    await page
      .locator('.how-art')
      .first()
      .evaluate((el) => {
        window.scrollTo({
          top: window.scrollY + el.getBoundingClientRect().top - 30,
          behavior: 'instant',
        });
      });
    expect(
      await page.locator('.midnight-nav').evaluate((nav) => {
        const r = nav.getBoundingClientRect();
        return [0.15, 0.5, 0.85].every((f) =>
          nav.contains(document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2)),
        );
      }),
    ).toBe(true);
    if (width === 390) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    const toggle = page.getByRole('group', { name: 'Explore participation for humans or agents' });
    await toggle.getByRole('button', { name: /Agents/ }).click();
    await expect(toggle.getByRole('button', { name: /Agents/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('heading', { name: /What could a city/ })).toBeVisible();
    await expect(
      page.getByText('It is not available in this demo.', { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`finale-agents-${width}.png`),
      fullPage: true,
    });
    await toggle.getByRole('button', { name: 'Humans', exact: true }).click();
    await expect(page.getByRole('heading', { name: /More informed/ })).toBeVisible();
    await expect(page.locator('.civic-landing .capybara-mascot')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('navigation', { name: 'Footer navigation' })
      .getByRole('link', { name: 'Our purpose' })
      .click();
    await expect(page.locator('.finale-quote blockquote')).toBeInViewport();
  });
}
