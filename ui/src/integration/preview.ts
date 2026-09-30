import type { CicoLocale } from '@/integration/locale';

export type PreviewReadinessState = 'demo' | 'blocked' | 'loading' | 'ready';
export type PublicReadinessState = 'demo' | 'blocked' | 'loading' | 'ready';

export interface PreviewReadiness {
  state: PreviewReadinessState;
  label: string;
  message: string;
}

export interface PublicReadiness {
  state: PublicReadinessState;
  label: string;
  message: string;
}

export interface PreviewReadinessInput {
  appMode: 'demo' | 'preview' | 'undeployed';
  contractAddress: string | null;
  walletConnected: boolean;
  providersReady: boolean;
  providersError?: string | null;
  /** Sponsored-relayer path: the citizen needs no wallet at all. */
  relayerMode?: boolean;
  /** A configured v2 catalog changes the action contract: no legacy fallback. */
  v2RuntimeConfigured?: boolean;
  /** True only after a provider-backed credential has been issued and verified. */
  credentialVerified?: boolean;
  /**
   * Proving without a wallet: on the device (ADR-011) or on the proving
   * server (ADR-010). `needs-consent` means the server is chosen and the
   * person has not yet accepted what it can see.
   */
  walletlessProving?: 'not-offered' | 'needs-consent' | 'preparing' | 'failed' | 'ready';
}

export interface PublicReadinessInput {
  appMode: 'demo' | 'preview' | 'undeployed';
  contractAddress: string | null;
  publicProviderReady: boolean;
  publicProviderError?: string | null;
}

export interface RuntimeReferendumIdentity {
  readonly referendumId: string;
}

/**
 * What the app says when an action cannot start, in the reader's language.
 *
 * These lines were Spanish only. A French reader who sealed an answer on a
 * phone read a Spanish refusal at the one moment the app had to be clear.
 * `network` is the name of the network and is the same in every language.
 */
