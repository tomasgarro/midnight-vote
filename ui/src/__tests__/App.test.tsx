import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CivicRuntime as App } from '../CivicRuntime';

/**
 * The onboarding is one straight line: welcome, what the three things are,
 * Passport, what Passport shared, the simulated pass, done. The country is
 * chosen on the eligibility screen rather than on a screen of its own.
 */
async function completeDemoCredential(user: ReturnType<typeof userEvent.setup>, country?: RegExp) {
  await user.click(screen.getByRole('button', { name: /Comenzar|Get started/i }));
  await user.click(screen.getByRole('button', { name: /Continuar|Continue/i }));
  await user.click(screen.getByRole('button', { name: /Passport de demo|demo Passport/i }));
  await user.click(screen.getByRole('button', { name: /Continuar|Continue/i }));
  await user.click(screen.getByText(/Probar con un pase simulado|Try with a simulated pass/i));
  // France is the default; the pilot's other country is one click away.
  if (country) await user.click(screen.getByRole('radio', { name: country }));
  await user.click(
    screen.getByRole('button', { name: /Crear mi pase simulado|Create my simulated pass/i }),
  );
  await user.click(
    screen.getByRole('button', { name: /Ver las consultas|See the consultations/i }),
  );
}

/** A place with consultations is a chip on the consultations page. */
async function choosePlace(user: ReturnType<typeof userEvent.setup>, place: RegExp | string) {
  const places = screen.getByRole('group', { name: /Alcance de las consultas|Consultation scope/ });
  await user.click(within(places).getByRole('button', { name: place }));
}

/** The bar renders only once onboarding is behind the reader. */
function skipOnboarding() {
  window.sessionStorage.setItem('cico-wave1-onboarding-complete', '1');
}

