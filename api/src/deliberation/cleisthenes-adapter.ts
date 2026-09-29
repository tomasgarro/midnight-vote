/*
 * Cleisthenes as the deliberation assistant, over its public HTTP routes.
 *
 * Briefs and prepared questions come from `GET /votes/<object>`: reviewed
 * ahead of time, cached, and free to read. A question of the person's own goes
 * to `POST /parliament/ask/stream`, scoped to the consultation's business.
 *
 * Every request is built here from a short list of fields, and is sent without
 * cookies, so a Cleisthenes account in the same browser is never attached to a
 * question asked from the app.
 */
import {
  type AskProgress,
  type AskRequest,
  type AssistantAnswer,
  type BriefRequest,
  type ChamberDecision,
  type CitedSentence,
  type ConsultationBrief,
  DELIBERATION_LANGUAGES,
  type DeliberationAssistantPort,
  DeliberationError,
  type DeliberationLanguage,
  type EvidenceCitation,
  MAX_QUESTION_LENGTH,
  type PreparedQuestion,
  type SideCoverage,
  type SideCoverageLevel,
} from './ports.js';

/** How one consultation maps to the assistant's evidence. Public values only. */
export interface CleisthenesConsultationSource {
  /** The vote object, as listed by `GET /votes`. */
  readonly objectId: string;
}

export interface CleisthenesAssistantOptions {
  /** For example `https://midnight.vote/Switzerland/api`. */
  readonly baseUrl: string;
  readonly consultations: Readonly<Record<string, CleisthenesConsultationSource>>;
  readonly fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

function httpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // A citation link is shown to the person. Only a plain web address is.
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function citation(id: string, value: unknown): EvidenceCitation | null {
  if (!isObject(value)) return null;
  const speaker = text(value.speaker);
  const quote = text(value.quote);
  const date = text(value.date);
  if (!speaker || !quote || !date || !Number.isFinite(Date.parse(date))) return null;
  const video = isObject(value.video) ? value.video : null;
  const videoUrl = video ? httpsUrl(video.url) : null;
  const start = video && typeof video.start === 'number' ? video.start : null;
  const end = video && typeof video.end === 'number' ? video.end : null;
  return {
    id,
    speaker,
    role: text(value.role),
    group: text(value.groupName) ?? text(value.group),
    chamber: text(value.chamber) ?? text(value.council),
    date,
    quote,
    quoteLanguage: text(value.language) ?? text(value.originalLanguage) ?? 'und',
    officialUrl: httpsUrl(value.officialUrl),
    video:
      videoUrl && start !== null && end !== null && start >= 0 && end > start
        ? { url: videoUrl, start, end }
        : null,
  };
}

function citations(value: unknown): Record<string, EvidenceCitation> {
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.flatMap(
        (item): Array<[string, unknown]> =>
          isObject(item) && text(item.id) ? [[item.id as string, item]] : [],
      )
    : isObject(value)
      ? Object.entries(value)
      : [];
  const result: Record<string, EvidenceCitation> = {};
  for (const [id, item] of entries) {
    const parsed = citation(id, item);
    if (parsed) result[id] = parsed;
  }
  return result;
}

/** Keeps a sentence only if every citation it names is one we hold. */
function sentences(
  value: unknown,
  known: Readonly<Record<string, EvidenceCitation>>,
): CitedSentence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CitedSentence[] => {
    if (!isObject(item)) return [];
    const body = text(item.text);
    const ids = Array.isArray(item.citationIds)
      ? item.citationIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (!body || ids.length === 0 || !ids.every((id) => id in known)) return [];
    return [{ text: body, citationIds: ids }];
  });
}

function coverage(value: unknown): SideCoverage {
  const levels: readonly SideCoverageLevel[] = ['full', 'thin', 'single', 'silent'];
  const side = isObject(value) ? value : {};
  const level = levels.find((candidate) => candidate === side.level) ?? 'silent';
  return { level, passages: count(side.passages), speakers: count(side.speakers) };
}

function decision(value: unknown): ChamberDecision | null {
  if (!isObject(value) || !isObject(value.counts)) return null;
  const date = text(value.date);
  if (!date) return null;
  return {
    date,
    subject: text(value.subject),
    meaningYes: text(value.meaningYes),
    meaningNo: text(value.meaningNo),
    counts: {
      yes: count(value.counts.yes),
      no: count(value.counts.no),
      abstained: count(value.counts.abstained),
    },
    source: text(value.source),
  };
}

