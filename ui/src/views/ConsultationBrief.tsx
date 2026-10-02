import { ArrowUpRight, CaretDown, PlayCircle } from '@phosphor-icons/react';
import {
  type AssistantAnswer,
  asksHowToAnswer,
  type ConsultationBrief as Brief,
  type CitedSentence,
  type DeliberationAssistantPort,
  type EvidenceCitation,
  isDeliberationError,
  MAX_QUESTION_LENGTH,
  type PreparedQuestion,
  type SideCoverage,
} from 'midnight-referendum-api/deliberation';
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { Button, Callout, Card, Sheet, StatGroup, StatRow } from '@/components/system';
import { assistantLanguage } from '@/integration/deliberation';
import { formatDate } from '@/integration/format';
import type { CicoLocale } from '@/integration/locale';
import { BRIEF_COPY, type BriefCopy } from '@/views/consultation-brief-copy';
import './consultation-brief.css';

/**
 * Understand, then Ask: what a consultation is about, from the record.
 *
 * Every sentence ends in the sources it rests on, and a source opens in a
 * sheet with the speaker's own words in their own language. The two sides
 * are two lists in the same ink, always For and then Against, so the page
 * takes no side by its layout.
 *
 * This component knows a consultation and a language. It is handed no pass,
 * no session and no answer, so nothing it sends can carry one.
 */

export interface ConsultationBriefProps {
  readonly assistant: DeliberationAssistantPort;
  readonly consultationId: string;
  readonly locale: CicoLocale;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'none' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'ready';
      readonly brief: Brief;
      readonly questions: readonly PreparedQuestion[];
    };

interface OpenCitation {
  readonly number: number;
  readonly citation: EvidenceCitation;
}

type AskFailure = 'signIn' | 'spent' | 'failed' | 'unsourced' | 'declined';

const INTL_TAG: Record<CicoLocale, string> = { es: 'es-AR', en: 'en-GB', fr: 'fr-FR' };

