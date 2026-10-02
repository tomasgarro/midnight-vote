import { ArrowLeft, ArrowUpRight } from '@phosphor-icons/react';
import { Button, Callout, Card, Display, Screen, StatGroup, StatRow } from '@/components/system';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import { countryName as getCountryName } from '@/integration/country-catalog';
import type { AppAssistant } from '@/integration/deliberation';
import { formatDate, formatDateTime } from '@/integration/format';
import type { CicoLocale } from '@/integration/locale';
import { getPollAvailability } from '@/integration/poll-lifecycle';
import { ConsultationBrief } from '@/views/ConsultationBrief';
import { localizePoll, type Poll, pollPlaceCode } from '@/views/poll-model';
import { ResultsPanel } from '@/views/ResultsPanel';
import './policy-detail-view.css';
import { passBlock, passBlockLine } from './pass-fit';

/**
 * The dossier: everything a person needs to decide, and the action.
 *
 * This screen was nine stacked sections, each announced by an eyebrow, an h2
 * and a Phosphor icon. Nine section headers on one route is not hierarchy --
 * it is nine claims to be the most important thing, which is the same as none.
 * Sections are now one uppercase label on the ground, the pattern every
 * settings and reading screen in the reference set uses.
 *
 * The action moved. "Votar esta consulta" used to sit at the very bottom,
 * after roughly three screens of prose, so the only way to reach the thing the
 * screen exists for was to scroll past everything. It is now pinned in the
 * Screen footer, which is free here because the bottom nav is already hidden
 * on this route.
 *
 * The two argument columns were a green card with check icons and a blue card
 * with info icons -- two accents, and a visual claim that one side is the
 * agreeable one. They are two labelled lists in the same ink.
 *
 * Four honest-disclosure blocks (the demo rules, the eligibility note, the
 * simulated-figures asterisk, the independent-prototype note) said "here is
 * something true you should know" in four visual languages. They are one
 * Callout.
 */