function pickLanguage<T>(
  byLanguage: unknown,
  wanted: DeliberationLanguage,
  read: (value: unknown) => T | null,
): { language: DeliberationLanguage; value: T } | null {
  if (!isObject(byLanguage)) return null;
  for (const language of [wanted, ...DELIBERATION_LANGUAGES.filter((item) => item !== wanted)]) {
    const value = read(byLanguage[language]);
    if (value !== null) return { language, value };
  }
  return null;
}

function answer(value: unknown, language: DeliberationLanguage): AssistantAnswer | null {
  if (!isObject(value) || value.status !== 'ok' || !isObject(value.answer)) return null;
  const known = citations(value.citations);
  const lead = sentences([value.answer.lead], known)[0] ?? null;
  const sections = (Array.isArray(value.answer.sections) ? value.answer.sections : []).flatMap(
    (section) => {
      if (!isObject(section)) return [];
      const title = text(section.title);
      const paragraphs = sentences(section.paragraphs, known);
      return title && paragraphs.length > 0 ? [{ title, paragraphs }] : [];
    },
  );
  if (!lead && sections.length === 0) return null;
  const summary = isObject(value.researchSummary) ? value.researchSummary : {};
  const limitations = (Array.isArray(summary.limitations) ? summary.limitations : []).flatMap(
    (item) => (isObject(item) && text(item.code) ? [item.code as string] : []),
  );
  const spoken = DELIBERATION_LANGUAGES.find((item) => item === value.language) ?? language;
  return {
    language: spoken,
    lead,
    sections,
    citations: known,
    limitations,
    model: text(value.model),
  };
}

/** Reads newline-delimited JSON as it arrives, so research stages show while they happen. */
async function readLines(response: Response, onLine: (line: string) => void): Promise<void> {
  const emit = (line: string) => {
    if (line.trim()) onLine(line);
  };
  if (!response.body) {
    for (const line of (await response.text()).split('\n')) emit(line);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) emit(line);
    if (done) break;
  }
  emit(pending);
}

