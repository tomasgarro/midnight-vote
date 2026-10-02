import { ArrowRight, ArrowUp, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import bust from '@/assets/companion/cleisthenes-bust.webp';
import { countryName } from '@/integration/country-catalog';
import type { CicoLocale } from '@/integration/locale';
import { REFLECTION_COPY } from '@/pulse/local-reflection';
import { answerCatalogue, GUIDE_COPY, type GuideAnswer } from './catalogue-guide';
import { CHAT_PROMPTS } from './chat-prompts';
import { localizePoll, type Poll, pollPlaceCode } from './poll-model';
import './catalogue-chat.css';
export interface CatalogueMessage {
  id: number;
  question: string;
  answer: GuideAnswer;
}

/** The sources of one consultation, in the reader's language when it has them. */
function localizedSources(
  polls: readonly Poll[],
  pollId: string,
  locale: CicoLocale,
): Poll['sources'] {
  const poll = polls.find((item) => item.id === pollId);
  return poll ? localizePoll(poll, locale).sources : [];
}

export function CatalogueChat({
  polls,
  locale,
  country,
  onOpenPolicy,
  initialMessages = [],
  onMessagesChange,
  reflectionContext,
  onClearReflection,
  briefIds = [],
}: {
  polls: readonly Poll[];
  locale: CicoLocale;
  country?: string;
  onOpenPolicy: (id: string) => void;
  /** Consultations that have a reviewed brief. Each one opens on its own page. */
  briefIds?: readonly string[];
  initialMessages?: CatalogueMessage[];
  onMessagesChange?: (messages: CatalogueMessage[]) => void;
  reflectionContext?: string | null;
  onClearReflection?: () => void;
}) {
  const t = GUIDE_COPY[locale];
  const prompts = CHAT_PROMPTS[locale];
  const [promptGroup, setPromptGroup] = useState<'places' | 'topics'>('places');
  const [pending, setPending] = useState<CatalogueMessage | null>(null);
  const pendingRef = useRef<CatalogueMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<CatalogueMessage[]>(initialMessages);
  const latest = messages[messages.length - 1]?.answer;
  const lastId =
    latest?.selectedId ?? (latest?.pollIds.length === 1 ? latest.pollIds[0] : undefined);
  const updateMessages = (next: CatalogueMessage[]) => {
    setMessages(next);
    onMessagesChange?.(next);
  };
  const scroll = useRef<HTMLDivElement>(null);
  const id = useRef(initialMessages[initialMessages.length - 1]?.id ?? 0);
  const countries = [...new Set(polls.map(pollPlaceCode).filter((c): c is string => Boolean(c)))];
  const briefs = polls
    .filter((poll) => briefIds.includes(poll.id))
    .map((poll) => localizePoll(poll, locale));
  useEffect(() => {
    const pane = scroll.current;
    if (!messages.length && !pending?.id) {
      if (pane) pane.scrollTop = 0;
      return;
    }
    const exchanges = pane?.querySelectorAll<HTMLElement>('.catalogue-chat__exchange');
    const exchange = exchanges?.[exchanges.length - 1];
    if (pane && exchange) {
      // Scroll only the conversation, never the page or the app frame.
      pane.scrollTop +=
        exchange.getBoundingClientRect().top - pane.getBoundingClientRect().top - 24;
    }
  }, [messages.length, pending?.id]);
  const reveal = (message: CatalogueMessage) => {
    clearTimeout(timer.current);
    pendingRef.current = null;
    setPending(null);
    updateMessages([...messages.slice(-19), message]);
  };
  const send = (value: string) => {
    if (!value.trim() || pendingRef.current) return;
    const answer = answerCatalogue(value.trim(), polls, locale, country, lastId);
    const message = { id: ++id.current, question: value.trim(), answer };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) reveal(message);
    else {
      pendingRef.current = message;
      setPending(message);
      timer.current = setTimeout(() => reveal(message), 550);
    }
    setQuestion('');
  };
  return (
    <main className="catalogue-chat">
      <header className="catalogue-chat__header">
        <span>
          <img className="catalogue-chat__face" src={bust} alt="" width="28" height="28" />
          {t.name}
        </span>
        <button
          type="button"
          aria-label={t.clear}
          title={t.clear}
          onClick={() => {
            clearTimeout(timer.current);
            pendingRef.current = null;
            setPending(null);
            updateMessages([]);
            onClearReflection?.();
            setQuestion('');
          }}
        >
          <Trash size={19} />
        </button>
      </header>
      <div className="catalogue-chat__scroll" ref={scroll}>
        {reflectionContext && (
          <section className="catalogue-chat__reflection">
            <h2>{REFLECTION_COPY[locale].context}</h2>
            <p>{reflectionContext}</p>
            <small>{t.disclosure}</small>
            <button type="button" onClick={onClearReflection}>
              {locale === 'es'
                ? 'Quitar del chat'
                : locale === 'fr'
                  ? 'Retirer du chat'
                  : 'Remove from chat'}
            </button>
          </section>
        )}
        {messages.length > 0 && <h1 className="sr-only">{t.name}</h1>}
        <section className="catalogue-chat__intro" hidden={messages.length > 0 || Boolean(pending)}>
          <div className="catalogue-chat__robot">
            <img src={bust} alt="" width="88" height="88" />
          </div>
          <p className="sys-eyebrow">{t.badge}</p>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
        </section>
        {briefs.length > 0 && (
          <section
            className="catalogue-chat__briefs"
            aria-labelledby="catalogue-briefs-title"
            hidden={messages.length > 0 || Boolean(pending)}
          >
            <h2 id="catalogue-briefs-title">{t.briefs}</h2>
            <p>{t.briefsBody}</p>
            {briefs.map((poll) => (
              <button type="button" key={poll.id} onClick={() => onOpenPolicy(poll.id)}>
                {poll.title}
                <ArrowRight size={16} />
              </button>
            ))}
          </section>
        )}
        <div
          className="catalogue-chat__suggestions"
          hidden={messages.length > 0 || Boolean(pending)}
        >
          <button type="button" onClick={() => send(t.open)}>
            {t.open}
            <ArrowRight size={16} />
          </button>
          <button type="button" onClick={() => send(t.global)}>
            {t.global}
            <ArrowRight size={16} />
          </button>
          <fieldset className="chat-prompt-tabs" aria-label={prompts.topics}>
            {(['places', 'topics'] as const).map((group) => (
              <button
                type="button"
                key={group}
                aria-pressed={promptGroup === group}
                onClick={() => setPromptGroup(group)}
              >
                {prompts[group]}
              </button>
            ))}
          </fieldset>
          {promptGroup === 'topics' &&
            prompts.topicNames.map((topic) => (
              <button type="button" key={topic} onClick={() => send(`${prompts.prompt} ${topic}`)}>
                {topic}
                <ArrowRight size={16} />
              </button>
            ))}
          {promptGroup === 'places' &&
            countries.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => send(`${t.country}: ${countryName(c, locale)}`)}
              >
                {countryName(c, locale)}
                <ArrowRight size={16} />
              </button>
            ))}
        </div>
        <div role="log" aria-live="polite" aria-label={t.name} className="catalogue-chat__messages">
          {messages.map((m) => (
            <section key={m.id} className="catalogue-chat__exchange">
              <p className="catalogue-chat__question">
                <span className="sr-only">{t.you}: </span>
                {m.question}
              </p>
              <div className="catalogue-chat__answer">
                <span className="sys-eyebrow">
                  {t.badge}
                  {m.answer.scope ? ` · ${m.answer.scope}` : ''}
                </span>
                <div className="chat-response-prose">
                  {/* A structured answer says everything in its parts; the
                      plain text stays for a refusal and for narrow questions. */}
                  {!m.answer.sections || m.answer.declined
                    ? m.answer.text.split('\n\n').map((paragraph, index) => (
                        <p key={paragraph} style={{ animationDelay: `${index * 90}ms` }}>
                          {paragraph}
                        </p>
                      ))
                    : null}
                  {m.answer.sections?.map((section, index) => (
                    <section
                      key={section.kind}
                      className="chat-answer-section"
                      style={{ animationDelay: `${(index + 1) * 90}ms` }}
                    >
                      <h3>{section.title}</h3>
                      {section.kind === 'source' && m.answer.selectedId
                        ? localizedSources(polls, m.answer.selectedId, locale).map((source) => (
                            <a
                              className="chat-citation"
                              key={source.href}
                              href={source.href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.label} ↗
                            </a>
                          ))
                        : section.lines.map((line) => <p key={line}>{line}</p>)}
                    </section>
                  ))}
                </div>
                {m.answer.selectedId && (
                  <fieldset className="chat-followups" aria-label={prompts.follow}>
                    {/* The answer already holds the summary, both sides and the
                        limits and every source. What is left to ask for is the context. */}
                    {(['evidence'] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        disabled={Boolean(pending)}
                        onClick={() => {
                          const selected = polls.find((p) => p.id === m.answer.selectedId);
                          if (selected)
                            send(`${prompts[kind]}: ${localizePoll(selected, locale).title}`);
                        }}
                      >
                        {prompts[kind]}
                      </button>
                    ))}
                  </fieldset>
                )}
                {m.answer.selectedId &&
                  /source|fuente/i.test(m.question) &&
                  !m.answer.sections &&
                  localizedSources(polls, m.answer.selectedId, locale).map((source) => (
                    <a
                      className="chat-citation"
                      key={source.href}
                      href={source.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.label} ↗
                    </a>
                  ))}
                {m.answer.pollIds.map((pId) => {
                  const source = polls.find((p) => p.id === pId);
                  if (!source) return null;
                  const p = localizePoll(source, locale);
                  return (
                    <article className="catalogue-chat__source" key={pId}>
                      <h2>{p.title}</h2>
                      <small>
                        {pollPlaceCode(p)
                          ? countryName(pollPlaceCode(p) ?? '', locale)
                          : t.globalLabel}
                      </small>
                      <details className="chat-proposal-preview">
                        <summary>
                          {locale === 'es'
                            ? 'De qué trata'
                            : locale === 'fr'
                              ? 'De quoi s’agit-il ?'
                              : 'What is proposed?'}
                        </summary>
                        <p>{p.description}</p>
                      </details>
                      <div>
                        {!m.answer.selectedId && (
                          <button
                            type="button"
                            disabled={Boolean(pending)}
                            onClick={() => send(`${t.summary} ${p.title}`)}
                          >
                            {t.summary}
                          </button>
                        )}
                        <button type="button" onClick={() => onOpenPolicy(p.id)}>
                          {t.read}
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {pending && (
          <section className="catalogue-chat__exchange">
            <p className="catalogue-chat__question">{pending.question}</p>
            <div className="chat-thinking" role="status">
              <span aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {prompts.thinking}
            </div>
            <button className="chat-reveal" type="button" onClick={() => reveal(pending)}>
              {prompts.stop}
            </button>
          </section>
        )}
      </div>
      <form
        className="catalogue-chat__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <label className="sr-only" htmlFor="catalogue-question">
          {t.input}
        </label>
        <div>
          <input
            id="catalogue-question"
            autoComplete="off"
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t.input}
          />
          <button type="submit" aria-label={t.send} disabled={!question.trim() || Boolean(pending)}>
            <ArrowUp size={22} />
          </button>
        </div>
        <p>{t.disclosure}</p>
      </form>
    </main>
  );
}