const COPY = {
  es: {
    back: 'Volver',
    open: 'Consulta abierta',
    closed: 'Consulta cerrada',
    facts: 'De un vistazo',
    closes: 'Cierra',
    closedOn: 'Cerró',
    answersClose: 'Las respuestas cierran',
    answersClosed: 'Las respuestas cerraron',
    passesUntil: 'Se puede sumar un pase hasta',
    countingUntil: 'Tu respuesta se puede contar hasta',
    who: 'Quién puede responder',
    whoAdult: 'Personas adultas',
    whoAnyone: 'Cualquier persona',
    withChip: 'con un pasaporte leído por chip',
    withDocument: 'con un documento verificado',
    withPass: 'con un pase',
    ofCountry: (country: string) => `de ${country}`,
    runtimeYes: 'Respondés que sí a la pregunta.',
    runtimeNo: 'Respondés que no a la pregunta.',
    runtimeAbstain: 'No tomás posición. Tu respuesta se cuenta como sin decidir.',
    eligible: 'Habilitadas',
    scope: 'Ámbito',
    milestone: { vote: 'Votación oficial', proposal: 'Propuesta oficial' },
    about: 'De qué se trata',
    frame: 'Marco vigente',
    perspectives: 'Perspectivas',
    forIt: 'A favor',
    againstIt: 'En contra',
    uncertainty: 'Incertidumbre',
    options: 'Qué expresa cada opción',
    yes: 'Sí',
    no: 'No',
    abstain: 'Sin decidir',
    yesBody: 'Apoyás la propuesta tal como se pregunta.',
    noBody: 'No apoyás la propuesta tal como se pregunta.',
    abstainBody: 'Todavía no tomaste una posición.',
    sources: 'Fuentes primarias',
    vote: 'Votá ahora',
    prepare: 'Añadir elegibilidad',
    disclosureTitle: 'Qué es y qué no es esto',
    runtimeDisclosure:
      'La identidad del contrato y sus resultados públicos se leen desde Midnight. La credencial se comprueba en privado contra la política publicada. No es un referéndum oficial ni tiene efecto legal.',
    demoDisclosure:
      'Las cifras de habilitadas y participación son simuladas. La credencial prueba una regla de elegibilidad sin exponer tu evidencia, y no es un padrón oficial. No es un referéndum oficial ni tiene efecto legal.',
  },
  en: {
    back: 'Back',
    open: 'Consultation open',
    closed: 'Consultation closed',
    facts: 'At a glance',
    closes: 'Closes',
    closedOn: 'Closed',
    answersClose: 'Answers close',
    answersClosed: 'Answers closed',
    passesUntil: 'A pass can be added until',
    countingUntil: 'Your answer can be counted until',
    who: 'Who can answer',
    whoAdult: 'Adults',
    whoAnyone: 'Anyone',
    withChip: 'with a passport read by its chip',
    withDocument: 'with a verified document',
    withPass: 'with a pass',
    ofCountry: (country: string) => `from ${country}`,
    runtimeYes: 'You answer yes to the question.',
    runtimeNo: 'You answer no to the question.',
    runtimeAbstain: 'You take no position. Your answer is counted as undecided.',
    eligible: 'Eligible',
    scope: 'Scope',
    milestone: { vote: 'Official vote', proposal: 'Official proposal' },
    about: 'What it is about',
    frame: 'Current framework',
    perspectives: 'Perspectives',
    forIt: 'For',
    againstIt: 'Against',
    uncertainty: 'Uncertainty',
    options: 'What each option expresses',
    yes: 'Yes',
    no: 'No',
    abstain: 'Undecided',
    yesBody: 'You support the proposal as it is asked.',
    noBody: 'You do not support the proposal as it is asked.',
    abstainBody: 'You have not taken a position yet.',
    sources: 'Primary sources',
    vote: 'Vote now',
    prepare: 'Add eligibility',
    disclosureTitle: 'What this is and is not',
    runtimeDisclosure:
      'Contract identity and public results are read from Midnight. The credential is checked privately against the published policy. This is not an official referendum and has no legal effect.',
    demoDisclosure:
      'Eligible and participation figures are simulated. The credential proves an eligibility rule without exposing your evidence, and is not an official register. This is not an official referendum and has no legal effect.',
  },
  fr: {
    back: 'Retour',
    open: 'Consultation ouverte',
    closed: 'Consultation close',
    facts: "En un coup d'oeil",
    closes: 'Clôture',
    closedOn: 'Close le',
    answersClose: 'Clôture des réponses',
    answersClosed: 'Réponses closes le',
    passesUntil: "Un laissez-passer peut être ajouté jusqu'au",
    countingUntil: "Votre réponse peut être comptée jusqu'au",
    who: 'Qui peut répondre',
    whoAdult: 'Les adultes',
    whoAnyone: 'Toute personne',
    withChip: 'avec un passeport lu par sa puce',
    withDocument: 'avec un document vérifié',
    withPass: 'avec un laissez-passer',
    ofCountry: (country: string) => `· ${country}`,
    runtimeYes: 'Vous répondez oui à la question.',
    runtimeNo: 'Vous répondez non à la question.',
    runtimeAbstain: 'Vous ne prenez pas position. Votre réponse est comptée comme indécise.',
    eligible: 'Éligibles',
    scope: 'Périmètre',
    milestone: { vote: 'Votation officielle', proposal: 'Proposition officielle' },
    about: "De quoi il s'agit",
    frame: 'Cadre actuel',
    perspectives: 'Points de vue',
    forIt: 'Pour',
    againstIt: 'Contre',
    uncertainty: 'Incertitude',
    options: 'Ce que chaque option exprime',
    yes: 'Oui',
    no: 'Non',
    abstain: 'Ne se prononce pas',
    yesBody: 'Vous soutenez la proposition telle qu’elle est posée.',
    noBody: 'Vous ne soutenez pas la proposition telle qu’elle est posée.',
    abstainBody: "Vous n'avez pas encore pris position.",
    sources: 'Sources primaires',
    vote: 'Voter maintenant',
    prepare: 'Ajouter une éligibilité',
    disclosureTitle: "Ce que ceci est, et ce que ce n'est pas",
    runtimeDisclosure:
      "L'identité du contrat et ses résultats publics sont lus depuis Midnight. Le justificatif est vérifié en privé au regard de la politique publiée. Ceci n'est pas un référendum officiel et n'a aucun effet juridique.",
    demoDisclosure:
      "Les chiffres d'éligibilité et de participation sont simulés. Le justificatif prouve une règle d'éligibilité sans exposer vos preuves, et ne constitue pas une liste électorale officielle. Ceci n'est pas un référendum officiel et n'a aucun effet juridique.",
  },
} as const;

