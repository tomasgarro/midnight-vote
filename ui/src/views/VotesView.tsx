import {
  ArrowRight,
  Check,
  DotsThree,
  GlobeHemisphereWest,
  LockSimple,
  MapPin,
  ShieldCheck,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CountryPicker, Display, EmptyState, Sheet } from '@/components/system';
import { CountryFlag } from '@/components/system/CountryFlag';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import { countryName, findAssignedCountry } from '@/integration/country-catalog';
import { formatDate } from '@/integration/format';
import type { CicoLocale } from '@/integration/locale';
import { getPollAvailability } from '@/integration/poll-lifecycle';
import type { DiscoveryScope } from '@/integration/product-boundaries';
import {
  isCountryPoll,
  isCountryPollForCountry,
  localizePoll,
  type Poll,
  pollPlaceCode,
} from '@/views/poll-model';
import { ConsultationRail } from './ConsultationRail';
import './votes-view.css';
import { ConsultationMedia, pollSubject, SUBJECTS } from './discovery-presentation';
import {
  answerableByPlace,
  defaultScopeForPass,
  orderForPass,
  PASS_FIT_COPY,
  passBlock,
  passBlockLine,
} from './pass-fit';
import './discovery-cards.css';

const COPY = {
  es: {
    title: 'Consultas',
    lead: 'Entendé la pregunta, preguntá lo que necesites y decí dónde estás parado.',
    world: 'Global',
    scopeMore: 'Más lugares',
    scopeDialogTitle: 'Elegí un lugar',
    scopeLabel: 'Alcance de las consultas',
    globalDescription: 'Abiertas a personas con una credencial elegible, sin país específico.',
    availableCountries: 'Consultas disponibles',
    countrySearch: 'Buscar cualquier país',
    countryList: 'Países disponibles',
    countrySuggested: 'Países con consultas publicadas',
    countryEmpty: 'No encontramos ese país. Probá con otro nombre o su código.',
    closeScope: 'Cerrar selector de lugar',
    browsing: 'Estás explorando',
    notEligibility: 'Esto no acredita elegibilidad.',
    open: 'Abierta',
    closed: 'Cerrada',
    closes: 'Cierra',
    read: 'Ver consulta',
    vote: 'Participar',
    addEligibility: 'Añadir elegibilidad',
    simulated: 'Simulada',
    fromContract: 'Leída desde Midnight',
    answered: 'Ya respondiste en este dispositivo.',
    seeReceipt: 'Ver tu comprobante',
    empty: 'No hay consultas publicadas en este alcance todavía.',
    passOnFile: 'Pase registrado para',
  },
  en: {
    title: 'Consultations',
    lead: 'Understand the question, ask what you need, and say where you stand.',
    world: 'Global',
    scopeMore: 'More places',
    scopeDialogTitle: 'Choose a place',
    scopeLabel: 'Consultation scope',
    globalDescription: 'Open to people with an eligible credential, without a specific country.',
    availableCountries: 'Consultations available',
    countrySearch: 'Search any country',
    countryList: 'Available countries',
    countrySuggested: 'Countries with published consultations',
    countryEmpty: 'No country matches that search. Try another name or code.',
    closeScope: 'Close place selector',
    browsing: 'You are exploring',
    notEligibility: 'This does not prove eligibility.',
    open: 'Open',
    closed: 'Closed',
    closes: 'Closes',
    read: 'View consultation',
    vote: 'Participate',
    addEligibility: 'Add eligibility',
    simulated: 'Simulated',
    fromContract: 'Read from Midnight',
    answered: 'You answered on this device.',
    seeReceipt: 'See your receipt',
    empty: 'No consultations are published in this scope yet.',
    passOnFile: 'Pass on file for',
  },
  fr: {
    title: 'Consultations',
    lead: 'Comprenez la question, demandez ce qu’il vous faut et dites où vous vous situez.',
    world: 'Monde',
    scopeMore: 'Plus de lieux',
    scopeDialogTitle: 'Choisir un lieu',
    scopeLabel: 'Périmètre de la consultation',
    globalDescription:
      "Ouvertes aux personnes disposant d'un justificatif éligible, sans pays particulier.",
    availableCountries: 'Consultations disponibles',
    countrySearch: "Rechercher n'importe quel pays",
    countryList: 'Pays disponibles',
    countrySuggested: 'Pays avec des consultations publiées',
    countryEmpty: 'Aucun pays ne correspond. Essayez un autre nom ou code.',
    closeScope: 'Fermer le sélecteur de lieu',
    browsing: 'Vous explorez',
    notEligibility: 'Cela ne prouve pas votre éligibilité.',
    open: 'Ouvert',
    closed: 'Clos',
    closes: 'Clôture',
    read: 'Voir la consultation',
    vote: 'Participer',
    addEligibility: 'Ajouter une éligibilité',
    simulated: 'Simulée',
    fromContract: 'Lue depuis Midnight',
    answered: 'Vous avez répondu sur cet appareil.',
    seeReceipt: 'Voir votre reçu',
    empty: "Aucune consultation n'est encore publiée dans ce périmètre.",
    passOnFile: 'Laissez-passer enregistré pour',
  },
} as const;