const COPY = {
  es: {
    localNetwork: 'Undeployed local',
    routeInvalid: (detail: string) =>
      `La configuración Passport v2 es inválida; el voto fue bloqueado: ${detail}`,
    routeCredential:
      'La acción v2 requiere una credencial Passport verificada; no se usará una fixture.',
    routeIncomplete:
      'La consulta no tiene una configuración v2 completa para esta red; el voto fue bloqueado.',
    demoLabel: 'Solo lectura local',
    demoMessage:
      'El modo local permite revisar la interfaz, pero no confirma votos ni crea comprobantes. Configurá Preview para enviar una transacción real.',
    contractLabel: (network: string) => `${network} requiere contrato`,
    contractMessage: (network: string) =>
      `${network} no está configurado: cargá un catálogo v2 firmado con un contrato desplegado en esta red.`,
    unavailableLabel: (network: string) => `${network} no disponible`,
    providersMessage: (detail: string) =>
      `No se pudieron preparar los proveedores de Midnight: ${detail}`,
    credentialLabel: (network: string) => `${network} requiere credencial`,
    credentialMessage:
      'La acción v2 requiere una credencial Passport verificada. No se usará una fixture ni el flujo de voto legado como alternativa.',
    consentLabel: (network: string) => `${network} necesita tu acuerdo`,
    consentMessage:
      'Este dispositivo no tiene wallet. Leé el aviso sobre el servidor de pruebas y aceptalo para continuar, o conectá Lace en una computadora.',
    proofFailed: 'No se pudo preparar la creación de la prueba. Probá de nuevo más tarde.',
    preparingLabel: (network: string) => `Preparando ${network}`,
    proofPreparing: 'Preparando la creación de la prueba.',
    walletLabel: (network: string) => `${network} requiere wallet`,
    walletMessage: (network: string) =>
      `Conectá un wallet DApp Connector en ${network} para aprobar y balancear la transacción.`,
    providersPreparing: (network: string) =>
      `La wallet está conectada, pero los proveedores de ${network} todavía se están preparando.`,
    readyLabel: (network: string) => `${network} listo`,
    readyMessage: (network: string) => `${network} está listo para preparar una transacción real.`,
    publicDemo: 'El modo demo no consulta una red ni presenta estado canónico.',
    publicContract: (network: string) =>
      `${network} no está configurado: cargá el catálogo v2 para leer el estado público.`,
    publicError: (network: string, detail: string) =>
      `No se pudo leer el estado público de ${network}: ${detail}`,
    publicPreparingLabel: (network: string) => `Preparando lectura de ${network}`,
    publicPreparing: (network: string) => `El indexer de ${network} todavía se está preparando.`,
    publicReadyLabel: (network: string) => `Lectura ${network} lista`,
    publicReady: (network: string) =>
      `El estado público de ${network} se puede consultar sin conectar una wallet.`,
  },
  en: {
    localNetwork: 'Undeployed local',
    routeInvalid: (detail: string) =>
      `The Passport v2 configuration is not valid, so the answer was blocked: ${detail}`,
    routeCredential:
      'This action needs a verified Passport credential. A fixture will not be used in its place.',
    routeIncomplete:
      'This consultation has no complete v2 configuration for this network, so the answer was blocked.',
    demoLabel: 'Local, read only',
    demoMessage:
      'The local mode shows the interface. It confirms no answer and creates no receipt. Configure Preview to send a real transaction.',
    contractLabel: (network: string) => `${network} needs a contract`,
    contractMessage: (network: string) =>
      `${network} is not configured: load a signed v2 catalogue with a contract deployed on this network.`,
    unavailableLabel: (network: string) => `${network} is not available`,
    providersMessage: (detail: string) => `The Midnight providers could not be prepared: ${detail}`,
    credentialLabel: (network: string) => `${network} needs a credential`,
    credentialMessage:
      'This action needs a verified Passport credential. Neither a fixture nor the legacy flow will be used in its place.',
    consentLabel: (network: string) => `${network} needs your agreement`,
    consentMessage:
      'This device has no wallet. Read the notice about the proving server and accept it to continue, or connect Lace on a computer.',
    proofFailed: 'The proof could not be prepared. Try again later.',
    preparingLabel: (network: string) => `Preparing ${network}`,
    proofPreparing: 'Getting ready to build the proof.',
    walletLabel: (network: string) => `${network} needs a wallet`,
    walletMessage: (network: string) =>
      `Connect a DApp Connector wallet on ${network} to approve and balance the transaction.`,
    providersPreparing: (network: string) =>
      `The wallet is connected, but the ${network} providers are still being prepared.`,
    readyLabel: (network: string) => `${network} is ready`,
    readyMessage: (network: string) => `${network} is ready to prepare a real transaction.`,
    publicDemo: 'The demo mode reads no network and shows no canonical state.',
    publicContract: (network: string) =>
      `${network} is not configured: load the v2 catalogue to read the public state.`,
    publicError: (network: string, detail: string) =>
      `The public state of ${network} could not be read: ${detail}`,
    publicPreparingLabel: (network: string) => `Preparing to read ${network}`,
    publicPreparing: (network: string) => `The ${network} indexer is still being prepared.`,
    publicReadyLabel: (network: string) => `${network} can be read`,
    publicReady: (network: string) =>
      `The public state of ${network} can be read without connecting a wallet.`,
  },
  fr: {
    localNetwork: 'Undeployed local',
    routeInvalid: (detail: string) =>
      `La configuration Passport v2 n’est pas valide ; la réponse a été bloquée : ${detail}`,
    routeCredential:
      'Cette action exige un justificatif Passport vérifié. Aucun justificatif de test ne le remplacera.',
    routeIncomplete:
      'Cette consultation n’a pas de configuration v2 complète pour ce réseau ; la réponse a été bloquée.',
    demoLabel: 'Local, lecture seule',
    demoMessage:
      'Le mode local montre l’interface. Il ne confirme aucune réponse et ne crée aucun reçu. Configurez Preview pour envoyer une vraie transaction.',
    contractLabel: (network: string) => `${network} exige un contrat`,
    contractMessage: (network: string) =>
      `${network} n’est pas configuré : chargez un catalogue v2 signé, avec un contrat déployé sur ce réseau.`,
    unavailableLabel: (network: string) => `${network} indisponible`,
    providersMessage: (detail: string) =>
      `Les fournisseurs Midnight n’ont pas pu être préparés : ${detail}`,
    credentialLabel: (network: string) => `${network} exige un justificatif`,
    credentialMessage:
      'Cette action exige un justificatif Passport vérifié. Ni un justificatif de test ni l’ancien parcours ne le remplaceront.',
    consentLabel: (network: string) => `${network} a besoin de votre accord`,
    consentMessage:
      'Cet appareil n’a pas de portefeuille. Lisez l’avis sur le serveur de preuve et acceptez-le pour continuer, ou connectez Lace sur un ordinateur.',
    proofFailed: 'La preuve n’a pas pu être préparée. Réessayez plus tard.',
    preparingLabel: (network: string) => `Préparation de ${network}`,
    proofPreparing: 'Préparation de la preuve.',
    walletLabel: (network: string) => `${network} exige un portefeuille`,
    walletMessage: (network: string) =>
      `Connectez un portefeuille DApp Connector sur ${network} pour approuver et équilibrer la transaction.`,
    providersPreparing: (network: string) =>
      `Le portefeuille est connecté, mais les fournisseurs de ${network} sont encore en préparation.`,
    readyLabel: (network: string) => `${network} est prêt`,
    readyMessage: (network: string) => `${network} est prêt à préparer une vraie transaction.`,
    publicDemo: 'Le mode démo ne lit aucun réseau et ne montre aucun état canonique.',
    publicContract: (network: string) =>
      `${network} n’est pas configuré : chargez le catalogue v2 pour lire l’état public.`,
    publicError: (network: string, detail: string) =>
      `L’état public de ${network} n’a pas pu être lu : ${detail}`,
    publicPreparingLabel: (network: string) => `Préparation de la lecture de ${network}`,
    publicPreparing: (network: string) => `L’indexeur de ${network} est encore en préparation.`,
    publicReadyLabel: (network: string) => `${network} peut être lu`,
    publicReady: (network: string) =>
      `L’état public de ${network} peut être lu sans connecter de portefeuille.`,
  },
} as const;