export interface PolicyDetailViewProps {
  readonly poll: Poll;
  readonly onBack: () => void;
  readonly onStartVote: (pollId: string) => void;
  readonly credential: DemoCredentialSummary | null;
  readonly onOpenPassportJourney: () => void;
  /** The deliberation assistant, when this build has one. */
  readonly assistant?: AppAssistant | null;
  readonly locale: CicoLocale;
}

export function PolicyDetailView({
  poll,
  onBack,
  onStartVote,
  credential,
  onOpenPassportJourney,
  assistant = null,
  locale,
}: PolicyDetailViewProps) {
  const copy = COPY[locale];
  /* With a brief from the record, the page shows that and not the catalogue's
     own summary: two accounts of one question would compete, and only one of
     them is tied to sources. */
  const briefed = assistant?.covers(poll.id) ? assistant : null;
  const displayPoll = localizePoll(poll, locale);
  const runtimePoll = Boolean(poll.runtimeContractAddress);
  const isOpen = getPollAvailability(poll).isOpen;
  const block =
    credential?.kind === 'synthetic-demo-credential' ? passBlock(poll, credential) : null;
  const consultationCountry = pollPlaceCode(poll);
  const consultationCountryName = consultationCountry
    ? getCountryName(consultationCountry, locale)
    : null;
  const runtime = poll.runtime ?? null;
  /* The rule the contract checks, in a person's words. A country here is the
     country of the document: nationality, never where someone lives. */
  const whoCanAnswer = runtime
    ? [
        runtime.requireAdult ? copy.whoAdult : copy.whoAnyone,
        runtime.minimumAssurance >= 2
          ? copy.withChip
          : runtime.minimumAssurance === 1
            ? copy.withDocument
            : copy.withPass,
        consultationCountryName ? copy.ofCountry(consultationCountryName) : '',
      ]
        .filter(Boolean)
        .join(' ')
    : null;

  return (
    <Screen
      className="policy"
      header={
        <div className="policy__nav">
          <button type="button" className="policy__back" onClick={onBack}>
            <ArrowLeft size={18} /> {copy.back}
          </button>
          <span className={`policy__status ${isOpen ? 'policy__status--open' : ''}`.trim()}>
            {isOpen ? copy.open : copy.closed}
          </span>
        </div>
      }
      /* A closed consultation gets no footer. A disabled button repeating the
         status chip is a duplicate label for one intent, and a washed-out
         accent shape still reads as an action. */
      footer={
        isOpen ? (
          <Button
            block
            disabled={Boolean(block)}
            onClick={() => (credential ? onStartVote(poll.id) : onOpenPassportJourney())}
          >
            {block ? passBlockLine(block, locale) : credential ? copy.vote : copy.prepare}
          </Button>
        ) : undefined
      }
    >
      <header className="policy__hero">
        <Display>{displayPoll.title}</Display>
        <p className="policy__question">{displayPoll.question}</p>
      </header>

      <Card>
        {runtime ? (
          /* A deployed consultation states what its contract enforces: three
             instants and one rule. Times matter here, so they are shown. */
          <StatGroup label={copy.facts}>
            <StatRow
              label={isOpen ? copy.answersClose : copy.answersClosed}
              value={formatDateTime(poll.closesAt, locale) ?? '—'}
            />
            {isOpen && runtime.passesUntil ? (
              <StatRow
                label={copy.passesUntil}
                value={formatDateTime(runtime.passesUntil, locale) ?? '—'}
              />
            ) : null}
            {runtime.countingUntil && Date.parse(runtime.countingUntil) > Date.now() ? (
              <StatRow
                label={copy.countingUntil}
                value={formatDateTime(runtime.countingUntil, locale) ?? '—'}
              />
            ) : null}
            <StatRow label={copy.who} value={whoCanAnswer ?? '—'} />
          </StatGroup>
        ) : (
          <StatGroup label={copy.facts}>
            <StatRow
              label={isOpen ? copy.closes : copy.closedOn}
              value={formatDate(poll.closesAt, locale) ?? displayPoll.deadline}
            />
            <StatRow label={copy.eligible} value={displayPoll.eligible} />
            {consultationCountryName ? (
              <StatRow label={copy.scope} value={consultationCountryName} />
            ) : null}
            {poll.milestone ? (
              <StatRow
                label={copy.milestone[poll.milestone.kind]}
                value={formatDate(poll.milestone.date, locale) ?? '—'}
              />
            ) : null}
          </StatGroup>
        )}
      </Card>

      {briefed ? (
        <ConsultationBrief assistant={briefed.port} consultationId={poll.id} locale={locale} />
      ) : null}

      {briefed ? null : runtime ? (
        displayPoll.description ? (
          <section className="policy__section">
            <h2 className="policy__heading">{copy.about}</h2>
            <p className="policy__prose">{displayPoll.description}</p>
          </section>
        ) : null
      ) : runtimePoll ? null : (
        <>
          <section className="policy__section">
            <h2 className="policy__heading">{copy.about}</h2>
            <p className="policy__prose">{displayPoll.whyNow}</p>
            <Card tone="sunken" className="policy__evidence">
              <p className="policy__evidence-label">{displayPoll.evidenceLabel}</p>
              <p className="policy__prose">{displayPoll.evidence}</p>
            </Card>
          </section>

          <section className="policy__section">
            <h2 className="policy__heading">{copy.frame}</h2>
            <p className="policy__prose">{displayPoll.legalFrame}</p>
          </section>

          <section className="policy__section" aria-labelledby="policy-perspectives">
            <h2 className="policy__heading" id="policy-perspectives">
              {copy.perspectives}
            </h2>
            <div className="policy__args">
              <div>
                <p className="policy__args-label">{copy.forIt}</p>
                <ul className="policy__list">
                  {displayPoll.argumentsFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="policy__args-label">{copy.againstIt}</p>
                <ul className="policy__list">
                  {displayPoll.argumentsAgainst.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="policy__section">
            <h2 className="policy__heading">{copy.uncertainty}</h2>
            <p className="policy__prose">{displayPoll.uncertainty}</p>
          </section>
        </>
      )}

      {poll.runtimeContractAddress ? (
        <ResultsPanel contractAddress={poll.runtimeContractAddress} locale={locale} />
      ) : null}

      <section className="policy__section">
        <h2 className="policy__heading">{copy.options}</h2>
        <dl className="policy__options">
          <dt>{copy.yes}</dt>
          <dd>{runtime ? copy.runtimeYes : copy.yesBody}</dd>
          <dt>{copy.no}</dt>
          <dd>{runtime ? copy.runtimeNo : copy.noBody}</dd>
          <dt>{copy.abstain}</dt>
          <dd>{runtime ? copy.runtimeAbstain : copy.abstainBody}</dd>
        </dl>
      </section>

      {displayPoll.sources.length ? (
        <section className="policy__section">
          <h2 className="policy__heading">{copy.sources}</h2>
          <ul className="policy__sources">
            {displayPoll.sources.map((source) => (
              <li key={source.href}>
                <a href={source.href} target="_blank" rel="noreferrer">
                  <span>
                    <strong>{source.label}</strong>
                    <small>{source.detail}</small>
                  </span>
                  <ArrowUpRight size={17} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Callout title={copy.disclosureTitle}>
        {runtimePoll ? copy.runtimeDisclosure : copy.demoDisclosure}
      </Callout>
    </Screen>
  );
}
