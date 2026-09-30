import {
  ArrowLeft,
  ArrowRight,
  Check,
  LockKey,
  MagnifyingGlass,
  Plant,
  Scales,
  X,
} from '@phosphor-icons/react';
import {
  CIVIC_PULSE_VERSION,
  type ExplanationAreaId,
  LocalDemoPriorityPulseAdapter,
  type PriorityId,
  type PulseDraft,
  type TradeoffId,
} from 'midnight-referendum-api/pulse';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CompanionFigure } from '@/components/companion';
import { useJourneyHistory } from '@/components/passport-v2/useJourneyHistory';
import type { CicoLocale } from '@/integration/locale';
import { BUDGET_COPY } from './budget-copy';
import {
  eraseReflection,
  REFLECTION_COPY,
  readReflection,
  saveReflection,
} from './local-reflection';
import { PULSE_COPY } from './pulse-copy';
import './pulse-experience.css';
import './pulse-reflection.css';

type Stage =
  | 'home'
  | 'intro'
  | 'priorities'
  | 'values'
  | 'budget'
  | 'funding'
  | 'explanations'
  | 'review'
  | 'complete';
const PRIORITIES: PriorityId[] = [
  'cost-of-living',
  'healthcare',
  'education',
  'housing',
  'climate',
  'public-safety',
];
const VALUES: TradeoffId[] = [
  'act-sooner',
  'build-consensus',
  'target-support',
  'universal-services',
  'prefer-not-to-answer',
];
const INFORMATION: ExplanationAreaId[] = ['costs', 'delivery', 'evidence', 'tradeoffs'];
const stages: Stage[] = ['priorities', 'values', 'budget', 'funding', 'explanations', 'review'];
const toggle = <T extends string>(items: T[], item: T) =>
  items.includes(item) ? items.filter((v) => v !== item) : [...items, item];