export function createCleisthenesAssistant(
  options: CleisthenesAssistantOptions,
): DeliberationAssistantPort {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/u, '');
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/u.test(baseUrl)) {
    throw new TypeError('The assistant must be reached over HTTPS');
  }
  for (const [consultationId, source] of Object.entries(options.consultations)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(source.objectId)) {
      throw new TypeError(`The assistant source of ${consultationId} is not a valid object id`);
    }
  }
  const request = (path: string, init: RequestInit = {}) =>
    (options.fetchImpl ?? fetch)(`${baseUrl}${path}`, {
      ...init,
      // No cookie and no referrer: a question is not tied to an account or a page.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });

  const source = (consultationId: string): CleisthenesConsultationSource | null =>
    Object.hasOwn(options.consultations, consultationId)
      ? (options.consultations[consultationId] ?? null)
      : null;

  async function loadObject(consultationId: string): Promise<Json | null> {
    const mapped = source(consultationId);
    if (!mapped) return null;
    let response: Response;
    try {
      response = await request(`/votes/${encodeURIComponent(mapped.objectId)}`);
    } catch {
      throw new DeliberationError('ASSISTANT_UNAVAILABLE', 'The assistant did not answer', true);
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new DeliberationError('ASSISTANT_UNAVAILABLE', 'The assistant did not answer', true);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!isObject(body) || body.id !== mapped.objectId) {
      throw new DeliberationError('INVALID_RESPONSE', 'The assistant returned another object');
    }
    return body;
  }

  return {
    adapterName: 'cleisthenes-http',

    async getBrief({ consultationId, language }: BriefRequest): Promise<ConsultationBrief | null> {
      const object = await loadObject(consultationId);
      if (!object) return null;
      const title = pickLanguage(object.title, language, text);
      if (!title) {
        throw new DeliberationError('INVALID_RESPONSE', 'The brief has no official title');
      }
      const review = isObject(object.review) ? object.review : {};
      const reviewer = text(review.reviewer);
      const reviewedAt = text(review.reviewedAt);
      const approved = review.status === 'approved' && reviewer !== null && reviewedAt !== null;
      const brief = isObject(object.brief) ? object.brief : null;
      const known = brief ? citations(brief.citations) : {};
      const sides =
        approved && brief
          ? pickLanguage(brief.languages, language, (value) => {
              if (!isObject(value)) return null;
              const supporting = sentences(value.for, known);
              const opposing = sentences(value.against, known);
              return supporting.length + opposing.length > 0
                ? { for: supporting, against: opposing }
                : null;
            })
          : null;
      const used = new Set(
        sides
          ? [...sides.value.for, ...sides.value.against].flatMap((item) => item.citationIds)
          : [],
      );
      const official = isObject(object.officialSource) ? object.officialSource : null;
      const publisher = official ? text(official.publisher) : null;
      const officialUrl = official ? httpsUrl(official.url) : null;
      const decided = isObject(object.decided) ? object.decided : null;
      const briefCoverage = brief && isObject(brief.coverage) ? brief.coverage : null;
      return {
        consultationId,
        officialTitle: title.value,
        officialTitleLanguage: title.language,
        officialSource: publisher && officialUrl ? { publisher, url: officialUrl } : null,
        voteDate: text(object.voteDate),
        language: sides?.language ?? language,
        review: approved
          ? { reviewer: reviewer as string, reviewedAt: reviewedAt as string }
          : null,
        updatedAt: brief ? text(brief.generatedAt) : null,
        model: brief ? text(brief.model) : null,
        arguments: sides?.value ?? null,
        coverage:
          sides && briefCoverage
            ? { for: coverage(briefCoverage.for), against: coverage(briefCoverage.against) }
            : null,
        decided: decided ? { nationalCouncil: decision(decided.nationalCouncil) } : null,
        citations: Object.fromEntries(Object.entries(known).filter(([id]) => used.has(id))),
        recordUrl: httpsUrl(object.parliamentUrl),
      };
    },

    async listPreparedQuestions({
      consultationId,
      language,
    }: BriefRequest): Promise<readonly PreparedQuestion[]> {
      const object = await loadObject(consultationId);
      if (!object || !Array.isArray(object.prepared)) return [];
      const review = isObject(object.review) ? object.review : {};
      // Prepared answers are published with the brief, under the same review.
      if (review.status !== 'approved') return [];
      return object.prepared.flatMap((item): PreparedQuestion[] => {
        if (!isObject(item)) return [];
        const key = text(item.key);
        const question = pickLanguage(item.question, language, text);
        if (!key || !question) return [];
        const prepared = pickLanguage(item.answers, language, (value) => answer(value, language));
        return [{ key, question: question.value, answer: prepared?.value ?? null }];
      });
    },

    async ask(
      { consultationId, language, question }: AskRequest,
      onProgress?: (progress: AskProgress) => void,
    ): Promise<AssistantAnswer> {
      const asked = question.trim();
      if (!asked || asked.length > MAX_QUESTION_LENGTH) {
        throw new DeliberationError('INVALID_QUESTION', 'The question is empty or too long');
      }
      const object = await loadObject(consultationId);
      const businessId = object ? text(object.businessId) : null;
      if (!object || !businessId) {
        throw new DeliberationError(
          'UNKNOWN_CONSULTATION',
          'The assistant holds no evidence for this consultation',
        );
      }
      let response: Response;
      try {
        response = await request('/parliament/ask/stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // The whole request. Nothing about the person is in it.
          body: JSON.stringify({ question: asked, language, businessId }),
        });
      } catch {
        throw new DeliberationError('ASSISTANT_UNAVAILABLE', 'The assistant did not answer', true);
      }
      if (response.status === 401 || response.status === 403) {
        throw new DeliberationError(
          'SIGN_IN_REQUIRED',
          'Own questions are not open to everyone yet',
        );
      }
      if (response.status === 429) {
        throw new DeliberationError('ALLOWANCE_SPENT', 'No questions are left for now', true);
      }
      if (!response.ok) {
        throw new DeliberationError('ASSISTANT_UNAVAILABLE', 'The assistant did not answer', true);
      }

      const outcome: { answer: AssistantAnswer | null; failed: boolean } = {
        answer: null,
        failed: false,
      };
      try {
        await readLines(response, (line) => {
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (!isObject(event)) return;
          if (event.type === 'stage') {
            const stage = text(event.stage) ?? text(event.name);
            if (stage) onProgress?.({ stage });
          } else if (event.type === 'answer') {
            outcome.answer = answer(event.answer, language);
          } else if (event.type === 'error') {
            outcome.failed = true;
          }
        });
      } catch {
        throw new DeliberationError('ASSISTANT_UNAVAILABLE', 'The answer was cut short', true);
      }
      const result = outcome.answer;
      if (outcome.failed) {
        throw new DeliberationError(
          'ASSISTANT_UNAVAILABLE',
          'The assistant could not answer',
          true,
        );
      }
      if (!result) {
        throw new DeliberationError(
          'INVALID_RESPONSE',
          'The assistant returned no sentence with a source',
        );
      }
      return result;
    },
  };
}
