/*
 * The app's boundary to a deliberation assistant.
 *
 * The assistant explains a consultation from a body of evidence: what is being
 * asked, what was decided, and what was argued on each side, every sentence
 * tied to a source. It gives no advice on how to answer.
 *
 * Nothing about the person crosses this boundary. A request carries the
 * consultation, a language and, for a question, its text. It never carries a
 * pass, a Passport session, an answer, or anything derived from them. The
 * assistant therefore cannot link a question to a sealed answer.
 */

export type DeliberationLanguage = 'en' | 'fr' | 'de' | 'it';

export const DELIBERATION_LANGUAGES: readonly DeliberationLanguage[] = ['en', 'fr', 'de', 'it'];

/** One source passage, quoted in its original language. */
export interface EvidenceCitation {
  readonly id: string;
  readonly speaker: string;
  readonly role: string | null;
  readonly group: string | null;
  readonly chamber: string | null;
  /** ISO 8601. */
  readonly date: string;
  readonly quote: string;
  readonly quoteLanguage: string;
  /** The passage in the official record. */
  readonly officialUrl: string | null;
  /** The moment in the official recording. Timing is machine-aligned. */
  readonly video: { readonly url: string; readonly start: number; readonly end: number } | null;
}

/** A sentence and the citations it rests on. A sentence without one is dropped. */
export interface CitedSentence {
  readonly text: string;
  readonly citationIds: readonly string[];
}

export type SideCoverageLevel = 'full' | 'thin' | 'single' | 'silent';

export interface SideCoverage {
  readonly level: SideCoverageLevel;
  readonly passages: number;
  readonly speakers: number;
}

export interface ChamberDecision {
  readonly date: string;
  readonly subject: string | null;
  /** What a yes meant in this vote, in the language of the record. */
  readonly meaningYes: string | null;
  readonly meaningNo: string | null;
  readonly counts: {
    readonly yes: number;
    readonly no: number;
    readonly abstained: number;
  };
  readonly source: string | null;
}

export interface ConsultationBrief {
  readonly consultationId: string;
  /** The official title, word for word. It is never rephrased. */
  readonly officialTitle: string;
  readonly officialTitleLanguage: string;
  readonly officialSource: { readonly publisher: string; readonly url: string } | null;
  readonly voteDate: string | null;
  /** The language the arguments are written in. It may differ from the one asked for. */
  readonly language: DeliberationLanguage;
  /**
   * Null until a named person has reviewed the brief. The arguments are then
   * withheld; the title and the decision come from official records.
   */
  readonly review: { readonly reviewer: string; readonly reviewedAt: string } | null;
  readonly updatedAt: string | null;
  readonly model: string | null;
  /** Always in this order: for, then against. */
  readonly arguments: {
    readonly for: readonly CitedSentence[];
    readonly against: readonly CitedSentence[];
  } | null;
  readonly coverage: { readonly for: SideCoverage; readonly against: SideCoverage } | null;
  readonly decided: { readonly nationalCouncil: ChamberDecision | null } | null;
  readonly citations: Readonly<Record<string, EvidenceCitation>>;
  /** Where the full record can be read. */
  readonly recordUrl: string | null;
}

export interface AssistantAnswer {
  readonly language: DeliberationLanguage;
  readonly lead: CitedSentence | null;
  readonly sections: readonly {
    readonly title: string;
    readonly paragraphs: readonly CitedSentence[];
  }[];
  readonly citations: Readonly<Record<string, EvidenceCitation>>;
  /** What the evidence does not cover, as the assistant reported it. */
  readonly limitations: readonly string[];
  readonly model: string | null;
}

export interface PreparedQuestion {
  readonly key: string;
  readonly question: string;
  /** Answered ahead of time, so it costs nothing to read. Null while unchecked. */
  readonly answer: AssistantAnswer | null;
}

export type DeliberationErrorCode =
  | 'UNKNOWN_CONSULTATION'
  | 'INVALID_QUESTION'
  /** The question asked how to answer. The assistant does not say. */
  | 'ADVICE_DECLINED'
  | 'SIGN_IN_REQUIRED'
  | 'ALLOWANCE_SPENT'
  | 'ASSISTANT_UNAVAILABLE'
  | 'INVALID_RESPONSE';

export class DeliberationError extends Error {
  readonly code: DeliberationErrorCode;
  readonly retryable: boolean;

  constructor(code: DeliberationErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'DeliberationError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function isDeliberationError(value: unknown): value is DeliberationError {
  return value instanceof DeliberationError;
}

export interface BriefRequest {
  readonly consultationId: string;
  readonly language: DeliberationLanguage;
}

export interface AskRequest extends BriefRequest {
  readonly question: string;
}

/** A step of the assistant's research, reported while an answer is prepared. */
export interface AskProgress {
  readonly stage: string;
}

export interface DeliberationAssistantPort {
  readonly adapterName: string;
  /** Null when the assistant holds nothing for the consultation. */
  getBrief(request: BriefRequest): Promise<ConsultationBrief | null>;
  listPreparedQuestions(request: BriefRequest): Promise<readonly PreparedQuestion[]>;
  ask(request: AskRequest, onProgress?: (progress: AskProgress) => void): Promise<AssistantAnswer>;
}

export const MAX_QUESTION_LENGTH = 500;
