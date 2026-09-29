import { ArrowUpRight, CheckCircle, Clock, Copy, Lock, Receipt } from '@phosphor-icons/react';
import { Button, Callout, Card, Display, EmptyState, Eyebrow } from '@/components/system';
import { formatDate, formatDateTime } from '@/integration/format';
import { HOSTED_PROVING_COPY } from '@/integration/hosted-proving';
import type { CicoLocale } from '@/integration/locale';
import { getPollAvailability, type PollAvailability } from '@/integration/poll-lifecycle';
import { SEALED_ANSWER_COPY, type SealedAnswer } from '@/integration/sealed-answers';
import type { HostedProvingState } from '@/providers/midnight-providers';
import { CopyReceiptButton } from '@/views/CopyReceiptButton';
import { localizePoll, type Poll, type VoteReceipt } from '@/views/poll-model';
import { ReceiptVerifier } from '@/views/ReceiptVerifier';
import { ResultsPanel } from '@/views/ResultsPanel';
import './activity-view.css';

/**
 * A receipt used to be an identifier and a timestamp, which answered "did it go
 * through" and nothing else. The two questions people actually arrive with are
 * "is that consultation still running" and "what did it decide", and both were
 * answerable already: this view is handed the whole poll list and only used it
 * to look up a title.
 *
 * What it deliberately does not offer is a way to change the vote. The
 * contract's nullifier makes a second vote impossible, and the receipt store
 * never records the choice -- so the honest thing, and the thing that explains
 * the privacy design, is to say the vote is sealed rather than to leave the
 * question hanging.
 */

const COPY = {
  es: {
    eyebrow: 'Tu actividad',
    title: 'Comprobantes de participación',
    lead: 'Guardados cifrados en este dispositivo. Un comprobante demuestra estado, no muestra tu elección.',
    emptyTitle: 'Todavía no hay actividad',
    empty: 'Cuando completes una votación, el comprobante aparecerá acá.',
    consultation: 'Consulta ciudadana',
    confirmed: 'Confirmado',
    simulated: 'Simulado',
    pending: 'Pendiente',
    copy: 'Copiar comprobante',
    statusOpen: 'Votación abierta',
    statusClosed: 'Votación cerrada',
    statusNotOpen: 'Todavía no abrió',
    closesOn: 'Cierra el',
    closedOn: 'Cerró el',
    sealed: 'Tu voto está sellado y no se puede cambiar.',
    sealedWhy:
      'El contrato registra un anulador por persona y por consulta, así que nadie puede votar dos veces — vos incluido.',
    resultsPending: 'Los resultados se publican en la cadena cuando termina el recuento.',
    resultsDemo:
      'Demo local: esta consulta no tiene un contrato detrás, así que no hay recuento para mostrar.',
    resultsTitle: 'Resultado de esta consulta',
  },
  en: {
    eyebrow: 'Your activity',
    title: 'Participation receipts',
    lead: 'Stored encrypted on this device. A receipt shows status, not your choice.',
    emptyTitle: 'No activity yet',
    empty: 'When you complete a vote, its receipt will appear here.',
    consultation: 'Civic consultation',
    confirmed: 'Confirmed',
    simulated: 'Simulated',
    pending: 'Pending',
    copy: 'Copy receipt',
    statusOpen: 'Voting open',
    statusClosed: 'Voting closed',
    statusNotOpen: 'Not open yet',
    closesOn: 'Closes',
    closedOn: 'Closed',
    sealed: 'Your vote is sealed and cannot be changed.',
    sealedWhy:
      'The contract records one nullifier per person per consultation, so nobody can vote twice — including you.',
    resultsPending: 'Results are published on-chain once counting ends.',
    resultsDemo:
      'Local demo: this consultation has no contract behind it, so there is no tally to show.',
    resultsTitle: 'Result of this consultation',
  },
  fr: {
    eyebrow: 'Votre activité',
    title: 'Reçus de participation',
    lead: 'Conservés chiffrés sur cet appareil. Un reçu atteste un statut, il ne révèle pas votre choix.',
    emptyTitle: 'Aucune activité pour le moment',
    empty: 'Dès que vous aurez voté, votre reçu apparaîtra ici.',
    consultation: 'Consultation citoyenne',
    confirmed: 'Confirmé',
    simulated: 'Simulé',
    pending: 'En attente',
    copy: 'Copier le reçu',
    statusOpen: 'Vote ouvert',
    statusClosed: 'Vote clos',
    statusNotOpen: 'Pas encore ouvert',
    closesOn: 'Clôture le',
    closedOn: 'Clos le',
    sealed: 'Votre vote est scellé et ne peut pas être modifié.',
    sealedWhy:
      'Le contrat enregistre un annulateur par personne et par consultation : personne ne peut voter deux fois, vous y compris.',
    resultsPending: 'Les résultats sont publiés sur la chaîne une fois le dépouillement terminé.',
    resultsDemo:
      "Démo locale : cette consultation n'a pas de contrat derrière elle, il n'y a donc aucun décompte à afficher.",
    resultsTitle: 'Résultat de cette consultation',
  },
} as const;