/** With this many consultations or fewer, the whole list is already in view. */
const SUBJECT_FILTER_FROM = 4;

export interface VotesViewProps {
  readonly polls: readonly Poll[];
  readonly credential: DemoCredentialSummary | null;
  /** Consultations this device holds an answer or a receipt for. */
  readonly answeredIds?: readonly string[];
  /** Opens the person's answers, where the receipt is. */
  readonly onOpenAnswers?: () => void;
  readonly onStartVote: (pollId: string) => void;
  readonly onOpenPolicy: (pollId: string) => void;
  readonly onOpenPassportJourney: () => void;
  readonly locale: CicoLocale;
}

export function VotesView({
  polls,
  credential,
  answeredIds = [],
  onOpenAnswers,
  onStartVote,
  onOpenPolicy,
  onOpenPassportJourney,
  locale,
}: VotesViewProps) {
  const copy = COPY[locale];
  const fit = PASS_FIT_COPY[locale];
  // A pass opens the list where it can answer something, so no pass lands on
  // an empty or unrelated list. Choosing a place afterwards is the reader's.
  const [scope, setScope] = useState<DiscoveryScope>(() => defaultScopeForPass(polls, credential));
  const [subject, setSubject] = useState<keyof typeof SUBJECTS.en>('all');
  const passKey = credential
    ? `${credential.country}|${credential.ageClass}|${credential.validUntil}`
    : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-placed only when the pass itself changes.
  useEffect(() => {
    if (passKey) setScope(defaultScopeForPass(polls, credential));
  }, [passKey]);
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);
  // The chosen place can sit past the edge of the chip row, for instance when
  // a pass opens the list on it. Bring it into view, sideways only.
  const scopesRef = useRef<HTMLFieldSetElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the chosen place changes.
  useEffect(() => {
    const row = scopesRef.current;
    const pressed = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !pressed) return;
    const rowBox = row.getBoundingClientRect();
    const box = pressed.getBoundingClientRect();
    if (box.left < rowBox.left || box.right > rowBox.right) {
      row.scrollLeft += box.left - rowBox.left - (rowBox.width - box.width) / 2;
    }
  }, [scope]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const availableCountryCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const poll of polls) {
      if (!isCountryPoll(poll)) continue;
      const code = pollPlaceCode(poll);
      if (code && findAssignedCountry(code)) codes.add(code);
    }
    return [...codes].sort((left, right) =>
      countryName(left, locale).localeCompare(countryName(right, locale), locale),
    );
  }, [locale, polls]);

  const scopedPolls =
    scope.kind === 'world'
      ? polls.filter((poll) => !isCountryPoll(poll))
      : polls.filter((poll) => isCountryPollForCountry(poll, scope.code));
  const countryLabel = scope.kind === 'country' ? countryName(scope.code, locale) : copy.world;
  // A place chosen in the sheet gets a chip of its own, so the choice is visible.
  const scopeChips =
    scope.kind === 'country' && !availableCountryCodes.includes(scope.code)
      ? [...availableCountryCodes, scope.code]
      : availableCountryCodes;
  const scopeKey = scope.kind === 'country' ? scope.code : 'global';
  // Places other than this one where the pass can answer now, most first.
  const elsewhere = [...answerableByPlace(polls, credential, now).entries()]
    .filter(([key]) => key !== scopeKey)
    .sort((left, right) => right[1] - left[1]);
  const passMatchesCountry = Boolean(
    credential &&
      scope.kind === 'country' &&
      credential.country.trim().toUpperCase() === scope.code.trim().toUpperCase(),
  );

  const chooseGlobal = () => {
    setSubject('all');
    setScope({ kind: 'world' });
    setScopeSheetOpen(false);
  };
  const chooseCountry = (code: string) => {
    setSubject('all');
    setScope({ kind: 'country', code: code.trim().toUpperCase() });
    setScopeSheetOpen(false);
  };

  return (
    <main className="votes">
      <header className="votes__head">
        <Display>{copy.title}</Display>
        <p className="votes__lead">{copy.lead}</p>
      </header>

      {/* The places that have consultations are one tap away. Every other
          place is in the sheet, behind the last chip. */}
      <fieldset ref={scopesRef} className="votes__scopes" aria-label={copy.scopeLabel}>
        <button type="button" aria-pressed={scope.kind === 'world'} onClick={chooseGlobal}>
          <GlobeHemisphereWest size={17} aria-hidden="true" />
          {copy.world}
        </button>
        {scopeChips.map((code) => (
          <button
            type="button"
            key={code}
            aria-pressed={scope.kind === 'country' && scope.code === code}
            onClick={() => chooseCountry(code)}
          >
            <CountryFlag alpha2={code} size="sm" />
            {countryName(code, locale)}
          </button>
        ))}
        <button
          type="button"
          className="votes__scopes-more"
          aria-haspopup="dialog"
          aria-expanded={scopeSheetOpen}
          aria-label={copy.scopeMore}
          title={copy.scopeMore}
          onClick={() => setScopeSheetOpen(true)}
        >
          <DotsThree size={20} weight="bold" aria-hidden="true" />
        </button>
      </fieldset>

      <p className="votes__scope-note">
        <MapPin size={15} aria-hidden="true" />
        <span>
          {copy.browsing} <strong>{countryLabel}</strong>. {copy.notEligibility}
        </span>
      </p>

      {/* A subject filter earns its row only when there is a list to shorten. */}
      <fieldset
        className="discovery-subjects"
        aria-label={SUBJECTS[locale].all}
        hidden={scopedPolls.length <= SUBJECT_FILTER_FROM}
      >
        {(Object.keys(SUBJECTS[locale]) as (keyof typeof SUBJECTS.en)[])
          .filter(
            (key) =>
              key === 'all' ||
              polls
                .filter((poll) =>
                  scope.kind === 'country'
                    ? isCountryPollForCountry(poll, scope.code)
                    : !isCountryPoll(poll),
                )
                .some((poll) => pollSubject(poll) === key),
          )
          .map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={subject === key}
              onClick={() => {
                setSubject(key);
              }}
            >
              {SUBJECTS[locale][key]}
            </button>
          ))}
      </fieldset>
      {[
        scope.kind === 'country'
          ? { key: scope.code, label: countryLabel, items: scopedPolls }
          : { key: 'global', label: copy.world, items: scopedPolls },
      ].map(({ key: sectionKey, label: countryLabel, items: sectionPolls }) => {
        const visiblePolls = orderForPass(
          sectionPolls.filter((poll) => subject === 'all' || pollSubject(poll) === subject),
          credential,
          now,
        );
        return (
          <section
            className="votes__results"
            aria-labelledby={`discover-${sectionKey}`}
            key={sectionKey}
          >
            <div className="votes__results-head">
              {/* The place is the heading; the page title already says what is listed. */}
              <h2 id={`discover-${sectionKey}`}>{countryLabel}</h2>
              {sectionKey !== 'global' && passMatchesCountry ? (
                <span className="votes__eligible">
                  <ShieldCheck size={15} weight="fill" />{' '}
                  {credential?.kind === 'synthetic-demo-credential' ? 'DEMO ·' : copy.passOnFile}{' '}
                  {countryLabel}
                </span>
              ) : null}
            </div>
            {elsewhere.length ? (
              <p className="votes__elsewhere">
                <span>{fit.elsewhere}</span>
                {elsewhere.map(([key, count]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => (key === 'global' ? chooseGlobal() : chooseCountry(key))}
                  >
                    {key === 'global' ? fit.global : countryName(key, locale)} ({count})
                  </button>
                ))}
              </p>
            ) : null}
            {visiblePolls.length ? (
              <ConsultationRail
                key={countryLabel + subject}
                label={countryLabel}
                count={visiblePolls.length}
                locale={locale}
              >
                {visiblePolls.map((poll) => {
                  const displayPoll = localizePoll(poll, locale);
                  const isOpen = getPollAvailability(poll, now).isOpen;
                  // Local to this device, so it is a reminder, not a record.
                  const answered = answeredIds.includes(poll.id);
                  // Formatted from `closesAt`, not the pre-rendered `deadline`
                  // string, which is authored per fixture and disagreed with
                  // the date Activity computed for the same consultation.
                  const date = formatDate(poll.closesAt, locale) ?? poll.deadline;
                  // With a pass, a consultation it cannot answer says why in
                  // one line, in place of the button.
                  const block = credential ? passBlock(poll, credential, now) : null;
                  return (
                    <li key={poll.id}>
                      <Card className="poll">
                        {/* One meta line: status as a word, the date, and
                            where the state comes from. No filled pill: the
                            accent belongs to the one action on the card. */}
                        <div className="poll__head">
                          <p className="poll__meta">
                            <span className="poll__status">
                              {isOpen ? null : <LockSimple size={14} aria-hidden="true" />}
                              {isOpen ? copy.open : copy.closed}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="poll__closes">
                              {isOpen ? `${copy.closes} ${date}` : date}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {poll.runtimeContractAddress ? copy.fromContract : copy.simulated}
                            </span>
                          </p>
                          <ConsultationMedia poll={displayPoll} />
                        </div>
                        <h3 className="poll__title">{displayPoll.title}</h3>
                        <p className="poll__body">{displayPoll.description}</p>
                        {answered ? (
                          <p className="poll__answered">
                            <Check size={16} weight="bold" aria-hidden="true" />
                            <span>{copy.answered}</span>
                            {onOpenAnswers ? (
                              <button type="button" onClick={onOpenAnswers}>
                                {copy.seeReceipt}
                              </button>
                            ) : null}
                          </p>
                        ) : null}
                        {block && !answered ? (
                          <p className="poll__reason">{passBlockLine(block, locale)}</p>
                        ) : null}
                        <div className="poll__actions">
                          {answered ? null : credential && !block ? (
                            <Button size="sm" onClick={() => onStartVote(poll.id)}>
                              {copy.vote} <ArrowRight size={16} />
                            </Button>
                          ) : !credential && isOpen ? (
                            <Button size="sm" onClick={onOpenPassportJourney}>
                              {copy.addEligibility} <ArrowRight size={16} />
                            </Button>
                          ) : null}
                          <Button variant="link" size="sm" onClick={() => onOpenPolicy(poll.id)}>
                            {copy.read}
                          </Button>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ConsultationRail>
            ) : (
              <EmptyState message={copy.empty} />
            )}
          </section>
        );
      })}

      <Sheet
        open={scopeSheetOpen}
        title={copy.scopeDialogTitle}
        closeLabel={copy.closeScope}
        onClose={() => setScopeSheetOpen(false)}
      >
        <div className="votes__scope-sheet">
          <button
            type="button"
            className={`votes__global-option ${scope.kind === 'world' ? 'active' : ''}`.trim()}
            aria-pressed={scope.kind === 'world'}
            onClick={chooseGlobal}
          >
            <GlobeHemisphereWest size={20} aria-hidden="true" />
            <span>
              <strong>{copy.world}</strong>
              <small>{copy.globalDescription}</small>
            </span>
          </button>
          {availableCountryCodes.length ? (
            <p className="votes__scope-sheet-label">{copy.availableCountries}</p>
          ) : null}
          <CountryPicker
            value={scope.kind === 'country' ? scope.code : ''}
            onChange={chooseCountry}
            locale={locale}
            searchLabel={copy.scopeLabel}
            searchPlaceholder={copy.countrySearch}
            listLabel={copy.countryList}
            suggested={availableCountryCodes}
            suggestedLabel={copy.countrySuggested}
            emptyLabel={copy.countryEmpty}
          />
        </div>
      </Sheet>
    </main>
  );
}
