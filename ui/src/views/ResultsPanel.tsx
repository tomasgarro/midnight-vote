import { Callout, Card, Eyebrow } from '@/components/system';
import type { CicoLocale } from '@/integration/locale';
import { CHAIN_RUNTIME_ENABLED } from '@/views/app-runtime';
import { usePublicReferendumState } from '@/views/use-public-referendum-state';
import './results-panel.css';

/**
 * The public tally, read live from the contract.
 *
 * Two things changed from the panel this replaces.
 *
 * The three bars were three hues -- green Yes, red No, grey Abstain. That is
 * one accent per option in an app whose stated rule is one accent, and it also
 * editorialised: a green Yes and a red No tell the reader which answer is the
 * good one, on a consultation where the project has no position. Every bar is
 * now the accent, and the label and the number carry the difference.
 *
 * The COMMIT phase used to render a full results heading with an empty body,
 * which reads as results that failed to load. It is now stated as what it is:
 * a count of sealed answers and a sentence saying totals do not exist yet.
 *
 * That count was labelled "eligible people". It is the contract's number of
 * accepted commitments: answers that were sealed, not people who could answer.
 *
 * The contract stays in COMMIT after its closing time until someone closes it
 * on chain. During that gap the panel said "Voting open" while every new
 * answer was being refused. It now reads the schedule as well as the phase.
 */

const PHASE_COPY = {
  es: {
    COMMIT: {
      label: 'Respuestas abiertas',
      note: 'Las respuestas están selladas. Todavía no hay nada que contar.',
    },
    CLOSED_WAITING: {
      label: 'Respuestas cerradas',
      note: 'Ya no se aceptan respuestas. El recuento empieza cuando la consulta se cierra en la cadena.',
    },
    REVEAL: {
      label: 'Recuento en curso',
      note: 'Cada respuesta se suma a su total sin revelar de quién vino.',
    },
    FINALIZED: { label: 'Resultado final', note: 'El recuento está cerrado y publicado.' },
  },
  en: {
    COMMIT: {
      label: 'Answers open',
      note: 'Answers are sealed. There is nothing to count yet.',
    },
    CLOSED_WAITING: {
      label: 'Answers closed',
      note: 'No more answers are accepted. Counting starts once the consultation is closed on chain.',
    },
    REVEAL: {
      label: 'Counting in progress',
      note: 'Each answer is added to its total without revealing who gave it.',
    },
    FINALIZED: { label: 'Final result', note: 'Counting is closed and published.' },
  },
  fr: {
    COMMIT: {
      label: 'Réponses ouvertes',
      note: "Les réponses sont scellées. Il n'y a encore rien à compter.",
    },
    CLOSED_WAITING: {
      label: 'Réponses closes',
      note: 'Aucune réponse n’est plus acceptée. Le décompte commence quand la consultation est close sur la chaîne.',
    },
    REVEAL: {
      label: 'Décompte en cours',
      note: "Chaque réponse est ajoutée à son total sans révéler qui l'a donnée.",
    },
    FINALIZED: { label: 'Résultat final', note: 'Le décompte est clos et publié.' },
  },
} as const;

/** In demo there is no contract behind this panel, and saying so is the point. */
const DEMO_NOTE = {
  es: 'Demo local: no hay contrato ni recuento detrás de este panel. En Preview los totales se leen del contrato.',
  en: 'Local demo: there is no contract or tally behind this panel. On Preview the totals are read from the contract.',
  fr: 'Démo locale : aucun contrat ni décompte derrière ce panneau. Sur Preview, les totaux sont lus depuis le contrat.',
} as const;

const CHOICE_LABEL = {
  es: { YES: 'Sí', NO: 'No', ABSTAIN: 'Sin decidir' },
  en: { YES: 'Yes', NO: 'No', ABSTAIN: 'Undecided' },
  fr: { YES: 'Oui', NO: 'Non', ABSTAIN: 'Ne se prononce pas' },
} as const;