export type CountNotice = 'count-not-open' | 'pass-missing' | 'try-again';

export interface ActivityViewProps {
  readonly polls: readonly Poll[];
  readonly receipts: readonly VoteReceipt[];
  /** Answers sealed on-chain from this device, read from its vault. */
  readonly sealedAnswers?: readonly SealedAnswer[];
  /** The referendum whose answer is being counted right now. */
  readonly countingId?: string | null;
  readonly countNotices?: Readonly<Record<string, CountNotice>>;
  readonly onCount?: (referendumId: string) => void;
  readonly hostedProving?: HostedProvingState;
  readonly locale: CicoLocale;
}

/**
 * A malformed schedule must not take the whole screen down with it. Runtime
 * polls can arrive without dates, and `getPollAvailability` throws on an
 * interval it cannot parse.
 */
function availabilityOf(poll: Poll): PollAvailability | null {
  try {
    return getPollAvailability(poll);
  } catch {
    return null;
  }
}

export function ActivityView({
  polls,
  receipts,
  sealedAnswers = [],
  countingId = null,
  countNotices = {},
  onCount,
  hostedProving,
  locale,
}: ActivityViewProps) {
  const copy = COPY[locale];
  const sealedCopy = SEALED_ANSWER_COPY[locale];
  const hostedCopy = HOSTED_PROVING_COPY[locale];
  const waitingForCount = sealedAnswers.some((answer) => answer.state === 'sealed');
  /* Counting needs a proof. On a device without a wallet that means the
     proving server, and the person is asked before it is used. */
  const needsConsent =
    waitingForCount && Boolean(hostedProving?.offered) && !hostedProving?.accepted;

  return (
    <main className="activity">
      <header className="activity__head">
        <Eyebrow>{copy.eyebrow}</Eyebrow>
        <Display>{copy.title}</Display>
        <p>{copy.lead}</p>
      </header>

      {sealedAnswers.length ? (
        <section className="activity__sealed" aria-labelledby="sealed-answers-title">
          <h2 className="activity__section-title" id="sealed-answers-title">
            {sealedCopy.heading}
          </h2>
          <p className="activity__section-lead">{sealedCopy.lead}</p>
          {needsConsent ? (
            <Callout tone="warning" role="status" title={hostedCopy.title}>
              {hostedCopy.body} {hostedCopy.alternative}
              <span className="activity__consent">
                <Button size="sm" variant="secondary" onClick={() => hostedProving?.accept()}>
                  {hostedCopy.accept}
                </Button>
              </span>
            </Callout>
          ) : null}
          <ol className="activity__list">
            {sealedAnswers.map((answer) => {
              const poll = polls.find((item) => item.id === answer.referendumId);
              const availability = poll ? availabilityOf(poll) : null;
              const closed = availability
                ? !availability.isOpen && availability.reason !== 'not-open'
                : false;
              const closesLabel = poll ? formatDate(poll.closesAt, locale) : null;
              const contractAddress = poll?.runtimeContractAddress ?? null;
              const counting = countingId === answer.referendumId;
              const notice = countNotices[answer.referendumId];
              const stateLabel =
                answer.state === 'counted'
                  ? sealedCopy.counted
                  : answer.state === 'missed'
                    ? sealedCopy.missed
                    : sealedCopy.sealed;
              return (
                <li key={answer.referendumId}>
                  <Card className="activity-card">
                    <span
                      className="activity-card__icon"
                      data-confirmed={answer.state === 'counted'}
                    >
                      {answer.state === 'counted' ? (
                        <CheckCircle size={22} weight="fill" />
                      ) : answer.state === 'missed' ? (
                        <Clock size={22} />
                      ) : (
                        <Lock size={22} weight="fill" />
                      )}
                    </span>
                    <div className="activity-card__body">
                      <div className="activity-card__top">
                        <strong>
                          {poll ? localizePoll(poll, locale).title : copy.consultation}
                        </strong>
                        <span data-confirmed={answer.state === 'counted'}>{stateLabel}</span>
                      </div>

                      {availability && closesLabel ? (
                        <p className="activity-card__lifecycle">
                          <span className="activity-card__status" data-open={availability.isOpen}>
                            {availability.reason === 'not-open'
                              ? copy.statusNotOpen
                              : availability.isOpen
                                ? copy.statusOpen
                                : copy.statusClosed}
                          </span>
                          <span className="activity-card__closes">
                            {availability.isOpen ? copy.closesOn : copy.closedOn} {closesLabel}
                          </span>
                        </p>
                      ) : null}

                      <p className="activity-card__sealed">
                        <span>
                          {answer.state === 'counted'
                            ? sealedCopy.countedBody
                            : answer.state === 'missed'
                              ? answer.reason === 'opening-lost'
                                ? sealedCopy.missedLost
                                : sealedCopy.missedClosed
                              : closed
                                ? sealedCopy.sealedClosed
                                : sealedCopy.sealedOpen}{' '}
                          {answer.state === 'sealed' ? sealedCopy.publicAtCount : null}
                        </span>
                      </p>

                      {answer.state === 'sealed' && closed && onCount ? (
                        <div className="activity-card__actions">
                          <Button
                            size="sm"
                            disabled={counting || needsConsent}
                            onClick={() => onCount(answer.referendumId)}
                          >
                            {counting ? sealedCopy.counting : sealedCopy.count}
                          </Button>
                        </div>
                      ) : null}
                      {notice && !counting ? (
                        <p className="activity-card__results-note" role="status">
                          {notice === 'count-not-open'
                            ? sealedCopy.waitingCount
                            : notice === 'pass-missing'
                              ? sealedCopy.waitingPass
                              : sealedCopy.waitingRetry}
                        </p>
                      ) : null}

                      {closed && contractAddress ? (
                        <div className="activity-card__results">
                          <ResultsPanel
                            contractAddress={contractAddress}
                            title={copy.resultsTitle}
                            locale={locale}
                          />
                        </div>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {receipts.length ? (
        <ol className="activity__list">
          {receipts.map((receipt) => {
            const confirmed = receipt.status === 'confirmed';
            const poll = polls.find((item) => item.id === receipt.pollId);
            const availability = poll ? availabilityOf(poll) : null;
            const isOpen = availability?.isOpen ?? false;
            const closesLabel = poll ? formatDate(poll.closesAt, locale) : null;
            const contractAddress = poll?.runtimeContractAddress ?? null;
            return (
              <li key={receipt.id}>
                <Card className="activity-card">
                  <span className="activity-card__icon" data-confirmed={confirmed}>
                    {confirmed ? <CheckCircle size={22} weight="fill" /> : <Clock size={22} />}
                  </span>
                  <div className="activity-card__body">
                    <div className="activity-card__top">
                      <strong>{poll ? localizePoll(poll, locale).title : copy.consultation}</strong>
                      <span data-confirmed={confirmed}>
                        {confirmed ? copy.confirmed : copy.simulated}
                      </span>
                    </div>

                    {availability ? (
                      <p className="activity-card__lifecycle">
                        <span className="activity-card__status" data-open={isOpen}>
                          {availability.reason === 'not-open'
                            ? copy.statusNotOpen
                            : isOpen
                              ? copy.statusOpen
                              : copy.statusClosed}
                        </span>
                        {closesLabel ? (
                          <span className="activity-card__closes">
                            {isOpen ? copy.closesOn : copy.closedOn} {closesLabel}
                          </span>
                        ) : null}
                      </p>
                    ) : null}

                    <time dateTime={receipt.createdAt}>
                      {formatDateTime(receipt.createdAt, locale) ?? receipt.createdAt}
                    </time>
                    <code>{receipt.id}</code>

                    <p className="activity-card__sealed">
                      <Lock size={14} weight="fill" aria-hidden="true" />
                      <span>
                        <strong>{copy.sealed}</strong> {copy.sealedWhy}
                      </span>
                    </p>

                    <div className="activity-card__actions">
                      <CopyReceiptButton receiptId={receipt.id} locale={locale} />
                      {receipt.explorerUrl ? (
                        <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                          <ArrowUpRight size={16} /> Explorer
                        </a>
                      ) : null}
                    </div>

                    {/* A tally only exists where a contract does. Everywhere else
                        the screen says so rather than rendering an empty chart. */}
                    {availability && !isOpen ? (
                      contractAddress ? (
                        <div className="activity-card__results">
                          <ResultsPanel
                            contractAddress={contractAddress}
                            title={copy.resultsTitle}
                            locale={locale}
                          />
                        </div>
                      ) : (
                        <p className="activity-card__results-note">
                          {confirmed ? copy.resultsPending : copy.resultsDemo}
                        </p>
                      )
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      ) : sealedAnswers.length ? null : (
        <EmptyState icon={<Receipt size={30} />} title={copy.emptyTitle} message={copy.empty} />
      )}

      <ReceiptVerifier receipts={receipts} locale={locale} />
      <span className="sr-only">
        <Copy /> {copy.copy} · {copy.pending}
      </span>
    </main>
  );
}
