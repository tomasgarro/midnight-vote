/*
 * How a browser without a wallet builds its proofs.
 *
 * There are two ways, and the person chooses:
 *
 * - `device`: Midnight's WASM prover runs in this browser (ADR-011). Nothing
 *   about the answer is sent to a proving server. It is slow: minutes.
 * - `hosted-server`: the operator's proving server builds the proof
 *   (ADR-010). It is fast, and that server sees the answer and the pass secret
 *   while it works, so it is used only after the person accepts a disclosure.
 *
 * The device is the default wherever it is available. The choice is remembered
 * on the device, so a later visit can count a sealed answer the same way.
 */
import type { CicoLocale } from '@/integration/locale';

export type WalletlessProver = 'device' | 'hosted-server';

export interface WalletlessProvingState {
  /** No wallet is connected, and this build can prove without one. */
  readonly offered: boolean;
  readonly deviceAvailable: boolean;
  readonly hostedAvailable: boolean;
  readonly selected: WalletlessProver | null;
  /** The person accepted what the proving server can see. */
  readonly hostedAccepted: boolean;
  /** A prover is chosen and usable, and its providers are still being composed. */
  readonly preparing: boolean;
  readonly error: string | null;
  readonly chooseDevice: () => void;
  /** Selects the proving server. Nothing is sent to it before `acceptHosted`. */
  readonly chooseHosted: () => void;
  readonly acceptHosted: () => void;
  readonly withdrawHosted: () => void;
}

/** True while the chosen prover is the server and its disclosure is not accepted. */
export function needsHostedConsent(
  state: Pick<WalletlessProvingState, 'offered' | 'selected' | 'hostedAccepted'> | undefined,
): boolean {
  return Boolean(state?.offered && state.selected === 'hosted-server' && !state.hostedAccepted);
}

export type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const CHOICE_KEY = 'midnight-vote:walletless-prover';

function deviceStorage(): ChoiceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readProverChoice(
  storage: ChoiceStorage | null = deviceStorage(),
): WalletlessProver | null {
  try {
    const stored = storage?.getItem(CHOICE_KEY);
    return stored === 'device' || stored === 'hosted-server' ? stored : null;
  } catch {
    return null;
  }
}

export function rememberProverChoice(
  choice: WalletlessProver,
  storage: ChoiceStorage | null = deviceStorage(),
): void {
  try {
    storage?.setItem(CHOICE_KEY, choice);
  } catch {
    // Remembered for this visit only.
  }
}

/**
 * The prover in effect. A remembered choice holds only while that prover is
 * still available; otherwise the device comes first.
 */
export function resolveProver(input: {
  readonly deviceAvailable: boolean;
  readonly hostedAvailable: boolean;
  readonly choice: WalletlessProver | null;
}): WalletlessProver | null {
  if (input.choice === 'device' && input.deviceAvailable) return 'device';
  if (input.choice === 'hosted-server' && input.hostedAvailable) return 'hosted-server';
  if (input.deviceAvailable) return 'device';
  return input.hostedAvailable ? 'hosted-server' : null;
}

/**
 * Where the public parameter files are served. Same-origin by default, so
 * building a proof tells no third party that this person is doing so.
 */
export function resolveDeviceParamsUrl(
  raw: string | null | undefined,
  origin: string,
): string | null {
  const value = raw?.trim() || '/zk-params';
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return url.toString().replace(/\/$/u, '');
}

/** Minutes and seconds, for the time a proof has been running. */
export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const WALLETLESS_PROVING_COPY = {
  en: {
    legend: 'Where the proof is built',
    deviceTitle: 'On this device',
    deviceBody:
      'Takes a few minutes, longer on a phone. Keep this page open. Your answer is not sent to any server until it is counted.',
    hostedTitle: 'On our proving server',
    hostedBody:
      'Takes about a minute. While it works, the server can see your answer and your pass secret.',
    deviceProcessing:
      'This device is building the proof. Keep this page open and the screen on. The relay then pays the fee and submits.',
    deviceWait: 'This takes a few minutes, longer on a phone.',
    elapsed: 'Time so far',
    byDevice: 'this device',
  },
  es: {
    legend: 'Dónde se crea la prueba',
    deviceTitle: 'En este dispositivo',
    deviceBody:
      'Tarda unos minutos, más en un teléfono. Dejá esta página abierta. Tu respuesta no se envía a ningún servidor hasta que se cuenta.',
    hostedTitle: 'En nuestro servidor de pruebas',
    hostedBody:
      'Tarda cerca de un minuto. Mientras trabaja, el servidor puede ver tu respuesta y el secreto de tu pase.',
    deviceProcessing:
      'Este dispositivo está creando la prueba. Dejá esta página abierta y la pantalla encendida. Después el relay paga la tarifa y envía.',
    deviceWait: 'Esto tarda unos minutos, más en un teléfono.',
    elapsed: 'Tiempo transcurrido',
    byDevice: 'este dispositivo',
  },
  fr: {
    legend: 'Où la preuve est produite',
    deviceTitle: 'Sur cet appareil',
    deviceBody:
      "Quelques minutes, davantage sur un téléphone. Gardez cette page ouverte. Votre réponse n'est envoyée à aucun serveur avant d'être comptée.",
    hostedTitle: 'Sur notre serveur de preuve',
    hostedBody:
      'Environ une minute. Pendant ce calcul, le serveur peut voir votre réponse et le secret de votre pass.',
    deviceProcessing:
      "Cet appareil produit la preuve. Gardez cette page ouverte et l'écran allumé. Le relais paie ensuite les frais et soumet.",
    deviceWait: 'Cela prend quelques minutes, davantage sur un téléphone.',
    elapsed: 'Temps écoulé',
    byDevice: 'cet appareil',
  },
} as const satisfies Record<CicoLocale, Record<string, string>>;