/**
 * Runtime catalogs may namespace a product poll (`poll:world`) while the UI
 * keeps the stable product ID (`poll`). Prefix matching is accepted only when
 * it is unambiguous; an ambiguous catalog fails closed.
 */
export function findRuntimeReferendum<T extends RuntimeReferendumIdentity>(
  referenda: readonly T[],
  pollId: string,
): T | null {
  const exact = referenda.filter((entry) => entry.referendumId === pollId);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const namespaced = referenda.filter((entry) => entry.referendumId.startsWith(`${pollId}:`));
  return namespaced.length === 1 ? (namespaced[0] ?? null) : null;
}

export type PassportV2ActionRoute =
  | { readonly mode: 'legacy' }
  | { readonly mode: 'v2'; readonly referendumId: string }
  | { readonly mode: 'blocked'; readonly message: string };

export interface PassportV2ActionRouteInput {
  readonly runtimeConfigured: boolean;
  readonly runtimeError?: string | null;
  readonly credentialVerified: boolean;
  readonly actionPortAvailable: boolean;
  readonly referendumId: string | null;
}

/**
 * Selects the only permitted action boundary. An enabled-but-incomplete v2
 * runtime can never fall through to the legacy executor.
 */
export function resolvePassportV2ActionRoute(
  input: PassportV2ActionRouteInput,
  locale: CicoLocale = 'es',
): PassportV2ActionRoute {
  const copy = COPY[locale];
  if (!input.runtimeConfigured && !input.runtimeError) return { mode: 'legacy' };
  if (input.runtimeError) {
    return { mode: 'blocked', message: copy.routeInvalid(input.runtimeError) };
  }
  if (!input.credentialVerified) {
    return { mode: 'blocked', message: copy.routeCredential };
  }
  if (!input.actionPortAvailable || !input.referendumId) {
    return { mode: 'blocked', message: copy.routeIncomplete };
  }
  return { mode: 'v2', referendumId: input.referendumId };
}

