import type { Locator, Page } from '@playwright/test';

export class PassportJourneyPage {
  readonly openJourneyButton: Locator;
  readonly journeyHeading: Locator;
  readonly credentialHeading: Locator;
  readonly receiptHeading: Locator;
  readonly receiptId: Locator;

  constructor(private readonly page: Page) {
    this.openJourneyButton = page.getByRole('button', {
      name: /Comenzar|Get started|Commencer/i,
    });
    this.journeyHeading = page.getByRole('heading', {
      name: /Your voice\.\s*Your choice\.|Tu voz\.\s*Tu elección\./,
    });
    this.credentialHeading = page.getByRole('heading', {
      name: /Your simulated pass is ready|Tu pase simulado está listo/i,
    });
    this.receiptHeading = page.getByRole('heading', {
      name: /Thank you for participating|Gracias por participar/i,
    });
    // Simulated receipts carry a per-vote identifier, so match the shape.
    this.receiptId = page.getByText(/^demo-[a-z0-9:-]+-[a-z0-9]+$/i);
  }

  async open(): Promise<void> {
    await this.page.goto('/#app');
    await this.page.evaluate(() => window.sessionStorage.clear());
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    // Vite can finish the document navigation while the app is still
    // replacing the document. waitForFunction retries across that navigation
    // boundary, unlike an immediate evaluate(document.fonts.ready).
    await this.page.waitForFunction(() => document.fonts.status === 'loaded');
    await this.journeyHeading.waitFor();
  }

  async connectDemoPassport(): Promise<void> {
    await this.openJourneyButton.click();
    await this.page.getByRole('button', { name: /Continue|Continuar/i }).click();
    await this.page.getByRole('button', { name: /Use demo Passport|Passport de demo/i }).click();
    await this.page.getByRole('button', { name: /Continue|Continuar/i }).click();
  }

  async issueSyntheticCredential(): Promise<void> {
    await this.page.getByText(/Try with a simulated pass|Probar con un pase simulado/i).click();
    // The test-country choice moved onto the eligibility screen, so this is
    // one click rather than two.
    await this.page
      .getByRole('button', { name: /Create my simulated pass|Crear mi pase simulado/i })
      .click();
    await this.credentialHeading.waitFor();
  }

  async openDashboard(): Promise<void> {
    await this.page
      .getByRole('button', { name: /See the consultations|Ver las consultas/i })
      .click();
    await this.page
      .getByRole('heading', {
        name: /^(Consultations|Consultas)$/,
      })
      .waitFor();
  }

  async openConsultationAndVote(): Promise<void> {
    // The dashboard rebuild in the warm-light pass replaced
    // `article.dashboard-poll-card` (with an <h3> title) with a list of
    // `.poll` cards titled by an <h2>, and the vote flow no longer has an
    // "Elegí tu respuesta" heading or a "Tu compromiso" review screen. This
    // page object still described the old markup, which is why the headless
    // journey has been the one red check on every PR since.
    const openCard = this.page
      .locator('li', { has: this.page.locator('.poll') })
      .filter({
        has: this.page.getByRole('button', {
          name: /^(Vote now|Votá ahora|Participate|Participar)$/i,
        }),
      })
      .first();
    const pollTitle = (await openCard.locator('.poll__title').textContent())?.trim();
    if (!pollTitle) throw new Error('Expected at least one open consultation in the demo catalog');

    // Reach the ballot the long way, through the dossier, because that is the
    // path a reader who wants to know what they are voting on actually takes.
    await openCard
      .getByRole('button', { name: /Read proposal|View consultation|Leer propuesta|Ver consulta/i })
      .click();
    await this.page.getByRole('heading', { name: pollTitle, exact: true }).waitFor();
    await this.page
      .getByRole('button', { name: /^(Vote now|Votá ahora|Participate|Participar)$/i })
      .click();

    // The choice screen is titled by the consultation's own question.
    await this.page.locator('.flow__question').waitFor();
    await this.page.getByRole('button', { name: /^(Yes|Sí)/i }).click();
    await this.page.getByRole('button', { name: /Review my vote|Revisar mi voto/i }).click();
    await this.page
      .getByRole('heading', { name: /Review before confirming|Revisá antes de confirmar/i })
      .waitFor();
  }

  async submitSimulatedReceipt(): Promise<void> {
    await this.page
      .getByRole('button', { name: /Create simulated receipt|Crear comprobante simulado/i })
      .click();
    await this.receiptHeading.waitFor();
  }
}
