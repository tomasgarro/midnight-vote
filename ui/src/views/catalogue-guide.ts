import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import { countryName } from '@/integration/country-catalog';
import type { CicoLocale } from '@/integration/locale';
import { getPollAvailability } from '@/integration/poll-lifecycle';
import {
  isCountryPoll,
  localizePoll,
  type Poll,
  pollCountryCode,
  pollPlaceCode,
} from './poll-model';

export function hasValidatedPassport(
  credential: DemoCredentialSummary | null,
  now = new Date(),
): boolean {
  return Boolean(
    credential?.kind === 'verified-credential' &&
      credential.assurance !== 'fixture' &&
      Date.parse(credential.validUntil) > now.getTime(),
  );
}

/** Demo access changes navigation only; it never upgrades a fixture to verified. */
export function canUseCatalogueDialogue(
  credential: DemoCredentialSummary | null,
  allowDemo: boolean,
  now = new Date(),
): boolean {
  return (
    hasValidatedPassport(credential, now) ||
    Boolean(
      allowDemo &&
        credential?.kind === 'synthetic-demo-credential' &&
        Date.parse(credential.validUntil) > now.getTime(),
    )
  );
}
export const GUIDE_COPY = {
  en: {
    name: 'Cleisthenes',
    badge: 'Catalogue guide',
    title: 'A little context.\nA clearer choice.',
    intro: 'I find open consultations and explain what is proposed. I never say how to answer.',
    briefs: 'Briefs from the official record',
    briefsBody: 'Each sentence is tied to its source, and a named person reviewed the brief.',
    disclosure:
      'Answers come from the published catalogue. Generative AI is not connected. Your chat stays in this open page.',
    input: 'Ask about a consultation',
    send: 'Send question',
    open: 'What consultations are open for me?',
    global: 'Show global consultations',
    country: 'Explore a country',
    summary: 'Summarize',
    read: 'Read consultation',
    empty: 'No open consultations match this place right now.',
    listed:
      'Here are the open consultations in this scope. Each consultation checks eligibility separately.',
    noCountry:
      'I can show global consultations. Select a country to explore its catalogue; browsing does not prove eligibility.',
    missing: 'Which consultation do you mean? Select one below or include its title.',
    unknown:
      'I can list consultations, summarize a named project, or show its arguments and uncertainties. I only use information in this catalogue.',
    noData: 'The catalogue does not provide that information yet.',
    sources: 'Published context',
    clear: 'Clear chat',
    you: 'You',
    scope: 'Scope',
    globalLabel: 'Global',
    balanced: 'Arguments and uncertainties',
    noProfile: 'Choose a country',
    reset: 'Chat cleared.',
  },
  es: {
    name: 'Cleisthenes',
    badge: 'Guía del catálogo',
    title: 'Un poco de contexto.\nUna decisión más clara.',
    intro: 'Encuentro consultas abiertas y explico qué se propone. Nunca digo cómo responder.',
    briefs: 'Informes basados en el registro oficial',
    briefsBody: 'Cada oración está ligada a su fuente, y una persona con nombre revisó el informe.',
    disclosure:
      'Las respuestas vienen del catálogo publicado. La IA generativa no está conectada. El chat queda en esta página abierta.',
    input: 'Preguntá sobre una consulta',
    send: 'Enviar pregunta',
    open: '¿Qué consultas están abiertas para mí?',
    global: 'Mostrar consultas globales',
    country: 'Explorar un país',
    summary: 'Resumir',
    read: 'Leer consulta',
    empty: 'No hay consultas abiertas en este lugar por ahora.',
    listed:
      'Estas son las consultas abiertas en este alcance. Cada consulta comprueba la elegibilidad por separado.',
    noCountry:
      'Puedo mostrarte las consultas globales. Elegí un país para explorar su catálogo; explorar no acredita elegibilidad.',
    missing: '¿A qué consulta te referís? Elegí una abajo o escribí su título.',
    unknown:
      'Puedo listar consultas, resumir un proyecto o mostrar sus argumentos e incertidumbres. Solo uso información del catálogo.',
    noData: 'El catálogo todavía no incluye esa información.',
    sources: 'Contexto publicado',
    clear: 'Borrar chat',
    you: 'Vos',
    scope: 'Alcance',
    globalLabel: 'Global',
    balanced: 'Argumentos e incertidumbres',
    noProfile: 'Elegí un país',
    reset: 'Chat borrado.',
  },
  fr: {
    name: 'Cleisthenes',
    badge: 'Guide du catalogue',
    title: 'Un peu de contexte.\nUn choix plus éclairé.',
    intro:
      'Je trouve les consultations ouvertes et j’explique ce qui est proposé. Je ne dis jamais comment répondre.',
    briefs: 'Notes fondées sur le registre officiel',
    briefsBody: 'Chaque phrase est liée à sa source, et une personne nommée a relu la note.',
    disclosure:
      'Les réponses viennent du catalogue publié. L’IA générative n’est pas connectée. Le chat reste dans cette page ouverte.',
    input: 'Posez une question sur une consultation',
    send: 'Envoyer la question',
    open: 'Quelles consultations sont ouvertes pour moi ?',
    global: 'Voir les consultations mondiales',
    country: 'Explorer un pays',
    summary: 'Résumer',
    read: 'Lire la consultation',
    empty: 'Aucune consultation ouverte pour ce lieu actuellement.',
    listed:
      'Voici les consultations ouvertes dans ce périmètre. Chaque consultation vérifie séparément l’éligibilité.',
    noCountry:
      'Je peux montrer les consultations mondiales. Choisissez un pays pour explorer son catalogue ; cela ne prouve pas l’éligibilité.',
    missing: 'De quelle consultation parlez-vous ? Choisissez-en une ou indiquez son titre.',
    unknown:
      'Je peux lister les consultations, résumer un projet ou présenter ses arguments et incertitudes. Je me limite aux informations du catalogue.',
    noData: 'Le catalogue ne fournit pas encore cette information.',
    sources: 'Contexte publié',
    clear: 'Effacer le chat',
    you: 'Vous',
    scope: 'Périmètre',
    globalLabel: 'Monde',
    balanced: 'Arguments et incertitudes',
    noProfile: 'Choisir un pays',
    reset: 'Chat effacé.',
  },
} as const;
export interface GuideAnswer {
  text: string;
  pollIds: string[];
  selectedId?: string;
  scope?: string;
}
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
/** Deterministic public-catalogue retrieval. Never reads documents, votes or pulse answers. */
export function answerCatalogue(
  question: string,
  polls: readonly Poll[],
  locale: CicoLocale,
  country?: string,
  lastPollId?: string,
  now = new Date(),
): GuideAnswer {
  const t = GUIDE_COPY[locale];
  const q = normalize(question);
  const localized = polls.map((p) => localizePoll(p, locale));
  const named = localized.find(
    (p) =>
      q.includes(normalize(p.title)) ||
      q === normalize(p.id) ||
      p.aliases?.some((alias) => new RegExp(`(?:^|\\W)${normalize(alias)}(?:$|\\W)`, 'u').test(q)),
  );
  const summary =
    /summari|resum|explain|expliq|argument|uncertain|incertid|incertitude|pros|cons\b/.test(q);
  if (summary || named) {
    const followup =
      /^(summarize( it| that| this( project)?)?|resumir( esto| eso)?|resumer( cela| ce projet)?|(?:what are )?(?:the |its )?(arguments|pros and cons|uncertainties)|argumentos|incertidumbres|incertitudes)[?.!]*$/.test(
        q,
      );
    const poll = named ?? (followup ? localized.find((p) => p.id === lastPollId) : undefined);
    if (!poll) return { text: t.missing, pollIds: polls.map((p) => p.id) };
    const balanced = /argument|pros|cons\b|tradeoff|incertid|uncertain|incertitude/.test(q);
    const sourceRequest = /source|fuente/.test(q);
    const evidenceRequest = /evidence|evidencia|contexte|context/.test(q);
    const uncertaintyRequest = /unknown|uncertain|incertid|incertitude/.test(q);
    const labels = {
      en: ['Case for', 'Concern', 'Still uncertain'],
      es: ['A favor', 'Objeción', 'Aún incierto'],
      fr: ['En faveur', 'Réserve', 'Incertitude'],
    }[locale];
    const text = sourceRequest
      ? poll.sources.map((s) => `${s.label} — ${s.detail}`).join('\n\n')
      : evidenceRequest
        ? poll.evidence
        : uncertaintyRequest
          ? poll.uncertainty
          : balanced
            ? [
                t.balanced,
                poll.argumentsFor[0] ? `${labels[0]} — ${poll.argumentsFor[0]}` : '',
                poll.argumentsAgainst[0] ? `${labels[1]} — ${poll.argumentsAgainst[0]}` : '',
                poll.uncertainty ? `${labels[2]} — ${poll.uncertainty}` : '',
              ]
                .filter(Boolean)
                .join('\n\n')
            : poll.description;
    return { text: text || t.noData, pollIds: [poll.id], selectedId: poll.id };
  }
  const countries = [...new Set(polls.map(pollPlaceCode).filter((c): c is string => Boolean(c)))];
  const explicit = countries.find((c) =>
    [c, ...(['en', 'es', 'fr'] as const).map((l) => countryName(c, l))].some((name) =>
      new RegExp(`(?:^|\\W)${normalize(name)}(?:$|\\W)`, 'u').test(q),
    ),
  );
  const global = /global|world|mondial|monde/.test(q);
  const subject = /climate|clima|climat/.test(q)
    ? 'climate'
    : /econom|economie/.test(q)
      ? 'economy'
      : /housing|vivienda|logement/.test(q)
        ? 'housing'
        : /mobility|movilidad|mobilite/.test(q)
          ? 'mobility'
          : undefined;
  if (!explicit && !global && !/open|poll|consult|abierta|ouvert|para mi|for me|pour moi/.test(q))
    return { text: t.unknown, pollIds: [] };
  const scope = global ? undefined : (explicit ?? country);
  // Global means the Global list. Otherwise a consultation qualifies when any
  // pass may answer it (the World question, the Swiss open pulse), or when it
  // is listed in the place asked about.
  const inScope = (p: Poll) =>
    global ? !isCountryPoll(p) : !pollCountryCode(p) || pollPlaceCode(p) === scope;
  const matches = polls.filter((p) => {
    try {
      return (
        getPollAvailability(p, now).isOpen && (!subject || p.subject === subject) && inScope(p)
      );
    } catch {
      return false;
    }
  });
  return {
    text: matches.length ? (!scope && !global ? t.noCountry : t.listed) : t.empty,
    pollIds: matches.map((p) => p.id),
    scope: scope ? `${countryName(scope, locale)} + ${t.globalLabel}` : t.globalLabel,
  };
}
