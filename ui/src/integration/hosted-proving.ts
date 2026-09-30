/*
 * Hosted proving (ADR-010): a browser with no wallet lets the operator's
 * proving server build the proof. That server sees the answer and the pass
 * secret while it works, so the mode exists only after the person was shown
 * the disclosure below and accepted it.
 *
 * The acceptance is remembered on the device so a later visit can count the
 * sealed answer without asking again. It records a version: when the
 * disclosure text changes in substance, the version changes and the person is
 * asked again.
 */
import type { CicoLocale } from '@/integration/locale';

export const HOSTED_PROVING_DISCLOSURE_VERSION = 1;
const CONSENT_KEY = 'midnight-vote:hosted-proving-consent';

export interface HostedProvingConsent {
  readonly version: number;
  readonly acceptedAt: string;
}

export type ConsentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function deviceStorage(): ConsentStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Storage can be blocked outright; the person is then asked on every visit.
    return null;
  }
}

export function readHostedProvingConsent(
  storage: ConsentStorage | null = deviceStorage(),
): HostedProvingConsent | null {
  try {
    const raw = storage?.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { version, acceptedAt } = parsed as Record<string, unknown>;
    if (version !== HOSTED_PROVING_DISCLOSURE_VERSION) return null;
    if (typeof acceptedAt !== 'string' || !Number.isFinite(Date.parse(acceptedAt))) return null;
    return { version, acceptedAt };
  } catch {
    return null;
  }
}

export function acceptHostedProving(
  now: Date = new Date(),
  storage: ConsentStorage | null = deviceStorage(),
): HostedProvingConsent {
  const consent: HostedProvingConsent = {
    version: HOSTED_PROVING_DISCLOSURE_VERSION,
    acceptedAt: now.toISOString(),
  };
  try {
    storage?.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    // Accepted for this visit only.
  }
  return consent;
}

export function withdrawHostedProving(storage: ConsentStorage | null = deviceStorage()): void {
  try {
    storage?.removeItem(CONSENT_KEY);
  } catch {
    // Nothing was stored, so there is nothing to withdraw.
  }
}

/**
 * The proving server receives the witness, so its address must be HTTPS. Plain
 * HTTP is accepted for a local development host only. Anything else reads as
 * "not configured", which keeps the mode unavailable.
 */
export function resolveHostedProofServerUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return url.toString().replace(/\/$/u, '');
}

export const HOSTED_PROVING_COPY = {
  en: {
    title: 'This device cannot build the proof on its own',
    body: 'If you continue, our proving server builds it. While it works, that server can see your answer and your pass secret. We do not store or log them.',
    alternative: 'On a computer with the Lace wallet, the proof is built on your device instead.',
    accept: 'I understand, continue',
    withdraw: 'Stop using the proving server',
    provedBy: 'Proof built by',
    byServer: 'our proving server, which sees your answer while it works',
    byWallet: 'Lace, on this device',
    preparing: 'Getting the prover ready…',
    unavailable: 'The proof cannot be built right now. Try again later.',
  },
  es: {
    title: 'Este dispositivo no puede crear la prueba por sí solo',
    body: 'Si continuás, nuestro servidor de pruebas la crea. Mientras trabaja, ese servidor puede ver tu respuesta y el secreto de tu pase. No los guardamos ni los registramos.',
    alternative: 'En una computadora con la wallet Lace, la prueba se crea en tu dispositivo.',
    accept: 'Entiendo, continuar',
    withdraw: 'Dejar de usar el servidor de pruebas',
    provedBy: 'Quién crea la prueba',
    byServer: 'nuestro servidor de pruebas, que ve tu respuesta mientras trabaja',
    byWallet: 'Lace, en este dispositivo',
    preparing: 'Preparando la creación de la prueba…',
    unavailable: 'La prueba no se puede crear en este momento. Probá más tarde.',
  },
  fr: {
    title: 'Cet appareil ne peut pas produire la preuve seul',
    body: 'Si vous continuez, notre serveur de preuve la produit. Pendant ce calcul, ce serveur peut voir votre réponse et le secret de votre pass. Nous ne les conservons pas et ne les journalisons pas.',
    alternative:
      'Sur un ordinateur équipé du portefeuille Lace, la preuve est produite sur votre appareil.',
    accept: "J'ai compris, continuer",
    withdraw: 'Ne plus utiliser le serveur de preuve',
    provedBy: 'Preuve produite par',
    byServer: 'notre serveur de preuve, qui voit votre réponse pendant le calcul',
    byWallet: 'Lace, sur cet appareil',
    preparing: 'Préparation de la preuve…',
    unavailable: 'La preuve ne peut pas être produite pour le moment. Réessayez plus tard.',
  },
} as const satisfies Record<CicoLocale, Record<string, string>>;