/** The frame around the bars: heading, error title, and the two counted lines. */
const SHELL_COPY = {
  es: {
    unreadable: 'Sin lectura del contrato',
    heading: 'Resultados públicos',
    sealed: (n: bigint) => (n === 1n ? 'respuesta sellada' : 'respuestas selladas'),
    total: (counted: bigint, issued: bigint) =>
      `${counted.toString()} ${counted === 1n ? 'contada' : 'contadas'} de ${issued.toString()} ${issued === 1n ? 'sellada' : 'selladas'} · leído del contrato`,
  },
  en: {
    unreadable: 'Contract unreadable',
    heading: 'Public results',
    sealed: (n: bigint) => (n === 1n ? 'sealed answer' : 'sealed answers'),
    total: (counted: bigint, issued: bigint) =>
      `${counted.toString()} counted of ${issued.toString()} sealed · read from the contract`,
  },
  fr: {
    unreadable: 'Contrat illisible',
    heading: 'Résultats publics',
    sealed: (n: bigint) => (n === 1n ? 'réponse scellée' : 'réponses scellées'),
    total: (counted: bigint, issued: bigint) =>
      `${counted.toString()} ${counted === 1n ? 'comptée' : 'comptées'} sur ${issued.toString()} ${issued === 1n ? 'scellée' : 'scellées'} · lu depuis le contrat`,
  },
} as const;

export interface ResultsPanelProps {
  readonly contractAddress: string | null;
  readonly title?: string;
  readonly locale: CicoLocale;
}

function titleId(contractAddress: string | null, title?: string): string {
  return title
    ? `results-title-${contractAddress?.replace(/[^a-z0-9_-]/giu, '-') ?? 'runtime'}`
    : 'results-title';
}

/** True once the contract's own closing time has passed, whatever its phase says. */
function isPastClose(
  state: { readonly closesAtUnix: bigint } | null,
  nowMs: number = Date.now(),
): boolean {
  return state !== null && BigInt(Math.floor(nowMs / 1000)) >= state.closesAtUnix;
}

export function ResultsPanel({ contractAddress, title, locale }: ResultsPanelProps) {
  const { state, error } = usePublicReferendumState(contractAddress);
  const headingId = titleId(contractAddress, title);
  const copy = PHASE_COPY[locale];
  const shell = SHELL_COPY[locale];

  /* An unreadable contract is a warning, not a result. It never renders as a
     zero, for the same reason WaitState renders a dash: a 0% bar claims we
     observed no votes when in fact we observed nothing. */
  if (error) {
    return (
      <Callout tone="warning" role="status" title={shell.unreadable}>
        {error}
      </Callout>
    );
  }

  /* Before the state arrives, and while voting is open, the honest screen is
     the same one: there is nothing to count. */
  if (!state || state.phase === 'COMMIT') {
    const sealed = state?.issuedVotes ?? null;
    const before = isPastClose(state) ? copy.CLOSED_WAITING : copy.COMMIT;
    return (
      <Card className="results" aria-labelledby={headingId}>
        <Eyebrow>{before.label}</Eyebrow>
        <h2 className="results__title" id={headingId}>
          {title ?? shell.heading}
        </h2>
        <p className="results__note">{CHAIN_RUNTIME_ENABLED ? before.note : DEMO_NOTE[locale]}</p>
        {sealed === null ? null : (
          <p className="results__eligible">
            <strong>{sealed.toString()}</strong> {shell.sealed(sealed)}
          </p>
        )}
      </Card>
    );
  }

  const phase = copy[state.phase];
  const votes = (['YES', 'NO', 'ABSTAIN'] as const).map((key) => ({
    key,
    label: CHOICE_LABEL[locale][key],
    count: state.tally.get(key) ?? 0n,
  }));
  const total = votes.reduce((sum, vote) => sum + vote.count, 0n);

  return (
    <Card className="results" aria-labelledby={headingId}>
      <Eyebrow>{phase.label}</Eyebrow>
      <h2 className="results__title" id={headingId}>
        {title ?? shell.heading}
      </h2>
      <p className="results__note">{phase.note}</p>
      <div className="results__tally">
        {votes.map(({ key, label, count }) => {
          const pct = total === 0n ? 0 : Number((count * 1000n) / total) / 10;
          return (
            <div className="results__row" key={key} data-choice={key}>
              <div className="results__head">
                <span className="results__label">{label}</span>
                <span className="results__figure">
                  {count.toString()} · {pct.toFixed(1)}%
                </span>
              </div>
              <div
                className="results__track"
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Number(pct.toFixed(1))}
              >
                <div className="results__fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="results__total">{shell.total(total, state.issuedVotes)}</p>
    </Card>
  );
}