function languageName(code: string, locale: CicoLocale): string {
  try {
    return new Intl.DisplayNames([INTL_TAG[locale]], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Numbers sources in the order a reader meets them. */
function numberSources(sentences: readonly CitedSentence[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const sentence of sentences) {
    for (const id of sentence.citationIds) {
      if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    }
  }
  return numbers;
}

function answerSentences(answer: AssistantAnswer): CitedSentence[] {
  return [
    ...(answer.lead ? [answer.lead] : []),
    ...answer.sections.flatMap((section) => section.paragraphs),
  ];
}

/*
 * The parliamentary groups, by the short name a reader knows. The record gives
 * the group's full name in French or German, which is too long to sit inside
 * a sentence. Order matters: the Union démocratique du Centre is not the
 * Centre, and the Green Liberals are not the Greens.
 */
const PARTIES: ReadonlyArray<{
  readonly match: RegExp;
  readonly label: Readonly<Record<CicoLocale, string>>;
}> = [
  {
    match: /union démocratique du centre|volkspartei|\b(udc|svp)\b|^v$/iu,
    label: { en: 'SVP', es: 'SVP', fr: 'UDC' },
  },
  {
    match: /vert.?libéra|grünliberal|\b(glp|pvl)\b|^gl$/iu,
    label: { en: 'GLP', es: 'GLP', fr: 'PVL' },
  },
  { match: /\bverts\b|grüne|^g$/iu, label: { en: 'Greens', es: 'Verdes', fr: 'Verts' } },
  {
    match: /socialiste|sozialdemokrat|\b(sp|ps)\b|^s$/iu,
    label: { en: 'SP', es: 'SP', fr: 'PS' },
  },
  {
    match: /libéral-radical|libéraux-radicaux|freisinn|\b(fdp|plr)\b|^rl$/iu,
    label: { en: 'FDP', es: 'FDP', fr: 'PLR' },
  },
  {
    match: /centre|mitte|^m-e$|^ce$/iu,
    label: { en: 'Centre', es: 'Centro', fr: 'Le Centre' },
  },
];

function partyLabel(group: string | null, locale: CicoLocale): string | null {
  if (!group) return null;
  return PARTIES.find((party) => party.match.test(group.trim()))?.label[locale] ?? null;
}

/**
 * Who makes an argument. The record's sentences usually name the speaker
 * already, so the party is added after the name; a sentence that names nobody
 * starts with the speaker.
 */
function withSpeaker(
  sentence: CitedSentence,
  citations: Readonly<Record<string, EvidenceCitation>>,
  locale: CicoLocale,
): CitedSentence {
  const citation = sentence.citationIds.map((id) => citations[id]).find(Boolean);
  if (!citation) return sentence;
  const party = partyLabel(citation.group, locale);
  const at = sentence.text.indexOf(citation.speaker);
  if (at >= 0) {
    if (!party) return sentence;
    const end = at + citation.speaker.length;
    return {
      ...sentence,
      text: `${sentence.text.slice(0, end)} (${party})${sentence.text.slice(end)}`,
    };
  }
  return {
    ...sentence,
    text: `${citation.speaker}${party ? ` (${party})` : ''}: ${sentence.text}`,
  };
}

interface SentenceProps {
  readonly sentence: CitedSentence;
  readonly citations: Readonly<Record<string, EvidenceCitation>>;
  readonly numbers: ReadonlyMap<string, number>;
  readonly onOpen: (open: OpenCitation) => void;
  readonly copy: BriefCopy;
  readonly locale: CicoLocale;
}

function Sentence({ sentence, citations, numbers, onOpen, copy, locale }: SentenceProps) {
  return (
    <>
      {sentence.text}{' '}
      {sentence.citationIds.map((id) => {
        const citation = citations[id];
        const number = numbers.get(id);
        if (!citation || number === undefined) return null;
        return (
          <button
            type="button"
            key={id}
            className="brief__cite"
            aria-label={copy.citeLabel(number, citation.speaker, formatDate(citation.date, locale))}
            onClick={() => onOpen({ number, citation })}
          >
            {number}
          </button>
        );
      })}
    </>
  );
}

interface AnswerProps {
  readonly answer: AssistantAnswer;
  readonly onOpen: (open: OpenCitation) => void;
  readonly copy: BriefCopy;
  readonly locale: CicoLocale;
}

function Answer({ answer, onOpen, copy, locale }: AnswerProps) {
  const numbers = numberSources(answerSentences(answer));
  const shared = { citations: answer.citations, numbers, onOpen, copy, locale };
  // What the answer cannot say always ends with how to answer.
  const limits = [
    ...answer.limitations.flatMap((code) => {
      const text = copy.limit[code];
      return text ? [{ code, text }] : [];
    }),
    { code: 'advice', text: copy.cannotAdvice },
  ];
  return (
    <div className="brief__answer" lang={answer.language}>
      {answer.lead ? (
        <section className="brief__answer-section">
          <h4 className="brief__answer-title" lang={locale}>
            {copy.inShort}
          </h4>
          <p className="brief__prose">
            <Sentence sentence={answer.lead} {...shared} />
          </p>
        </section>
      ) : null}
      {answer.sections.map((section) => (
        <section key={section.title} className="brief__answer-section">
          <h4 className="brief__answer-title">{section.title}</h4>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph.text} className="brief__prose">
              <Sentence sentence={paragraph} {...shared} />
            </p>
          ))}
        </section>
      ))}
      {limits.length > 0 ? (
        <div className="brief__limits" lang={locale}>
          <p className="brief__limits-label">{copy.limits}</p>
          <ul>
            {limits.map((limit) => (
              <li key={limit.code}>{limit.text}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function coverageNote(coverage: SideCoverage, copy: BriefCopy): string | null {
  if (coverage.level === 'thin') return copy.coverThin(coverage.passages, coverage.speakers);
  if (coverage.level === 'single') return copy.coverOne;
  if (coverage.level === 'silent') return copy.coverSilent;
  return null;
}

export function ConsultationBrief({ assistant, consultationId, locale }: ConsultationBriefProps) {
  const copy = BRIEF_COPY[locale];
  const language = assistantLanguage(locale);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [openCitation, setOpenCitation] = useState<OpenCitation | null>(null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [askFailure, setAskFailure] = useState<AskFailure | null>(null);
  const questionId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    let current = true;
    setLoaded({ status: 'loading' });
    setAnswer(null);
    setAskFailure(null);
    setOpenQuestion(null);
    Promise.all([
      assistant.getBrief({ consultationId, language }),
      assistant.listPreparedQuestions({ consultationId, language }),
    ]).then(
      ([brief, questions]) => {
        if (current) setLoaded(brief ? { status: 'ready', brief, questions } : { status: 'none' });
      },
      () => {
        if (current) setLoaded({ status: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [assistant, consultationId, language, attempt]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const question = draft.trim();
      if (!question || asking) return;
      // Asked how to answer: declined here, and nothing is sent.
      if (asksHowToAnswer(question)) {
        setAnswer(null);
        setAskFailure('declined');
        return;
      }
      setAsking(true);
      setAnswer(null);
      setAskFailure(null);
      try {
        setAnswer(await assistant.ask({ consultationId, language, question }));
      } catch (error) {
        const code = isDeliberationError(error) ? error.code : null;
        setAskFailure(
          code === 'ADVICE_DECLINED'
            ? 'declined'
            : code === 'SIGN_IN_REQUIRED'
              ? 'signIn'
              : code === 'ALLOWANCE_SPENT'
                ? 'spent'
                : code === 'INVALID_RESPONSE'
                  ? 'unsourced'
                  : 'failed',
        );
      } finally {
        setAsking(false);
      }
    },
    [asking, assistant, consultationId, draft, language],
  );

  if (loaded.status === 'loading') {
    return (
      <p className="brief__status" role="status">
        {copy.loading}
      </p>
    );
  }
  if (loaded.status === 'none') {
    return <Callout role="status">{copy.none}</Callout>;
  }
  if (loaded.status === 'failed') {
    return (
      <Callout tone="warning" role="alert">
        {copy.unavailable}{' '}
        <Button variant="link" size="sm" onClick={() => setAttempt((value) => value + 1)}>
          {copy.retry}
        </Button>
      </Callout>
    );
  }

  const { brief, questions } = loaded;
  const sides = brief.arguments;
  const numbers = numberSources(sides ? [...sides.for, ...sides.against] : []);
  const shared = {
    citations: brief.citations,
    numbers,
    onOpen: setOpenCitation,
    copy,
    locale,
  };
  const council = brief.decided?.nationalCouncil ?? null;
  const open = openCitation?.citation ?? null;
  // The answer in two sentences, from the record alone: when the vote is,
  // and how the National Council voted.
  const voteDate = brief.voteDate ? formatDate(brief.voteDate, locale) : null;
  const short = [
    voteDate ? copy.shortVote(voteDate) : null,
    council
      ? copy.shortCouncil(council.counts.yes, council.counts.no, council.counts.abstained)
      : null,
  ].filter((line): line is string => Boolean(line));

  const side = (label: string, sentences: readonly CitedSentence[], coverage?: SideCoverage) => {
    const note = coverage ? coverageNote(coverage, copy) : null;
    return (
      <div className="brief__side">
        <h4 className="brief__side-label">{label}</h4>
        {sentences.length > 0 ? (
          <ul className="brief__list" lang={brief.language}>
            {sentences.map((sentence) => (
              <li key={sentence.text}>
                <Sentence sentence={withSpeaker(sentence, brief.citations, locale)} {...shared} />
              </li>
            ))}
          </ul>
        ) : null}
        {note ? <p className="brief__note">{note}</p> : null}
      </div>
    );
  };

  return (
    <div className="brief">
      <section className="brief__section" aria-labelledby={`${questionId}-understand`}>
        <h3 className="sys-eyebrow" id={`${questionId}-understand`}>
          {copy.understand}
        </h3>

        {short.length > 0 ? (
          <div className="brief__short">
            <h4 className="brief__heading">{copy.inShort}</h4>
            <p className="brief__prose">{short.join(' ')}</p>
          </div>
        ) : null}

        <Card tone="sunken" className="brief__title">
          <p className="brief__label">{copy.officialTitle}</p>
          <p className="brief__official" lang={brief.officialTitleLanguage}>
            {brief.officialTitle}
          </p>
          <p className="brief__note">{copy.titleNote}</p>
          {brief.officialSource ? (
            <a
              className="brief__link"
              href={brief.officialSource.url}
              target="_blank"
              rel="noreferrer"
            >
              {brief.officialSource.publisher} <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          ) : null}
        </Card>

        {council ? (
          <Card>
            <StatGroup label={copy.decided}>
              <StatRow label={copy.yes} value={String(council.counts.yes)} />
              <StatRow label={copy.no} value={String(council.counts.no)} />
              <StatRow label={copy.abstained} value={String(council.counts.abstained)} />
            </StatGroup>
            <p className="brief__note">{copy.nationalCouncil(formatDate(council.date, locale))}</p>
            {council.meaningYes ? (
              <p className="brief__note">
                {copy.meaningYes}: <q lang="und">{council.meaningYes}</q>
              </p>
            ) : null}
            {council.meaningNo ? (
              <p className="brief__note">
                {copy.meaningNo}: <q lang="und">{council.meaningNo}</q>
              </p>
            ) : null}
          </Card>
        ) : null}

        <div className="brief__arguments">
          <h4 className="brief__heading">{copy.arguments}</h4>
          {sides ? (
            <>
              <p className="brief__note">{copy.argumentsNote}</p>
              {brief.language !== language || locale === 'es' ? (
                <p className="brief__note">
                  {copy.otherLanguage(languageName(brief.language, locale))}
                </p>
              ) : null}
              {side(copy.forSide, sides.for, brief.coverage?.for)}
              {side(copy.againstSide, sides.against, brief.coverage?.against)}
            </>
          ) : (
            <Callout role="status" title={copy.inPreparation}>
              {copy.inPreparationBody}
            </Callout>
          )}
        </div>

        <div className="brief__limits">
          <p className="brief__limits-label">{copy.cannot}</p>
          <ul>
            <li>{copy.cannotAdvice}</li>
            <li>{copy.cannotOutside}</li>
          </ul>
        </div>

        {brief.review ? (
          <details className="brief__how">
            <summary>
              {copy.howMade} <CaretDown className="brief__caret" size={16} aria-hidden="true" />
            </summary>
            <p className="brief__prose">{copy.howRule}</p>
            <StatGroup label={copy.howMade}>
              <StatRow
                label={copy.review}
                value={copy.reviewed(
                  brief.review.reviewer,
                  formatDate(brief.review.reviewedAt, locale),
                )}
              />
              {brief.updatedAt ? (
                <StatRow
                  label={copy.updated}
                  value={formatDate(brief.updatedAt, locale) ?? brief.updatedAt}
                />
              ) : null}
              {brief.model ? <StatRow label={copy.model} value={brief.model} /> : null}
            </StatGroup>
            {brief.recordUrl ? (
              <a className="brief__link" href={brief.recordUrl} target="_blank" rel="noreferrer">
                {copy.fullRecord} <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            ) : null}
          </details>
        ) : null}
      </section>

      <section className="brief__section" aria-labelledby={`${questionId}-ask`}>
        <h3 className="sys-eyebrow" id={`${questionId}-ask`}>
          {copy.ask}
        </h3>
        <p className="brief__note">{copy.noAdvice}</p>

        {questions.length > 0 ? (
          <div className="brief__prepared">
            <h4 className="brief__heading">{copy.prepared}</h4>
            <p className="brief__note">{copy.preparedNote}</p>
            <ul className="brief__questions">
              {questions.map((question) => {
                const expanded = openQuestion === question.key;
                const panel = `${questionId}-${question.key}`;
                return (
                  <li key={question.key}>
                    <button
                      type="button"
                      className="brief__question"
                      aria-expanded={expanded}
                      aria-controls={panel}
                      onClick={() => setOpenQuestion(expanded ? null : question.key)}
                    >
                      <span>{question.question}</span>
                      <CaretDown className="brief__caret" size={16} aria-hidden="true" />
                    </button>
                    {expanded ? (
                      <div id={panel} className="brief__question-panel">
                        {question.answer ? (
                          <Answer
                            answer={question.answer}
                            onOpen={setOpenCitation}
                            copy={copy}
                            locale={locale}
                          />
                        ) : (
                          <p className="brief__note">{copy.preparedPending}</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <form className="brief__ask" onSubmit={(event) => void submit(event)}>
          <label className="brief__heading" htmlFor={`${questionId}-own`}>
            {copy.own}
          </label>
          <textarea
            id={`${questionId}-own`}
            className="brief__input"
            rows={2}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder={copy.placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="brief__note">{copy.privacy}</p>
          <Button type="submit" size="sm" disabled={asking || !draft.trim()}>
            {copy.send}
          </Button>
        </form>
        {asking ? (
          <p className="brief__status" role="status">
            {copy.asking}
          </p>
        ) : null}
        {askFailure ? (
          <Callout
            tone={askFailure === 'signIn' || askFailure === 'declined' ? 'neutral' : 'warning'}
            role="alert"
          >
            {copy[askFailure]}
          </Callout>
        ) : null}
        {answer ? (
          <Card>
            <Answer answer={answer} onOpen={setOpenCitation} copy={copy} locale={locale} />
          </Card>
        ) : null}
      </section>

      <Sheet
        open={openCitation !== null}
        title={openCitation ? copy.citation(openCitation.number) : ''}
        onClose={() => setOpenCitation(null)}
        closeLabel={copy.close}
      >
        {open ? (
          <div className="brief__citation">
            <p className="brief__label">
              {copy.original(languageName(open.quoteLanguage, locale))}
            </p>
            <blockquote className="brief__quote" lang={open.quoteLanguage}>
              {open.quote}
            </blockquote>
            <StatGroup label={copy.passage}>
              <StatRow label={copy.speaker} value={open.speaker} />
              {open.role ? <StatRow label={copy.role} value={open.role} /> : null}
              {open.group ? <StatRow label={copy.group} value={open.group} /> : null}
              {open.chamber ? <StatRow label={copy.chamber} value={open.chamber} /> : null}
              <StatRow label={copy.date} value={formatDate(open.date, locale) ?? open.date} />
            </StatGroup>
            <div className="brief__citation-links">
              {open.officialUrl ? (
                <a className="brief__link" href={open.officialUrl} target="_blank" rel="noreferrer">
                  {copy.openRecord} <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              ) : null}
              {open.video ? (
                <a
                  className="brief__link"
                  href={`${open.video.url}#t=${Math.floor(open.video.start)},${Math.ceil(open.video.end)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <PlayCircle size={16} aria-hidden="true" />{' '}
                  {copy.watch(clock(open.video.start), clock(open.video.end))}
                </a>
              ) : null}
            </div>
            {open.video ? <p className="brief__note">{copy.watchNote}</p> : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
