/*
 * Where this device's sealed answers stand, and the step that counts one.
 *
 * The list is read from the device: the ballot opening vault says which
 * answers are still waiting for the count, and a small marker says which ones
 * were already counted or can no longer be. Nothing here holds a choice, a
 * salt or a transaction id, and nothing here is sent anywhere.
 *
 * It is deliberately not tied to a Passport profile. An answer sealed without
 * a Passport session must still be counted when the person returns.
 */
import {
  type BallotOpeningVaultPort,
  type CivicActionPort,
  type CivicCredentialPort,
  isCivicCredentialError,
} from 'midnight-referendum-api';

export type MissedReason = 'opening-lost' | 'count-closed';

export type SealedAnswer =
  | { readonly referendumId: string; readonly state: 'sealed' | 'counted' }
  | { readonly referendumId: string; readonly state: 'missed'; readonly reason: MissedReason };

export type AnswerMarker =
  | { readonly state: 'counted' }
  | { readonly state: 'missed'; readonly reason: MissedReason };

export interface AnswerMarkerStore {
  get(referendumId: string): AnswerMarker | null;
  set(referendumId: string, marker: AnswerMarker): void;
  clear(): void;
}

export type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const MARKER_KEY = 'midnight-vote:answer-markers';

function parseMarker(value: unknown): AnswerMarker | null {
  if (!value || typeof value !== 'object') return null;
  const { state, reason } = value as Record<string, unknown>;
  if (state === 'counted') return { state };
  if (state === 'missed' && (reason === 'opening-lost' || reason === 'count-closed')) {
    return { state, reason };
  }
  return null;
}

/**
 * Markers outlive the opening, which is deleted once its answer is counted.
 * They are scoped like the vault so one deployment never reports on another.
 * Without storage they last for the visit.
 */
export function browserAnswerMarkerStore(
  scope: string,
  storage: MarkerStorage | null = deviceStorage(),
): AnswerMarkerStore {
  const key = `${MARKER_KEY}:${scope.trim()}`;
  let memory: Record<string, AnswerMarker> = {};

  const readAll = (): Record<string, AnswerMarker> => {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return { ...memory };
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...memory };
      const markers: Record<string, AnswerMarker> = {};
      for (const [referendumId, value] of Object.entries(parsed)) {
        const marker = parseMarker(value);
        if (marker) markers[referendumId] = marker;
      }
      return { ...memory, ...markers };
    } catch {
      return { ...memory };
    }
  };

  return {
    get: (referendumId) => readAll()[referendumId] ?? null,
    set: (referendumId, marker) => {
      const next = { ...readAll(), [referendumId]: marker };
      memory = next;
      try {
        storage?.setItem(key, JSON.stringify(next));
      } catch {
        // Kept in memory for this visit.
      }
    },
    clear: () => {
      memory = {};
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing was stored.
      }
    },
  };
}

function deviceStorage(): MarkerStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** What the chain says about the answers this device tried to seal. */
export type OnChainAnswerStatus = 'none' | 'sealed' | 'counted';

export interface ListSealedAnswersInput {
  readonly referendumIds: readonly string[];
  readonly vault: Pick<BallotOpeningVaultPort, 'list'>;
  readonly markers: AnswerMarkerStore;
  /**
   * Settles an attempt whose outcome the device never learned. Omitted when no
   * chain reader is available; such an attempt is then left out of the list,
   * because the interface must not call an answer sealed on a guess.
   */
  readonly resolveOnChain?: (referendumId: string) => Promise<OnChainAnswerStatus>;
}

export async function listSealedAnswers(input: ListSealedAnswersInput): Promise<SealedAnswer[]> {
  const answers: SealedAnswer[] = [];
  for (const referendumId of input.referendumIds) {
    const marker = input.markers.get(referendumId);
    if (marker) {
      answers.push({ referendumId, ...marker });
      continue;
    }
    const openings = await input.vault.list(referendumId);
    if (openings.length === 0) continue;
    if (openings.some((opening) => opening.status === 'sealed')) {
      answers.push({ referendumId, state: 'sealed' });
      continue;
    }
    // Only unconfirmed attempts are held. The chain decides.
    let onChain: OnChainAnswerStatus = 'none';
    try {
      onChain = (await input.resolveOnChain?.(referendumId)) ?? 'none';
    } catch {
      onChain = 'none';
    }
    if (onChain === 'counted') {
      input.markers.set(referendumId, { state: 'counted' });
      answers.push({ referendumId, state: 'counted' });
    } else if (onChain === 'sealed') {
      answers.push({ referendumId, state: 'sealed' });
    }
  }
  return answers;
}

export type CountOutcome =
  | { readonly state: 'counted' }
  | { readonly state: 'missed'; readonly reason: MissedReason }
  | {
      readonly state: 'waiting';
      readonly reason: 'count-not-open' | 'pass-missing' | 'try-again';
    };

export interface CountSealedAnswerInput {
  readonly referendumId: string;
  readonly actions: Pick<CivicActionPort, 'revealVote'>;
  readonly credential: Pick<CivicCredentialPort, 'getActionAuthorization'>;
  readonly markers: AnswerMarkerStore;
}

/**
 * Counts one sealed answer and records the outcome. The request carries the
 * referendum and, while the pass is valid, its authorization; the choice and
 * the salt stay in the vault, where the action port reads them.
 */
