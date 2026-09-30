import type { ExplanationAreaId, PriorityId, TradeoffId } from 'midnight-referendum-api/pulse';

export const REFLECTION_KEY = 'midnight-civic-reflection-v1';
export interface LocalReflection {
  version: 1;
  savedAt: string;
  priorities: PriorityId[];
  tradeoffs: TradeoffId[];
  explanationAreas: ExplanationAreaId[];
  budget: string | null;
  funding: string | null;
}
const allowed = {
  priorities: ['cost-of-living', 'healthcare', 'education', 'housing', 'climate', 'public-safety'],
  tradeoffs: [
    'act-sooner',
    'build-consensus',
    'target-support',
    'universal-services',
    'prefer-not-to-answer',
  ],
  explanationAreas: ['costs', 'delivery', 'evidence', 'tradeoffs'],
  budget: ['balance', 'low', 'moderate', 'higher', 'depends', 'unsure'],
  funding: ['reprioritise', 'revenue', 'borrow', 'phase', 'mix', 'unsure'],
};
export function readReflection(): LocalReflection | null {
  try {
    const raw = localStorage.getItem(REFLECTION_KEY);
    if (!raw || raw.length > 3000) return null;
    const value = JSON.parse(raw);
    if (
      !value ||
      value.version !== 1 ||
      typeof value.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.savedAt))
    )
      return null;
    for (const field of ['priorities', 'tradeoffs', 'explanationAreas'] as const) {
      if (
        !Array.isArray(value[field]) ||
        value[field].length > (field === 'priorities' ? 3 : 5) ||
        value[field].some(
          (item: unknown) => typeof item !== 'string' || !allowed[field].includes(item),
        ) ||
        new Set(value[field]).size !== value[field].length
      )
        return null;
    }
    if (value.priorities.length === 0) return null;
    for (const field of ['budget', 'funding'] as const) {
      if (value[field] !== null && !allowed[field].includes(value[field])) return null;
    }
    // Reconstruct the allowlisted shape: never import extra persisted fields.
    return {
      version: 1,
      savedAt: value.savedAt,
      priorities: value.priorities,
      tradeoffs: value.tradeoffs,
      explanationAreas: value.explanationAreas,
      budget: value.budget,
      funding: value.funding,
    };
  } catch {
    return null;
  }
}
export function saveReflection(value: LocalReflection): boolean {
  try {
    localStorage.setItem(REFLECTION_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function eraseReflection(): boolean {
  try {
    localStorage.removeItem(REFLECTION_KEY);
    return true;
  } catch {
    return false;
  }
}

export const REFLECTION_COPY = {
  en: {
    save: 'Save on this device',
    saved: 'Saved on this device',
    resume: 'Review saved reflection',
    remove: 'Delete saved reflection',
    failed: 'Browser storage is unavailable. Your answers are still in this page.',
    note: 'Saving is optional. Anyone using this browser profile can read it. Nothing is uploaded; you can delete it here.',
    discuss: 'Explore with Cleisthenes',
    copy: 'Copy a prompt for AI',
    copied: 'Prompt copied',
    copyFailed: 'Clipboard access is unavailable. Select and copy the prompt below.',
    handoff:
      'In this chat Cleisthenes uses catalogue information, not generative AI. You can also copy this reflection into an AI service of your choice; that shares your answers with that service.',
    prompt:
      'Help me reflect on these choices. Ask one clarifying question at a time, compare tradeoffs and uncertainties, and do not infer a political identity or tell me how to vote.',
    return: 'Return to the app',
    context: 'Your reflection',
  },
  es: {
    save: 'Guardar en este dispositivo',
    saved: 'Guardado en este dispositivo',
    resume: 'Revisar reflexión guardada',
    remove: 'Borrar reflexión guardada',
    failed: 'El almacenamiento no está disponible. Tus respuestas siguen en esta página.',
    note: 'Guardar es opcional. Quien use este perfil del navegador puede leerlo. Nada se sube; podés borrarlo acá.',
    discuss: 'Explorar con Cleisthenes',
    copy: 'Copiar un mensaje para IA',
    copied: 'Mensaje copiado',
    copyFailed: 'No hay acceso al portapapeles. Seleccioná y copiá el mensaje de abajo.',
    handoff:
      'En este chat Cleisthenes usa información del catálogo, no IA generativa. También podés copiar esta reflexión a una IA que elijas; eso comparte tus respuestas con ese servicio.',
    prompt:
      'Ayudame a reflexionar sobre estas decisiones. Hacé una pregunta aclaratoria por vez, compará alternativas e incertidumbres y no infieras una identidad política ni me digas cómo votar.',
    return: 'Volver a la app',
    context: 'Tu reflexión',
  },
  fr: {
    save: 'Enregistrer sur cet appareil',
    saved: 'Enregistré sur cet appareil',
    resume: 'Revoir la réflexion enregistrée',
    remove: 'Supprimer la réflexion enregistrée',
    failed: 'Le stockage est indisponible. Vos réponses restent dans cette page.',
    note: 'L’enregistrement est facultatif. Toute personne utilisant ce profil de navigateur peut le lire. Rien n’est envoyé ; vous pouvez le supprimer ici.',
    discuss: 'Explorer avec Cleisthenes',
    copy: 'Copier un message pour une IA',
    copied: 'Message copié',
    copyFailed: 'Le presse-papiers est indisponible. Sélectionnez et copiez le message ci-dessous.',
    handoff:
      'Dans ce chat, Cleisthenes utilise le catalogue, sans IA générative. Vous pouvez aussi copier cette réflexion dans une IA de votre choix ; vos réponses seront alors partagées avec ce service.',
    prompt:
      'Aidez-moi à réfléchir à ces choix. Posez une question à la fois, comparez les compromis et incertitudes, sans déduire mon identité politique ni me dire comment voter.',
    return: 'Retour à l’application',
    context: 'Votre réflexion',
  },
};
