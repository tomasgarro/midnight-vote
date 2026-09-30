import { expect, test } from '@playwright/test';

test.use({ video: { mode: 'on', size: { width: 390, height: 844 } } });
const copy = {
  en: {
    start: 'Get started',
    next: 'Continue',
    demo: 'Use demo Passport',
    later: 'Do this later',
    skip: 'Skip for now',
    returning: 'Already have Passport? Connect',
  },
  es: {
    start: 'Comenzar',
    next: 'Continuar',
    demo: 'Usar Passport de demo',
    later: 'Hacerlo más tarde',
    skip: 'Omitir por ahora',
    returning: '¿Ya tenés Passport? Conectate',
  },
  fr: {
    start: 'Commencer',
    next: 'Continuer',
    demo: 'Utiliser le Passport de démo',
    later: 'Le faire plus tard',
    skip: 'Passer pour le moment',
    returning: 'Déjà un Passport ? Connectez-vous',
  },
};
for (const width of [320, 390, 768, 1440]) {
  for (const locale of ['en', 'es', 'fr'] as const) {
    test(`onboarding ${width}px ${locale}: defer, browse and resume`, async ({ page }) => {
      const t = copy[locale];
      await page.addInitScript(
        ({ locale }) => {
          localStorage.setItem('cico-locale', locale);
          localStorage.setItem('cico-theme', locale === 'fr' ? 'dark' : 'light');
        },
        { locale },
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#app');
      await expect(page.getByRole('button', { name: t.start, exact: true })).toBeVisible();
      const check = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(page.locator('.onboarding-screen h1')).toBeVisible();
        await page.screenshot({
          path: test.info().outputPath(`${name}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      };
      await check('welcome');
      await page.getByRole('button', { name: t.start, exact: true }).click();
      await check('privacy');
      await page.getByRole('button', { name: t.next, exact: true }).click();
      await check('passport');
      await page.getByRole('button', { name: t.demo, exact: true }).click();
      await page.getByRole('button', { name: t.next, exact: true }).click();
      await check('document');
      await page.getByRole('button', { name: t.later, exact: true }).click();
      await expect(page.locator('.onboarding-v3')).toHaveCount(0);
      await expect(page.getByRole('navigation')).toBeVisible();
      await page.getByRole('button', { name: /^(You|Vos|Vous)$/ }).click();
      await page
        .getByRole('button', {
          name: /^(Add eligibility|Añadir elegibilidad|Ajouter une éligibilité)$/,
        })
        .click();
      await expect(page.getByRole('button', { name: t.later, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: t.start, exact: true })).toHaveCount(0);
    });
  }
}

test('skip creates no pass; browser Back follows the actual path; reduced motion has static artwork', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cico-locale', 'en'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#app');
  await expect(page.locator('.onboarding-mascot img')).toBeVisible();
  // The figure is one picture, not drawn parts that move. Its pose badge is
  // an icon beside the picture, and it does not move either.
  await expect(page.locator('.onboarding-mascot__image svg')).toHaveCount(0);
  expect(
    await page
      .locator('.onboarding-mascot__image')
      .first()
      .evaluate((figure) => getComputedStyle(figure).animationName),
  ).toBe('none');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.goBack();
  await expect(page.locator('[data-stage="privacy"]')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No pass yet' })).toBeVisible();
});

test('nested document Back and enlarged text keep controls reachable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cico-locale', 'en'));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#app');
  await page.getByRole('button', { name: 'Already have Passport? Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Use demo Passport', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Verify my passport', exact: true }).click();
  const heading = page.locator('.verify-journey__title');
  const first = await heading.innerText();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(heading).not.toHaveText(first);
  await page.goBack();
  await expect(heading).toHaveText(first);
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verify my passport', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await expect(page.locator('[data-stage="passport"]')).toBeVisible();
  await page.addStyleTag({
    content: '.onboarding-screen p, .onboarding-screen button {font-size: 24px; line-height:1.5}',
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Do this later', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Do this later', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('enlarged-text.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('records the complete onboarding with its entry gestures', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cico-locale', 'en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#app');
  await expect(page.locator('.onboarding-mascot__image')).toBeVisible();
  // Hold each screen long enough to review the actual gesture in the recording.
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Use demo Passport', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByText('Try with a simulated pass', { exact: true }).click();
  await page.getByRole('button', { name: 'Create my simulated pass', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'See the consultations', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
});
