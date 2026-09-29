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
   * Hosted proving for a browser without a wallet (ADR-010). `needs-consent`
   * means the person has not yet accepted what the proving server can see.
   */
  hostedProving?: 'not-offered' | 'needs-consent' | 'preparing' | 'failed' | 'ready';
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
): PassportV2ActionRoute {
  if (!input.runtimeConfigured && !input.runtimeError) return { mode: 'legacy' };
  if (input.runtimeError) {
    return {
      mode: 'blocked',
      message: `La configuración Passport v2 es inválida; el voto fue bloqueado: ${input.runtimeError}`,
    };
  }
  if (!input.credentialVerified) {
    return {
      mode: 'blocked',
      message: 'La acción v2 requiere una credencial Passport verificada; no se usará una fixture.',
    };
  }
  if (!input.actionPortAvailable || !input.referendumId) {
    return {
      mode: 'blocked',
      message:
        'La consulta no tiene una configuración v2 completa para esta red; el voto fue bloqueado.',
    };
  }
  return { mode: 'v2', referendumId: input.referendumId };
}

/**
 * Keeps Preview failures actionable before the user reaches wallet approval.
 * This is deliberately pure so the same prerequisite matrix can be used by
 * the UI, browser tests, and a future deployment smoke check.
 */
export function getPreviewReadiness(input: PreviewReadinessInput): PreviewReadiness {
  if (input.appMode === 'demo') {
    return {
      state: 'demo',
      label: 'Solo lectura local',
      message:
        'El modo local permite revisar la interfaz, pero no confirma votos ni crea comprobantes. Configurá Preview para enviar una transacción real.',
    };
  }

  const networkLabel = input.appMode === 'undeployed' ? 'Undeployed local' : 'Preview';

  if (!input.contractAddress) {
    return {
      state: 'blocked',
      label: `${networkLabel} requiere contrato`,
      message: `${networkLabel} no está configurado: cargá un catálogo v2 firmado con un contrato desplegado en esta red.`,
    };
  }

  // Provider failures are more actionable than the wallet state. In
  // particular, do not make a disconnected wallet look like the cause when
  // the configured network/indexer is already unavailable.
  if (input.providersError) {
    return {
      state: 'blocked',
      label: `${networkLabel} no disponible`,
      message: `No se pudieron preparar los proveedores de Midnight: ${input.providersError}`,
    };
  }

  if (input.v2RuntimeConfigured && !input.credentialVerified) {
    return {
      state: 'blocked',
      label: `${networkLabel} requiere credencial`,
      message:
        'La acción v2 requiere una credencial Passport verificada. No se usará una fixture ni el flujo de voto legado como alternativa.',
    };
  }

  if (!input.walletConnected && input.hostedProving === 'needs-consent') {
    return {
      state: 'blocked',
      label: `${networkLabel} necesita tu acuerdo`,
      message:
        'Este dispositivo no tiene wallet. Leé el aviso sobre el servidor de pruebas y aceptalo para continuar, o conectá Lace en una computadora.',
    };
  }

  if (!input.walletConnected && input.hostedProving === 'failed') {
    return {
      state: 'blocked',
      label: `${networkLabel} no disponible`,
      message: 'El servidor de pruebas no responde en este momento. Probá de nuevo más tarde.',
    };
  }

  if (!input.walletConnected && input.hostedProving === 'preparing') {
    return {
      state: 'loading',
      label: `Preparando ${networkLabel}`,
      message: 'Conectando con el servidor de pruebas.',
    };
  }

  // In relayer mode the fee is sponsored, so a missing wallet is not a
  // blocker — the relayer being unreachable is, and that surfaces as
  // providersError below.
  if (!input.relayerMode && !input.walletConnected) {
    return {
      state: 'blocked',
      label: `${networkLabel} requiere wallet`,
      message: `Conectá un wallet DApp Connector en ${networkLabel} para aprobar y balancear la transacción.`,
    };
  }

  if (!input.providersReady) {
    return {
      state: 'loading',
      label: `Preparando ${networkLabel}`,
      message: `La wallet está conectada, pero los proveedores de ${networkLabel} todavía se están preparando.`,
    };
  }

  return {
    state: 'ready',
    label: `${networkLabel} listo`,
    message: `${networkLabel} está listo para preparar una transacción real.`,
  };
}

/**
 * Public contract state is a read concern, not a wallet concern. A public
 * indexer provider can be ready while action providers are still blocked.
 */
export function getPublicReadiness(input: PublicReadinessInput): PublicReadiness {
  if (input.appMode === 'demo') {
    return {
      state: 'demo',
      label: 'Solo lectura local',
      message: 'El modo demo no consulta una red ni presenta estado canónico.',
    };
  }

  const networkLabel = input.appMode === 'undeployed' ? 'Undeployed local' : 'Preview';
  if (!input.contractAddress) {
    return {
      state: 'blocked',
      label: `${networkLabel} requiere contrato`,
      message: `${networkLabel} no está configurado: cargá el catálogo v2 para leer el estado público.`,
    };
  }
  if (input.publicProviderError) {
    return {
      state: 'blocked',
      label: `${networkLabel} no disponible`,
      message: `No se pudo leer el estado público de ${networkLabel}: ${input.publicProviderError}`,
    };
  }
  if (!input.publicProviderReady) {
    return {
      state: 'loading',
      label: `Preparando lectura de ${networkLabel}`,
      message: `El indexer de ${networkLabel} todavía se está preparando.`,
    };
  }
  return {
    state: 'ready',
    label: `Lectura ${networkLabel} lista`,
    message: `El estado público de ${networkLabel} se puede consultar sin conectar una wallet.`,
  };
}