/**
 * Keeps Preview failures actionable before the user reaches wallet approval.
 * This is deliberately pure so the same prerequisite matrix can be used by
 * the UI, browser tests, and a future deployment smoke check.
 */
export function getPreviewReadiness(
  input: PreviewReadinessInput,
  locale: CicoLocale = 'es',
): PreviewReadiness {
  const copy = COPY[locale];
  if (input.appMode === 'demo') {
    return { state: 'demo', label: copy.demoLabel, message: copy.demoMessage };
  }

  const network = input.appMode === 'undeployed' ? copy.localNetwork : 'Preview';

  if (!input.contractAddress) {
    return {
      state: 'blocked',
      label: copy.contractLabel(network),
      message: copy.contractMessage(network),
    };
  }

  // Provider failures are more actionable than the wallet state. In
  // particular, do not make a disconnected wallet look like the cause when
  // the configured network/indexer is already unavailable.
  if (input.providersError) {
    return {
      state: 'blocked',
      label: copy.unavailableLabel(network),
      message: copy.providersMessage(input.providersError),
    };
  }

  if (input.v2RuntimeConfigured && !input.credentialVerified) {
    return {
      state: 'blocked',
      label: copy.credentialLabel(network),
      message: copy.credentialMessage,
    };
  }

  if (!input.walletConnected && input.walletlessProving === 'needs-consent') {
    return {
      state: 'blocked',
      label: copy.consentLabel(network),
      message: copy.consentMessage,
    };
  }

  if (!input.walletConnected && input.walletlessProving === 'failed') {
    return {
      state: 'blocked',
      label: copy.unavailableLabel(network),
      message: copy.proofFailed,
    };
  }

  if (!input.walletConnected && input.walletlessProving === 'preparing') {
    return {
      state: 'loading',
      label: copy.preparingLabel(network),
      message: copy.proofPreparing,
    };
  }

  // In relayer mode the fee is sponsored, so a missing wallet is not a
  // blocker — the relayer being unreachable is, and that surfaces as
  // providersError below.
  if (!input.relayerMode && !input.walletConnected) {
    return {
      state: 'blocked',
      label: copy.walletLabel(network),
      message: copy.walletMessage(network),
    };
  }

  if (!input.providersReady) {
    return {
      state: 'loading',
      label: copy.preparingLabel(network),
      message: copy.providersPreparing(network),
    };
  }

  return {
    state: 'ready',
    label: copy.readyLabel(network),
    message: copy.readyMessage(network),
  };
}

/**
 * Public contract state is a read concern, not a wallet concern. A public
 * indexer provider can be ready while action providers are still blocked.
 */
export function getPublicReadiness(
  input: PublicReadinessInput,
  locale: CicoLocale = 'es',
): PublicReadiness {
  const copy = COPY[locale];
  if (input.appMode === 'demo') {
    return { state: 'demo', label: copy.demoLabel, message: copy.publicDemo };
  }

  const network = input.appMode === 'undeployed' ? copy.localNetwork : 'Preview';
  if (!input.contractAddress) {
    return {
      state: 'blocked',
      label: copy.contractLabel(network),
      message: copy.publicContract(network),
    };
  }
  if (input.publicProviderError) {
    return {
      state: 'blocked',
      label: copy.unavailableLabel(network),
      message: copy.publicError(network, input.publicProviderError),
    };
  }
  if (!input.publicProviderReady) {
    return {
      state: 'loading',
      label: copy.publicPreparingLabel(network),
      message: copy.publicPreparing(network),
    };
  }
  return {
    state: 'ready',
    label: copy.publicReadyLabel(network),
    message: copy.publicReady(network),
  };
}