export async function countSealedAnswer(input: CountSealedAnswerInput): Promise<CountOutcome> {
  const settle = (marker: AnswerMarker): AnswerMarker => {
    input.markers.set(input.referendumId, marker);
    return marker;
  };

  let authorization: Awaited<ReturnType<CivicCredentialPort['getActionAuthorization']>>;
  try {
    authorization = await input.credential.getActionAuthorization();
  } catch {
    return { state: 'waiting', reason: 'try-again' };
  }

  try {
    // A pass lasts days and a count can come weeks later. Without a current
    // pass, the action port sponsors the count with the authorization kept
    // beside the sealed answer, and asks for a new pass only if there is none.
    await input.actions.revealVote({
      referendumId: input.referendumId,
      ...(authorization ? { authorization } : {}),
    });
    return settle({ state: 'counted' });
  } catch (error) {
    if (!isCivicCredentialError(error)) return { state: 'waiting', reason: 'try-again' };
    switch (error.code) {
      case 'CONFLICT':
        // The chain already shows this answer as counted.
        return settle({ state: 'counted' });
      case 'REVEAL_NOT_OPEN':
        return error.retryable
          ? { state: 'waiting', reason: 'count-not-open' }
          : settle({ state: 'missed', reason: 'count-closed' });
      case 'BALLOT_OPENING_NOT_FOUND':
        return settle({ state: 'missed', reason: 'opening-lost' });
      case 'CREDENTIAL_NOT_FOUND':
        return { state: 'waiting', reason: 'pass-missing' };
      default:
        return { state: 'waiting', reason: 'try-again' };
    }
  }
}

export const SEALED_ANSWER_COPY = {
  en: {
    heading: 'Your sealed answers',
    lead: 'An answer is counted only when this device returns after the consultation closes. Nobody else can count it for you.',
    sealed: 'Sealed',
    sealedOpen: 'Come back on this device after it closes so your answer is counted.',
    sealedClosed: 'The consultation has closed. Your answer can be counted now.',
    counted: 'Counted',
    countedBody:
      'Your answer is in the public result. The sealed copy was deleted from this device.',
    missed: 'Not counted',
    missedLost: 'This device no longer holds the sealed answer, so it cannot be counted.',
    missedClosed: 'The count closed before this device returned.',
    count: 'Count my answer',
    counting: 'Counting…',
    waitingCount: 'The count has not opened yet. Try again later.',
    waitingPass: 'Your pass is needed to count this answer. Verify again on this device.',
    waitingRetry: 'That did not go through. Try again in a moment.',
    publicAtCount: 'When it is counted, the answer itself becomes public. Your identity does not.',
  },
  es: {
    heading: 'Tus respuestas selladas',
    lead: 'Una respuesta se cuenta solo cuando este dispositivo vuelve después del cierre de la consulta. Nadie más puede contarla por vos.',
    sealed: 'Sellada',
    sealedOpen: 'Volvé en este dispositivo después del cierre para que tu respuesta se cuente.',
    sealedClosed: 'La consulta cerró. Tu respuesta ya se puede contar.',
    counted: 'Contada',
    countedBody:
      'Tu respuesta está en el resultado público. La copia sellada se borró de este dispositivo.',
    missed: 'No contada',
    missedLost: 'Este dispositivo ya no guarda la respuesta sellada, así que no se puede contar.',
    missedClosed: 'El recuento cerró antes de que este dispositivo volviera.',
    count: 'Contar mi respuesta',
    counting: 'Contando…',
    waitingCount: 'El recuento todavía no abrió. Probá más tarde.',
    waitingPass:
      'Hace falta tu pase para contar esta respuesta. Verificá de nuevo en este dispositivo.',
    waitingRetry: 'No se pudo completar. Probá de nuevo en un momento.',
    publicAtCount: 'Cuando se cuenta, la respuesta pasa a ser pública. Tu identidad no.',
  },
  fr: {
    heading: 'Vos réponses scellées',
    lead: "Une réponse n'est comptée que lorsque cet appareil revient après la clôture de la consultation. Personne d'autre ne peut la compter à votre place.",
    sealed: 'Scellée',
    sealedOpen: 'Revenez sur cet appareil après la clôture pour que votre réponse soit comptée.',
    sealedClosed: 'La consultation est close. Votre réponse peut être comptée maintenant.',
    counted: 'Comptée',
    countedBody:
      'Votre réponse figure dans le résultat public. La copie scellée a été supprimée de cet appareil.',
    missed: 'Non comptée',
    missedLost:
      'Cet appareil ne détient plus la réponse scellée ; elle ne peut donc pas être comptée.',
    missedClosed: 'Le dépouillement a pris fin avant le retour de cet appareil.',
    count: 'Compter ma réponse',
    counting: 'Comptage…',
    waitingCount: "Le dépouillement n'a pas encore commencé. Réessayez plus tard.",
    waitingPass:
      'Votre pass est nécessaire pour compter cette réponse. Vérifiez-le à nouveau sur cet appareil.',
    waitingRetry: "L'opération n'a pas abouti. Réessayez dans un instant.",
    publicAtCount:
      'Au moment du comptage, la réponse elle-même devient publique. Votre identité, non.',
  },
} as const;
