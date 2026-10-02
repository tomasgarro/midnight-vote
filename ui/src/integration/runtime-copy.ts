import type { CicoLocale } from '@/integration/locale';

/**
 * What the runtime says when an answer cannot be sealed or a session cannot
 * start, in the reader's language. `network` is the name of the network and
 * is the same in every language.
 *
 * A message that comes from a service or from the chain is shown as it
 * arrives. These are the app's own words around it.
 */
export const RUNTIME_COPY = {
  es: {
    passportConfigInvalid: 'La configuración de Passport no es válida.',
    passportConnectFailed: 'No se pudo conectar Passport',
    consultationClosed: 'Esta consulta está cerrada y no acepta nuevas respuestas.',
    chooseFirst: 'Elegí una respuesta antes de continuar.',
    runtimeInvalid: (detail: string) =>
      `La configuración Passport v2 es inválida; la respuesta fue bloqueada: ${detail}`,
    actionUnavailable: 'La acción no está disponible; la respuesta fue bloqueada.',
    authorizationMissing:
      'Tu pase no tiene una autorización vigente para responder. Verificá de nuevo tu pasaporte.',
    passNotAdmitted:
      'Tu pase todavía no fue admitido en esta consulta. Suele tardar un minuto. Probá de nuevo en un momento.',
    passTooLate:
      'Tu pase se agregó después de que esta consulta dejó de admitir pases. Podés responder otras consultas abiertas.',
    manifestMissing: (network: string) =>
      `${network} requiere un manifiesto v2 completo; el flujo anterior está deshabilitado.`,
    transactionFailed: (network: string) => `Falló la transacción en ${network}`,
    consultationMissingTitle: 'Consulta no disponible',
    consultationMissingBody: 'El catálogo cambió o todavía no está listo para esta acción.',
    backToConsultations: 'Volver a las consultas',
    receiptReady: 'Último comprobante listo',
    dismissNotice: 'Cerrar notificación',
  },
  en: {
    passportConfigInvalid: 'The Passport configuration is not valid.',
    passportConnectFailed: 'Passport could not connect',
    consultationClosed: 'This consultation is closed and takes no new answers.',
    chooseFirst: 'Choose an answer before you continue.',
    runtimeInvalid: (detail: string) =>
      `The Passport v2 configuration is not valid, so the answer was blocked: ${detail}`,
    actionUnavailable: 'The action is not available, so the answer was blocked.',
    authorizationMissing:
      'Your pass holds no current authorization to answer. Verify your passport again.',
    passNotAdmitted:
      'Your pass has not been admitted to this consultation yet. It usually takes a minute. Try again shortly.',
    passTooLate:
      'Your pass was added after this consultation stopped admitting passes. You can answer the other open consultations.',
    manifestMissing: (network: string) =>
      `${network} needs a complete v2 manifest. The earlier flow is disabled.`,
    transactionFailed: (network: string) => `The transaction failed on ${network}`,
    consultationMissingTitle: 'Consultation not available',
    consultationMissingBody: 'The catalogue changed, or it is not ready for this action yet.',
    backToConsultations: 'Back to the consultations',
    receiptReady: 'Latest receipt ready',
    dismissNotice: 'Dismiss notification',
  },
  fr: {
    passportConfigInvalid: 'La configuration de Passport n’est pas valide.',
    passportConnectFailed: 'Passport n’a pas pu se connecter',
    consultationClosed: 'Cette consultation est close et n’accepte plus de réponse.',
    chooseFirst: 'Choisissez une réponse avant de continuer.',
    runtimeInvalid: (detail: string) =>
      `La configuration Passport v2 n’est pas valide ; la réponse a été bloquée : ${detail}`,
    actionUnavailable: 'L’action n’est pas disponible ; la réponse a été bloquée.',
    authorizationMissing:
      'Votre laissez-passer n’a pas d’autorisation en cours pour répondre. Vérifiez à nouveau votre passeport.',
    passNotAdmitted:
      'Votre laissez-passer n’est pas encore admis dans cette consultation. Cela prend en général une minute. Réessayez dans un instant.',
    passTooLate:
      'Votre laissez-passer a été ajouté après la fin des admissions de cette consultation. Vous pouvez répondre aux autres consultations ouvertes.',
    manifestMissing: (network: string) =>
      `${network} exige un manifeste v2 complet. L’ancien parcours est désactivé.`,
    transactionFailed: (network: string) => `La transaction a échoué sur ${network}`,
    consultationMissingTitle: 'Consultation indisponible',
    consultationMissingBody:
      'Le catalogue a changé, ou il n’est pas encore prêt pour cette action.',
    backToConsultations: 'Retour aux consultations',
    receiptReady: 'Dernier reçu prêt',
    dismissNotice: 'Fermer la notification',
  },
} as const satisfies Record<CicoLocale, unknown>;

/**
 * What a person reads when sealing an answer was refused.
 *
 * Two refusals can meet a person right after they got a pass, so those are
 * said in their language: the pass is not admitted yet, which clears by itself
 * within a minute, and the pass came after the consultation closed to new
 * passes, which does not. Any other message is shown as it arrived.
 */
export function sealRefusalMessage(error: unknown, locale: CicoLocale, network: string): string {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  if (code === 'CREDENTIAL_NOT_ADMITTED') return RUNTIME_COPY[locale].passNotAdmitted;
  if (code === 'CREDENTIAL_ADMISSION_CLOSED') return RUNTIME_COPY[locale].passTooLate;
  return error instanceof Error && error.message
    ? error.message
    : RUNTIME_COPY[locale].transactionFailed(network);
}
