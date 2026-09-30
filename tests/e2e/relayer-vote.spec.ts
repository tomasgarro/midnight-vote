import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __cicoInjectFixtureSecret: boolean;
  }
}

const runRelayer = process.env.CICO_E2E_RELAYER === '1';
const fixtureSecretHex = process.env.CICO_E2E_FIXTURE_SECRET_HEX?.trim().toLowerCase() ?? '';
const hasFixtureSecret = /^[0-9a-f]{64}$/u.test(fixtureSecretHex);

// The browser has no wallet in this lane, so the proof is built by the local
// proving server named in VITE_HOSTED_PROOF_SERVER_URL (ADR-010). The journey
// must pass through the disclosure before it can confirm.
test('seals a browser answer through the local relayer and proving server', async ({
  page,
  context,
}) => {
  test.skip(!runRelayer, 'Set CICO_E2E_RELAYER=1 for the opt-in local chain lane.');
  test.skip(
    !hasFixtureSecret,
    'Set CICO_E2E_FIXTURE_SECRET_HEX to the ephemeral secret whose commitment was issued locally.',
  );

  await context.addInitScript({
    content: `
      window.__cicoInjectFixtureSecret = false;
      const fixtureSecretHex = ${JSON.stringify(fixtureSecretHex)};
      const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
      Object.defineProperty(crypto, 'getRandomValues', {
        configurable: true,
        value: function (array) {
          if (window.__cicoInjectFixtureSecret && array.byteLength === 32) {
            for (let index = 0; index < array.length; index += 1) {
              array[index] = Number.parseInt(
                fixtureSecretHex.slice(index * 2, index * 2 + 2),
                16,
              );
            }
            window.__cicoInjectFixtureSecret = false;
            return array;
          }
          return originalGetRandomValues(array);
        },
      });
    `,
  });

  await page.goto('/#app');
  await page.getByRole('button', { name: /Votá ahora/i }).waitFor();
  await page.evaluate(() => {
    window.__cicoInjectFixtureSecret = true;
  });
  await page.getByRole('button', { name: /Votá ahora/i }).click();

  // "Antes de votar" and "Listo, podés votar" were the two vote-flow stages
  // nothing could reach -- `startVote` has always gone straight to the choice
  // screen for a credentialled voter. They are deleted, so the ballot is the
  // first thing this journey sees.
  await page.locator('.flow__question').waitFor();
  await page.getByRole('button', { name: /^Sí/ }).click();
  await page.getByRole('button', { name: /Revisar mi voto/i }).click();
  await page.getByRole('heading', { name: 'Revisá antes de confirmar' }).waitFor();
  await expect(page.getByText(/puede ver tu respuesta y el secreto de tu pase/u)).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirmar acción real/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Entiendo, continuar' }).click();
  await page.getByRole('button', { name: /Confirmar acción real/i }).click();
  await page.getByRole('heading', { name: 'Preparando tu comprobante' }).waitFor();
  await page
    .getByRole('heading', { name: 'Tu respuesta está sellada' })
    .waitFor({ timeout: 180_000 });
  // The receipt of a sealed answer names no transaction.
  await expect(page.locator('.flow__code')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /explorer/i })).toHaveCount(0);
});