export interface PulseExperienceProps {
  readonly onExploreReferenda?: () => void;
  readonly onExit?: () => void;
  readonly embedded?: boolean;
  readonly locale?: CicoLocale;
  readonly onDiscuss?: (summary: string) => void;
}
export function PulseExperience({
  onExploreReferenda,
  onExit,
  embedded = false,
  locale = 'en',
  onDiscuss,
}: PulseExperienceProps) {
  const t = PULSE_COPY[locale];
  const budgetCopy = BUDGET_COPY[locale];
  const reflectionCopy = REFLECTION_COPY[locale];
  const [saved, setSaved] = useState(readReflection);
  const [savedThisRun, setSavedThisRun] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Optional reflection stays in component memory, separate from the legacy pulse adapter.
  const [budget, setBudget] = useState<string | null>(null);
  const [funding, setFunding] = useState<string | null>(null);

  const adapter = useMemo(() => new LocalDemoPriorityPulseAdapter(), []);
  const journey = useJourneyHistory<Stage>('home', onExit);
  const { stage, go } = journey;
  const [priorities, setPriorities] = useState<PriorityId[]>([]);
  const [tradeoffs, setTradeoffs] = useState<TradeoffId[]>([]);
  const [explanationAreas, setExplanationAreas] = useState<ExplanationAreaId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (stage) {
      title.current?.focus();
      title.current?.scrollIntoView?.({ block: 'nearest' });
      setError(null);
    }
  }, [stage]);
  const reset = () => {
    setSavedThisRun(false);
    setBudget(null);
    setFunding(null);
    setPriorities([]);
    setTradeoffs([]);
    setExplanationAreas([]);
    setError(null);
    setEditing(false);
    if (onExit) onExit();
    else go('home');
  };
  const eraseAndReset = () => {
    if (!eraseReflection()) {
      setStorageError(true);
      return;
    }
    setSaved(null);
    reset();
  };
  const next = (target: Stage) => {
    go(editing ? 'review' : target);
    setEditing(false);
  };
  const choosePriority = (id: PriorityId) => {
    if (!priorities.includes(id) && priorities.length === 3) {
      setError(t.cap);
      return;
    }
    setError(null);
    setPriorities(toggle(priorities, id));
  };
  const chooseValue = (id: TradeoffId) =>
    setTradeoffs(
      id === 'prefer-not-to-answer'
        ? tradeoffs.includes(id)
          ? []
          : [id]
        : toggle(
            tradeoffs.filter((v) => v !== 'prefer-not-to-answer'),
            id,
          ),
    );
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    const draft: PulseDraft = {
      questionnaireVersion: CIVIC_PULSE_VERSION,
      actorLane: 'human',
      priorities,
      tradeoffs,
      explanationAreas,
    };
    try {
      await adapter.completeLocalDemo(draft);
      setSavedThisRun(false);
      setCopyState('idle');
      go('complete');
    } catch {
      setError(t.cap);
    } finally {
      setBusy(false);
    }
  };
  const step = stages.indexOf(stage);
  const heading = (value: string) => (
    <h1 ref={title} tabIndex={-1}>
      {value}
    </h1>
  );
  const primary = (label: string, action: () => void, disabled = false) => (
    <button
      className="pulse-button pulse-button--primary"
      type="button"
      onClick={action}
      disabled={disabled}
    >
      {label}
      <ArrowRight size={19} />
    </button>
  );
  const reviewGroups = [
    ...(
      [
        ['budget', budget],
        ['funding', funding],
      ] as const
    ).map(([target, value], i) => ({
      name: budgetCopy.groups[i],
      target: target as Stage,
      labels: (budgetCopy.options[i] ?? [])
        .filter((option) => option[0] === value)
        .map((option) => option[1]),
    })),
    {
      name: t.groups[0],
      target: 'priorities' as Stage,
      labels: priorities.map((id) => t.priorities[PRIORITIES.indexOf(id)]?.[0] ?? id),
    },
    {
      name: t.groups[1],
      target: 'values' as Stage,
      labels: tradeoffs.map((id) => t.values[VALUES.indexOf(id)]?.[0] ?? id),
    },
    {
      name: t.groups[2],
      target: 'explanations' as Stage,
      labels: explanationAreas.map((id) => t.information[INFORMATION.indexOf(id)]),
    },
  ];
  const summary = reviewGroups
    .map((group) => `${group.name}: ${group.labels.join(' · ') || t.skipped}`)
    .join('\n');
  const discussionPrompt = `${reflectionCopy.prompt}\n\n${summary}`;
  const persist = () => {
    const snapshot = {
      version: 1 as const,
      savedAt: new Date().toISOString(),
      priorities,
      tradeoffs,
      explanationAreas,
      budget,
      funding,
    };
    const ok = saveReflection(snapshot);
    setStorageError(!ok);
    if (ok) {
      setSaved(snapshot);
      setSavedThisRun(true);
    }
  };
  const restore = () => {
    if (!saved) return;
    setPriorities(saved.priorities);
    setTradeoffs(saved.tradeoffs);
    setExplanationAreas(saved.explanationAreas);
    setBudget(saved.budget);
    setFunding(saved.funding);
    setEditing(false);
    go('review');
  };
  return (
    <div className={`pulse-v4 ${embedded ? 'pulse-v4--embedded' : ''}`}>
      <header className="pulse-v4__header">
        <button
          type="button"
          aria-label={stage === 'home' ? t.exit : t.back}
          onClick={
            stage === 'complete'
              ? reset
              : stage === 'home'
                ? (onExit ?? onExploreReferenda ?? reset)
                : journey.back
          }
        >
          <ArrowLeft size={20} />
        </button>
        <span>{t.name}</span>
        {stage !== 'home' ? (
          <button type="button" aria-label={t.exit} onClick={reset}>
            <X size={20} />
          </button>
        ) : (
          <LockKey size={20} />
        )}
      </header>
      {step >= 0 ? (
        <div
          className="pulse-v4__progress"
          role="progressbar"
          aria-label={`${t.step} ${step + 1} ${t.of} ${stages.length}`}
          aria-valuemin={1}
          aria-valuemax={stages.length}
          aria-valuenow={step + 1}
        >
          {stages.map((s, i) => (
            <span key={s} data-done={i <= step} />
          ))}
        </div>
      ) : null}
      <main className="pulse-v4__body" key={stage}>
        {stage === 'home' ? (
          <section className="pulse-v4__welcome">
            <div className="pulse-v4__art">
              <Plant size={76} weight="duotone" />
            </div>
            <p className="sys-eyebrow">{t.private}</p>
            {heading(t.homeTitle)}
            <p>{t.homeBody}</p>
            <span className="pulse-v4__duration">{budgetCopy.duration}</span>
            <div className="pulse-v4__actions">
              {saved && (
                <>
                  {primary(reflectionCopy.resume, restore)}
                  <button
                    type="button"
                    className="pulse-v4__skip"
                    onClick={() => {
                      const ok = eraseReflection();
                      setStorageError(!ok);
                      if (ok) setSaved(null);
                    }}
                  >
                    {reflectionCopy.remove}
                  </button>
                </>
              )}
              {storageError && <p role="alert">{reflectionCopy.failed}</p>}
              {primary(t.start, () => go('intro'))}
              <small>{t.homeNote}</small>
            </div>
          </section>
        ) : null}
        {stage === 'intro' ? (
          <section className="pulse-v4__welcome">
            <div className="pulse-v4__companion">
              <CompanionFigure pose="explain" />
            </div>
            {heading(t.introTitle)}
            <p>{t.introBody}</p>
            <p className="pulse-v4__privacy">
              <LockKey size={20} />
              {t.privacy}
            </p>
            <div className="pulse-v4__actions">{primary(t.begin, () => go('priorities'))}</div>
          </section>
        ) : null}
        {step >= 0 ? (
          <section>
            <div className="pulse-v4__question-icon">
              {step === 0 ? (
                <Plant size={28} />
              ) : step === 1 ? (
                <Scales size={28} />
              ) : step === 2 ? (
                <MagnifyingGlass size={28} />
              ) : (
                <Check size={28} />
              )}
            </div>
            <p className="sys-eyebrow">
              {step === 0 ? t.required : stage !== 'review' ? t.optional : t.private}
            </p>
            {heading(
              stage === 'budget'
                ? budgetCopy.titles[0]
                : stage === 'funding'
                  ? budgetCopy.titles[1]
                  : (t.titles[stage === 'explanations' ? 2 : stage === 'review' ? 3 : step] ?? ''),
            )}
            <p className="pulse-v4__lead">
              {stage === 'budget'
                ? budgetCopy.bodies[0]
                : stage === 'funding'
                  ? budgetCopy.bodies[1]
                  : t.bodies[stage === 'explanations' ? 2 : stage === 'review' ? 3 : step]}
            </p>
            {stage === 'priorities' ? (
              <>
                <p className="pulse-v4__count" aria-live="polite">
                  {priorities.length} {t.of} 3 {t.selected}
                </p>
                <div className="pulse-option-list">
                  {PRIORITIES.map((id, i) => (
                    <button
                      key={id}
                      type="button"
                      className="pulse-option"
                      aria-pressed={priorities.includes(id)}
                      onClick={() => choosePriority(id)}
                    >
                      <span>
                        <strong>{t.priorities[i]?.[0]}</strong>
                        <small>{t.priorities[i]?.[1]}</small>
                      </span>
                      <span className="pulse-option__check" aria-hidden="true">
                        {priorities.includes(id) ? <Check size={16} /> : null}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="pulse-v4__actions">
                  {error ? <p role="alert">{error}</p> : null}
                  {primary(t.next, () => next('values'), priorities.length === 0)}
                </div>
              </>
            ) : null}
            {stage === 'values' ? (
              <>
                <div className="pulse-option-list">
                  {VALUES.map((id, i) => (
                    <button
                      key={id}
                      type="button"
                      className="pulse-option"
                      aria-pressed={tradeoffs.includes(id)}
                      onClick={() => chooseValue(id)}
                    >
                      <span>
                        <strong>{t.values[i]?.[0]}</strong>
                        <small>{t.values[i]?.[1]}</small>
                      </span>
                      <span className="pulse-option__check" aria-hidden="true">
                        {tradeoffs.includes(id) ? <Check size={16} /> : null}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="pulse-v4__actions">
                  {primary(t.next, () => next('budget'))}
                  <button
                    className="pulse-v4__skip"
                    type="button"
                    onClick={() => {
                      setTradeoffs([]);
                      next('budget');
                    }}
                  >
                    {t.skip}
                  </button>
                </div>
              </>
            ) : null}
            {stage === 'budget' || stage === 'funding' ? (
              <>
                {stage === 'budget' && (
                  <p className="pulse-budget-definition">{budgetCopy.definition}</p>
                )}
                <fieldset
                  className="pulse-option-list"
                  aria-label={budgetCopy.groups[stage === 'budget' ? 0 : 1]}
                >
                  {budgetCopy.options[stage === 'budget' ? 0 : 1].map(([id, label, detail]) => (
                    <button
                      className="pulse-option"
                      type="button"
                      key={id}
                      aria-pressed={(stage === 'budget' ? budget : funding) === id}
                      onClick={() => (stage === 'budget' ? setBudget(id) : setFunding(id))}
                    >
                      <span>
                        <strong>{label}</strong>
                        <small>{detail}</small>
                      </span>
                      <span className="pulse-option__check" aria-hidden="true">
                        {(stage === 'budget' ? budget : funding) === id && <Check size={16} />}
                      </span>
                    </button>
                  ))}
                </fieldset>
                <div className="pulse-v4__actions">
                  {primary(t.next, () => next(stage === 'budget' ? 'funding' : 'explanations'))}
                  <button
                    className="pulse-v4__skip"
                    type="button"
                    onClick={() => {
                      if (stage === 'budget') setBudget(null);
                      else setFunding(null);
                      next(stage === 'budget' ? 'funding' : 'explanations');
                    }}
                  >
                    {t.skip}
                  </button>
                </div>
              </>
            ) : null}
            {stage === 'explanations' ? (
              <>
                <div className="pulse-option-list">
                  {INFORMATION.map((id, i) => (
                    <button
                      key={id}
                      type="button"
                      className="pulse-option"
                      aria-pressed={explanationAreas.includes(id)}
                      onClick={() => setExplanationAreas(toggle(explanationAreas, id))}
                    >
                      <strong>{t.information[i]}</strong>
                      <span className="pulse-option__check" aria-hidden="true">
                        {explanationAreas.includes(id) ? <Check size={16} /> : null}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="pulse-v4__actions">
                  {primary(t.review, () => next('review'))}
                  <button
                    className="pulse-v4__skip"
                    type="button"
                    onClick={() => {
                      setExplanationAreas([]);
                      next('review');
                    }}
                  >
                    {t.skip}
                  </button>
                </div>
              </>
            ) : null}
            {stage === 'review' ? (
              <>
                <div className="pulse-v4__review">
                  {reviewGroups.map((group) => (
                    <section key={group.target}>
                      <header>
                        <h2>{group.name}</h2>
                        <button
                          type="button"
                          aria-label={`${t.edit}: ${group.name}`}
                          onClick={() => {
                            setEditing(true);
                            go(group.target);
                          }}
                        >
                          {t.edit}
                        </button>
                      </header>
                      <p>{group.labels.join(' · ') || t.skipped}</p>
                    </section>
                  ))}
                </div>
                <div className="pulse-v4__actions">
                  {error ? <p role="alert">{error}</p> : null}
                  {primary(t.finish, () => void finish(), busy)}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
        {stage === 'complete' ? (
          <section className="pulse-v4__welcome pulse-v4__complete">
            <div className="pulse-v4__art">
              <Plant size={76} weight="duotone" />
            </div>
            {heading(t.completeTitle)}
            <p>{t.completeBody}</p>
            <p className="pulse-v4__privacy">
              <LockKey size={20} />
              {savedThisRun ? reflectionCopy.saved : t.completeNote}
            </p>
            <div className="pulse-reflection-summary">
              {reviewGroups.map((group) => (
                <section key={group.target}>
                  <h2>{group.name}</h2>
                  <p>{group.labels.join(' · ') || t.skipped}</p>
                </section>
              ))}
            </div>
            <div className="pulse-v4__actions">
              <p className="pulse-local-note">{reflectionCopy.note}</p>
              <button
                type="button"
                className="pulse-button pulse-button--primary"
                disabled={savedThisRun}
                onClick={persist}
              >
                {savedThisRun ? reflectionCopy.saved : reflectionCopy.save}
              </button>
              {storageError && <p role="alert">{reflectionCopy.failed}</p>}
              <p className="pulse-local-note">{reflectionCopy.handoff}</p>
              {onDiscuss && primary(reflectionCopy.discuss, () => onDiscuss(summary))}
              <button
                type="button"
                className="pulse-v4__skip"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(discussionPrompt);
                    setCopyState('copied');
                  } catch {
                    setCopyState('failed');
                  }
                }}
              >
                {reflectionCopy.copy}
              </button>
              {copyState !== 'idle' && (
                <p role="status">
                  {copyState === 'copied' ? reflectionCopy.copied : reflectionCopy.copyFailed}
                </p>
              )}
              {copyState === 'failed' && (
                <textarea
                  readOnly
                  aria-label={reflectionCopy.copy}
                  value={discussionPrompt}
                  rows={8}
                />
              )}
              <button
                type="button"
                className="pulse-v4__skip"
                onClick={() => (onExit ?? (() => go('home')))()}
              >
                {reflectionCopy.return}
              </button>
              <button type="button" className="pulse-v4__skip" onClick={eraseAndReset}>
                {t.erase}
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
