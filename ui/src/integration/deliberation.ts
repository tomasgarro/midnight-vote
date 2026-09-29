/*
 * The app's deliberation assistant, configured from public build values.
 *
 * `VITE_ASSISTANT_API_URL` is where the assistant answers, by default the
 * Cleisthenes API on this origin. `VITE_ASSISTANT_SOURCES_JSON` says which
 * consultation reads which body of evidence. Both are public.
 *
 * This file imports the assistant boundary only. It has no access to a pass,
 * a Passport session or an answer, so it cannot send one.
 */
import {
  type CleisthenesConsultationSource,
  createCleisthenesAssistant,
  type DeliberationAssistantPort,
  type DeliberationLanguage,
} from 'midnight-referendum-api/deliberation';
import type { CicoLocale } from '@/integration/locale';

export interface AppAssistant {
  readonly port: DeliberationAssistantPort;
  /** True when the assistant holds evidence for the consultation. */
  covers(consultationId: string): boolean;
}

export interface AssistantEnvironment {
  readonly VITE_ASSISTANT_API_URL?: string;
  readonly VITE_ASSISTANT_SOURCES_JSON?: string;
}

const DEFAULT_ASSISTANT_PATH = '/Switzerland/api';

function parseSources(raw: string | undefined): Record<string, CleisthenesConsultationSource> {
  const value = raw?.trim();
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('VITE_ASSISTANT_SOURCES_JSON must be an object');
  }
  const sources: Record<string, CleisthenesConsultationSource> = {};
  for (const [consultationId, source] of Object.entries(parsed)) {
    const objectId =
      source && typeof source === 'object' ? (source as { objectId?: unknown }).objectId : null;
    if (typeof objectId !== 'string' || !objectId) {
      throw new TypeError(`The assistant source of ${consultationId} needs an objectId`);
    }
    sources[consultationId] = { objectId };
  }
  return sources;
}

/**
 * Null when no consultation has a source, or when the configuration is not
 * usable. The consultation page then shows no brief. It never shows a guess.
 */
export function createAppAssistant(
  env: AssistantEnvironment,
  origin: string,
  fetchImpl?: typeof fetch,
): AppAssistant | null {
  try {
    const consultations = parseSources(env.VITE_ASSISTANT_SOURCES_JSON);
    if (Object.keys(consultations).length === 0) return null;
    const baseUrl = new URL(
      env.VITE_ASSISTANT_API_URL?.trim() || DEFAULT_ASSISTANT_PATH,
      origin,
    ).toString();
    const port = createCleisthenesAssistant({
      baseUrl,
      consultations,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    return { port, covers: (consultationId) => Object.hasOwn(consultations, consultationId) };
  } catch {
    return null;
  }
}

/** The assistant writes in four languages. Spanish readers get English. */
export function assistantLanguage(locale: CicoLocale): DeliberationLanguage {
  return locale === 'fr' ? 'fr' : 'en';
}