async function openYou(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^(Vos|You)$/ }));
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '#app');
  });

  it('opens the first visit on Welcome instead of the dashboard', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Tu voz\.\s*Tu elección\./ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Consultas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wallet' })).toBeNull();
  });

  it('treats first-run onboarding as a one-way journey before the dashboard', async () => {
    render(<App />);
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: /Volver a la app|Back to the app/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Comenzar|Get started/i }));
    expect(
      screen.getByRole('heading', { name: /Tu propia voz|A voice of your own/i }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Volver a la app|Back to the app/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Consultas' })).toBeNull();
  });

  /**
   * The confusion this product kept producing was three different things all
   * called "passport". The privacy stage is where they are separated, so it is
   * asserted by name: the Midnight account, the physical document, and the
   * small result that participating actually uses.
   */
  it('separates the Midnight account, the physical document and the eligibility pass', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Comenzar|Get started/i }));

    expect(screen.getByText(/divulgación selectiva/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText(/Vos elegís qué datos de perfil compartir/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Usar Passport de demo' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText(/Es distinto de tu cuenta Midnight Passport/)).toBeTruthy();
  });

  it('completes the Passport-first journey without scope, ballot, or wallet discovery', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);
    expect(screen.getByRole('heading', { name: 'Consultas' })).toBeTruthy();
    // The pass is French, so the page opens on France.
    expect(screen.getByRole('button', { name: /Francia/, pressed: true })).toBeTruthy();
    expect(screen.queryByText(/Passport v2|Paso 9|Elegí tu respuesta/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wallet' })).toBeNull();
  });

  it('carries three destinations, and the guide is one of them', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation', { name: 'Navegación principal' });
    const destinations = within(nav).getAllByRole('button');
    expect(destinations.map((button) => button.textContent?.trim())).toEqual([
      'Consultas',
      'Cleisthenes',
      'Vos',
    ]);
    // Exactly one destination is the current page, and every one can be.
    expect(destinations.map((button) => button.getAttribute('aria-current'))).toEqual([
      'page',
      null,
      null,
    ]);
    await user.click(within(nav).getByRole('button', { name: 'Cleisthenes' }));
    expect(
      within(nav).getByRole('button', { name: 'Cleisthenes' }).getAttribute('aria-current'),
    ).toBe('page');
    // The guide's face is decoration. His name is what a screen reader hears.
    expect(
      within(nav).getByRole('button', { name: 'Cleisthenes' }).querySelector('img'),
    ).toBeTruthy();
    expect(within(nav).queryByRole('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'midnight.vote' })).toBeTruthy();
  });

  it('keeps the civic pulse out of the three steps, at an address of its own', async () => {
    skipOnboarding();
    const { unmount } = render(<App />);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Consultas' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pulso cívico/i })).toBeNull();
    unmount();

    window.history.replaceState(null, '', '#app/pulse');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: /Empezá por lo\s*que te importa/iu }),
    ).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Volver a la app/i }));
    expect(screen.getByRole('heading', { name: 'Consultas' })).toBeTruthy();
    // Leaving the pulse leaves its address, so a reload opens the app.
    expect(window.location.hash).toBe('#app');
  });

  it('keeps the header quiet and opens settings from You', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();

    expect(screen.getByText('DEMO')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Cambiar idioma' })).toBeTruthy();
    // Feedback and settings moved to You. The header holds no button for them.
    expect(screen.queryByRole('button', { name: /Abrir feedback|Abrir ajustes/ })).toBeNull();
    expect(screen.queryByText('referendum.earth')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Abrir Midnight Passport|Conectar Midnight Passport/ }),
    ).toBeNull();

    await openYou(user);
    await user.click(screen.getByRole('button', { name: /^Ajustes/ }));
    expect(screen.getByRole('heading', { name: 'Ajustes' })).toBeTruthy();

    const darkMode = screen.getByRole('switch', { name: 'Modo oscuro' });
    expect(darkMode.getAttribute('aria-checked')).toBe('false');
    await user.click(darkMode);
    expect(darkMode.getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('button', { name: /Política de privacidad/ }));
    expect(screen.getByRole('heading', { name: 'Política de privacidad' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Volver' }));

    await user.click(screen.getByRole('button', { name: /Recuperación y backup/ }));
    expect(screen.getAllByText('Pronto').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/Nunca inventamos una clave privada/i)).toBeTruthy();
  });

  it('opens feedback from You', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();

    await openYou(user);
    await user.click(screen.getByRole('button', { name: /^Feedback/ }));
    expect(screen.getByRole('heading', { name: 'Ayuda y feedback' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Tu mensaje' })).toBeTruthy();
    expect(screen.getByText(/Tu mensaje llega a contact@midnight.vote/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar feedback' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  /**
   * Adding a pass is an action for someone who already has an account. Sending
   * a returning reader back through the welcome screen and a second consent
   * request was the fastest way to make the button feel like a trap.
   */
  it('opens verification at the document step once Passport is connected', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);

    await openYou(user);
    await user.click(screen.getByRole('button', { name: 'Ver el pase' }));
    await user.click(screen.getByRole('button', { name: 'Añadir otro pase' }));

    expect(screen.getByRole('heading', { name: /Tu pasaporte/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Comenzar|Get started/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Paso anterior|Previous step/i })).toBeNull();
  });

  /**
   * Browsing is not belonging. Opening Argentina while holding a French pass
   * must not present the reader as eligible there.
   */
  it('keeps country browsing separate from eligibility', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);

    expect(screen.getByText(/Esto no acredita elegibilidad/i)).toBeTruthy();

    // The demo issues a French pass. Argentina is browsable all the same, and
    // browsing it must not present the reader as eligible there.
    await choosePlace(user, 'Argentina');
    expect(screen.getByText(/Esto no acredita elegibilidad/i)).toBeTruthy();
    expect(screen.queryByText(/Pase registrado para/i)).toBeNull();
    // Every open Argentine consultation offers the way in, and none offers a vote.
    expect(screen.getAllByRole('button', { name: /Añadir elegibilidad/i }).length).toBeGreaterThan(
      0,
    );
    expect(
      screen
        .getByRole('region', { name: 'Argentina' })
        .querySelectorAll('.poll__actions button[data-variant="primary"]'),
    ).not.toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Argentina' }).textContent).not.toContain(
      'Participar',
    );

    await choosePlace(user, /Francia|France/i);
    expect(screen.getByText(/DEMO ·/i)).toBeTruthy();
  });

  it('lists one place at a time', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();

    expect(await screen.findByRole('region', { name: 'Global' })).toBeTruthy();
    await choosePlace(user, 'Argentina');
    expect(screen.getByRole('region', { name: 'Argentina' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Global' })).toBeNull();
  });

  it('offers five explicit test countries and an age choice', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Comenzar|Get started/i }));
    await user.click(screen.getByRole('button', { name: /Continuar|Continue/i }));
    await user.click(screen.getByRole('button', { name: /Passport de demo|demo Passport/i }));
    await user.click(screen.getByRole('button', { name: /Continuar|Continue/i }));

    await user.click(screen.getByText(/Probar con un pase simulado|Try with a simulated pass/i));
    expect(screen.getByRole('radio', { name: /Francia|France/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Argentina/i })).toBeTruthy();
    // The 249-country search was a dead end: every country but one led nowhere.
    expect(screen.queryByRole('radio', { name: /Brasil|Brazil/i })).toBeNull();
    expect(screen.getAllByRole('radio').length).toBe(5);
    expect(screen.getByLabelText('Edad de prueba')).toBeTruthy();
  });

  it('summarises the pass in You and shows it in full one step further', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);
    await openYou(user);

    expect(screen.getByRole('heading', { level: 2, name: /Francia · 18\+/ })).toBeTruthy();
    expect(screen.getByText(/Simulado para esta demo/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ver el pase' }));
    expect(screen.getByRole('heading', { name: /Elegibilidad, lista para usar/i })).toBeTruthy();
    expect(screen.getByText(/No es tu pasaporte físico/i)).toBeTruthy();
    // Exactly one active pass, named by the country it attests.
    expect(screen.getByRole('heading', { level: 2, name: /Francia|France/i })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Volver a Vos' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Vos' })).toBeTruthy();
  });

  it('shows the empty pass in You before anything has been verified', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();
    await openYou(user);

    expect(screen.getByRole('heading', { name: /Todavía no tenés un pase/i })).toBeTruthy();
    expect(screen.getByText(/Todavía no hay respuestas/)).toBeTruthy();
    expect(screen.getByText(/Sin conectar/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Añadir elegibilidad/i }));
    expect(screen.getByRole('heading', { name: /Tu pasaporte/i })).toBeTruthy();
  });

  it('creates a clearly labelled simulated receipt without a wallet', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);
    const [voteButton] = screen.getAllByRole('button', { name: /Participar/i });
    if (!voteButton) throw new Error('Expected at least one available consultation action');
    await user.click(voteButton);
    await user.click(screen.getByRole('button', { name: /^Sí/ }));
    await user.click(screen.getByRole('button', { name: /Revisar mi voto/i }));
    expect(screen.queryByRole('button', { name: 'Wallet' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Crear comprobante simulado/i }));
    // Confirmation awaits profile-key derivation and receipt storage before rendering.
    expect(await screen.findByRole('heading', { name: 'Gracias por participar' })).toBeTruthy();
    expect(screen.getByText(/No representa una transacción/i)).toBeTruthy();
  });

  /**
   * Receipts belong to the answers in You. Reaching them from a completed vote
   * must land there, not in the account screen.
   */
  it('keeps one receipt per simulated vote, in the answers', async () => {
    render(<App />);
    const user = userEvent.setup();
    // Argentina is the scope with several open consultations, so it is where
    // two distinct receipts can be produced.
    await completeDemoCredential(user, /Argentina/i);

    const castVote = async (index: number, answer: RegExp) => {
      const open = screen.getAllByRole('button', { name: /Participar/i });
      const button = open[index];
      if (!button) throw new Error(`Expected an open consultation at index ${index}`);
      await user.click(button);
      await user.click(screen.getByRole('button', { name: answer }));
      await user.click(screen.getByRole('button', { name: /Revisar mi voto/i }));
      await user.click(screen.getByRole('button', { name: /Crear comprobante simulado/i }));
      await user.click(await screen.findByRole('button', { name: /Ver mi comprobante/i }));
      expect(screen.getByRole('heading', { name: /Comprobantes de participación/i })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Consultas' }));
    };

    await castVote(0, /^Sí/);
    // Completed consultations leave the open list, so the next distinct one
    // becomes the first available action.
    await castVote(0, /^No/);
    await openYou(user);
    expect(screen.getByText(/comprobantes/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Tus respuestas/ }));

    // Every simulated receipt used to carry the identifier
    // 'demo-tx-cico-2026-0001'. Receipts are de-duplicated by id, so the
    // second vote silently deleted the first one. The vault is IndexedDB-backed
    // and survives beforeEach, so the assertion is about distinctness rather
    // than an exact count.
    const identifiers = [...document.querySelectorAll('.activity-card code')].map(
      (node) => node.textContent ?? '',
    );
    expect(identifiers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('verifies a receipt from the answers without leaving the device', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);
    const [voteButton] = screen.getAllByRole('button', { name: /Participar/i });
    if (!voteButton) throw new Error('Expected at least one available consultation action');
    await user.click(voteButton);
    await user.click(screen.getByRole('button', { name: /^Sí/ }));
    await user.click(screen.getByRole('button', { name: /Revisar mi voto/i }));
    await user.click(screen.getByRole('button', { name: /Crear comprobante simulado/i }));
    await user.click(await screen.findByRole('button', { name: /Ver mi comprobante/i }));

    expect(screen.getByRole('heading', { name: /Comprobantes de participación/i })).toBeTruthy();
    // The answers are one part of You, and You is the current destination.
    expect(screen.getByRole('button', { name: 'Vos' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Volver a Vos' })).toBeTruthy();

    // Simulated receipts are per-vote, so the lookup reads the identifier the
    // flow actually produced rather than a constant.
    const [receiptCode] = screen.getAllByText(/^demo-/);
    const receiptId = receiptCode?.textContent ?? '';
    expect(receiptId).toMatch(/^demo-[a-z0-9:-]+-[a-z0-9]+$/i);
    const input = screen.getByLabelText('Identificador del comprobante');
    await user.type(input, receiptId);
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText('Comprobante simulado')).toBeTruthy();
  });

  /**
   * The account screen is where Midnight is named as the account layer, and
   * where locking a session is kept distinct from destroying local data.
   */
  it('presents Passport as the account, with lock and delete kept apart', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);
    await openYou(user);
    expect(
      within(screen.getByRole('button', { name: /^Midnight Passport/ })).getByText('Conectado'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Midnight Passport/ }));

    expect(screen.getByText(/Midnight Passport conectado/i)).toBeTruthy();
    expect(screen.getByText(/Identificador de cuenta/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bloquear y conservar datos/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Eliminar datos locales/i })).toBeTruthy();
  });

  it('keeps the onboarding explanation available from the account screen', async () => {
    render(<App />);
    const user = userEvent.setup();
    await completeDemoCredential(user);
    await openYou(user);
    await user.click(screen.getByRole('button', { name: /^Midnight Passport/ }));
    expect(screen.queryByRole('button', { name: /Revisar cómo funciona/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Ayuda y seguridad/i }));
    expect(screen.getByRole('link', { name: /Identidad .night/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Revisar cómo funciona/i }));
    expect(screen.getByRole('heading', { name: /Tu voz\.\s*Tu elección\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Volver a la app|Back to the app/i })).toBeTruthy();
  });

  it('propagates English through the shell and the document metadata', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Cambiar idioma' }), 'en');

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Consultations', 'Cleisthenes', 'You']);
    expect(screen.getByRole('heading', { name: 'Consultations' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toMatch(/Civic Referendum/i);
  });

  it('reads public results without a credential or a Passport session', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Consultas' })).toBeTruthy();
    // Nothing was verified and no session exists, yet consultations render.
    expect(screen.queryByText(/Pase registrado para/i)).toBeNull();
    const places = screen.getByRole('group', { name: 'Alcance de las consultas' });
    expect(within(places).getByRole('button', { name: 'Global', pressed: true })).toBeTruthy();
    expect(within(places).getByRole('button', { name: /Francia/ })).toBeTruthy();
    expect(within(places).getByRole('button', { name: /Argentina/ })).toBeTruthy();

    // Every other place is in the sheet, behind the last chip.
    await user.click(within(places).getByRole('button', { name: 'Más lugares' }));
    expect(screen.getByRole('radio', { name: /Francia|France/i })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Alcance de las consultas' })).toBeTruthy();
  });

  it('opens the guide without a pass, and says what he is', async () => {
    skipOnboarding();
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cleisthenes' }));

    expect(screen.getByText('Guía del catálogo')).toBeTruthy();
    expect(screen.getByText(/Nunca digo cómo responder/)).toBeTruthy();
    expect(screen.getByText(/La IA generativa no está conectada/)).toBeTruthy();
  });
});
