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
 * a count of eligible people and a sentence saying totals do not exist yet.
 */

const PHASE_COPY = {
  es: {
    COMMIT: {
      label: 'Votación abierta',
      note: 'Los votos están sellados. Todavía no hay nada que contar.',
    },
    REVEAL: {
      label: 'Recuento en curso',
      note: 'Cada voto se suma a su total sin revelar de quién vino.',
    },
    FINALIZED: { label: 'Resultado final', note: 'El recuento está cerrado y publicado.' },
  },
  en: {
    COMMIT: { label: 'Voting open', note: 'Votes are sealed. There is nothing to count yet.' },
    REVEAL: {
      label: 'Counting in progress',
      note: 'Each vote is added without revealing who cast it.',
    },
    FINALIZED: { label: 'Final result', note: 'Counting is closed and published.' },
  },
  fr: {
    COMMIT: {
      label: 'Vote ouvert',
      note: "Les votes sont scellés. Il n'y a encore rien à compter.",
    },
    REVEAL: {
      label: 'Dépouillement en cours',
      note: "Chaque voix est ajoutée à son total sans révéler qui l'a exprimée.",
    },
    FINALIZED: { label: 'Résultat final', note: 'Le dépouillement est clos et publié.' },
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
    eligible: (n: bigint) => (n === 1n ? 'persona habilitada' : 'personas habilitadas'),
    total: (counted: bigint, issued: bigint) =>
      `${counted.toString()} de ${issued.toString()} habilitadas · leído del contrato`,
    none: 'Todavía no se contó ninguna respuesta.',
    few: 'Con menos de 100 respuestas contadas se muestran los números, sin porcentajes.',
  },
  en: {
    unreadable: 'Contract unreadable',
    heading: 'Public results',
    eligible: (n: bigint) => (n === 1n ? 'eligible person' : 'eligible people'),
    total: (counted: bigint, issued: bigint) =>
      `${counted.toString()} of ${issued.toString()} eligible · read from contract`,
    none: 'No answer has been counted yet.',
    few: 'Below 100 counted answers, the numbers are shown without percentages.',
  },
  fr: {
    unreadable: 'Contrat illisible',
    heading: 'Résultats publics',
    eligible: (n: bigint) => (n === 1n ? 'personne éligible' : 'personnes éligibles'),
    total: (counted: bigint, issued: bigint) =>
      `${counted.toString()} sur ${issued.toString()} éligibles · lu depuis le contrat`,
    none: 'Aucune réponse n’a encore été comptée.',
    few: 'Sous 100 réponses comptées, les nombres sont affichés sans pourcentage.',
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
    const eligible = state?.issuedVotes ?? null;
    return (
      <Card className="results" aria-labelledby={headingId}>
        <Eyebrow>{copy.COMMIT.label}</Eyebrow>
        <h2 className="results__title" id={headingId}>
          {title ?? shell.heading}
        </h2>
        <p className="results__note">
          {CHAIN_RUNTIME_ENABLED ? copy.COMMIT.note : DEMO_NOTE[locale]}
        </p>
        {eligible === null ? null : (
          <p className="results__eligible">
            <strong>{eligible.toString()}</strong> {shell.eligible(eligible)}
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
  // A percentage of a handful reads as a trend it is not, and a 0% bar claims
  // an observation. Below 100 the counts stand alone; at 0 there is a sentence.
  const showShare = total >= 100n;

  return (
    <Card className="results" aria-labelledby={headingId}>
      <Eyebrow>{phase.label}</Eyebrow>
      <h2 className="results__title" id={headingId}>
        {title ?? shell.heading}
      </h2>
      <p className="results__note">{phase.note}</p>
      {total === 0n ? <p className="results__note">{shell.none}</p> : null}
      {total > 0n && !showShare ? <p className="results__note">{shell.few}</p> : null}
      <div className="results__tally" hidden={total === 0n}>
        {votes.map(({ key, label, count }) => {
          const pct = total === 0n ? 0 : Number((count * 1000n) / total) / 10;
          return (
            <div className="results__row" key={key} data-choice={key}>
              <div className="results__head">
                <span className="results__label">{label}</span>
                <span className="results__figure">
                  {showShare ? `${pct.toFixed(1)}% (${count.toString()})` : count.toString()}
                </span>
              </div>
              {showShare ? (
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
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="results__total">{shell.total(total, state.issuedVotes)}</p>
    </Card>
  );
}
