import { expect, test } from '@playwright/test';

test.use({
  hasTouch: true,
  viewport: { width: 390, height: 844 },
  video: { mode: 'on', size: { width: 390, height: 844 } },
});
async function openDemo(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
    localStorage.setItem('cico-locale', 'en');
  });
  await page.goto('/#app');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Add eligibility', exact: true }).click();
  await page.getByRole('button', { name: /Try with a simulated pass/ }).click();
  await expect(page.getByLabel('Test age')).toBeVisible();
  await page.getByRole('radio', { name: 'Switzerland', exact: true }).check();
}
test('Swiss simulated pass, place chips, carousel, filters and dialogue', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Test age').fill('35');
  await page.screenshot({ path: 'outputs/demo-pass-390.png' });
  await page.getByRole('button', { name: 'Create my simulated pass' }).click();
  await page.getByRole('button', { name: 'See the consultations', exact: true }).click();
  const places = page.getByRole('group', { name: 'Consultation scope' });
  await expect(places.getByRole('button', { name: 'Switzerland' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // One place at a time: the four federal objects of 29 November, and no filter for four.
  await expect(page.locator('.votes__results h2')).toHaveText(['Switzerland']);
  await expect(page.locator('.discovery-rail > li')).toHaveCount(4);
  await expect(page.locator('.discovery-subjects')).toBeHidden();
  expect(
    await page
      .locator('.poll')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(650);
  await page.locator('.votes__results').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'outputs/swiss-cards-390.png' });
  await page.getByRole('button', { name: 'Next consultation', exact: true }).last().click();
  await expect
    .poll(() =>
      page
        .locator('.discovery-rail')
        .last()
        .evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Previous consultation', exact: true }).last().click();
  await expect
    .poll(() =>
      page
        .locator('.discovery-rail')
        .last()
        .evaluate((el) => el.scrollLeft),
    )
    .toBeLessThan(5);
  const bounds = await page
    .locator('.votes__results')
    .last()
    .locator('.poll-media')
    .first()
    .boundingBox();
  if (!bounds) throw Error('Missing media bounds');
  const cdp = await page.context().newCDPSession(page);
  const y = Math.max(120, bounds.y + 80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (const x of [260, 220, 180, 140, 100, 60])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(() =>
      page
        .locator('.discovery-rail')
        .last()
        .evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(100);
  await cdp.detach();
  // Argentina has five, so its list can be shortened by subject.
  await places.getByRole('button', { name: 'Argentina' }).click();
  await expect(page.locator('.discovery-rail > li')).toHaveCount(5);
  await page.getByRole('button', { name: 'Nature & climate', exact: true }).click();
  await expect(page.locator('.discovery-rail > li')).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Energy, tariffs, and the renewable transition' }),
  ).toBeVisible();
  // A place without consultations is in the sheet, and gets a chip once chosen.
  await places.getByRole('button', { name: 'More places' }).click();
  await page.getByRole('searchbox', { name: 'Consultation scope' }).fill('Japan');
  await page.getByRole('radio', { name: /Japan/ }).click();
  await expect(places.getByRole('button', { name: 'Japan' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('No consultations are published in this scope yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Cleisthenes', exact: true }).click();
  await page
    .getByRole('button', { name: 'What consultations are open for me?', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Limiting fireworks' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A minimum age for social media?' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('age input validation and under-18 demo does not enable participation', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Test age').fill('121');
  await expect(page.getByRole('button', { name: 'Create my simulated pass' })).toBeDisabled();
  await page.getByLabel('Test age').fill('16');
  await page.getByRole('button', { name: 'Create my simulated pass' }).click();
  await expect(page.getByText('< 18', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'See the consultations', exact: true }).click();
  await expect(
    page.locator('.poll__actions button').filter({ hasText: '18+' }).first(),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'View consultation', exact: true }).first().click();
  await expect(
    page.getByRole('button', { name: 'Valid country pass required · 18+', exact: true }),
  ).toBeDisabled();
});

test('supports additional test countries and preserves age when going back', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Test age').fill('42');
  await page.getByRole('button', { name: 'More countries', exact: true }).click();
  await page.getByRole('searchbox').fill('Germany');
  await page.getByRole('radio', { name: /Germany/ }).check();
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await page.getByRole('button', { name: /Try with a simulated pass/ }).click();
  await expect(page.getByLabel('Test age')).toHaveValue('42');
  await expect(page.getByRole('radio', { name: 'Germany', exact: true })).toBeChecked();
});

test('French Swiss cards and demo form fit a 320px dark phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
    localStorage.setItem('cico-locale', 'fr');
    localStorage.setItem('cico-theme', 'dark');
  });
  await page.goto('/#app');
  await page.getByRole('button', { name: 'Vous', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une éligibilité', exact: true }).click();
  await page.getByRole('button', { name: /Essayer un laissez-passer simulé/ }).click();
  await page.getByRole('radio', { name: 'Suisse', exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Créer mon laissez-passer simulé', exact: true }).click();
  await page.getByRole('button', { name: 'Voir les consultations', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Limiter les feux d’artifice', exact: true }),
  ).toBeVisible();
  await page.locator('.votes__results').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'outputs/swiss-cards-320-fr-dark.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
