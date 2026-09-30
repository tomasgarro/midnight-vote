import {
  ArrowLeft,
  CaretRight,
  ChatCircleText,
  Fingerprint,
  GearSix,
  IdentificationCard,
  Plus,
  Receipt,
  ShieldCheck,
} from '@phosphor-icons/react';
import type { CivicPassportSession } from 'midnight-referendum-api';
import type { ReactNode } from 'react';
import { Button, Card, Display } from '@/components/system';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import { countryName } from '@/integration/country-catalog';
import { formatDate } from '@/integration/format';
import type { CicoLocale } from '@/integration/locale';
import type { SealedAnswer } from '@/integration/sealed-answers';
import type { YouSection } from '@/views/app-runtime';
import type { VoteReceipt } from '@/views/poll-model';
import './you-view.css';

/**
 * `You` gathers what used to be three destinations and two header buttons: the
 * pass, the answers, the Passport account, settings and feedback.
 *
 * It is a summary. Each line says where the thing stands and opens it in full.
 * The pass comes first because it is what a consultation asks for.
 */

const COPY = {
  en: {
    title: 'You',
    lead: 'Your pass, your answers and your account.',
    pass: 'Your pass',
    passNone: 'No pass yet',
    passNoneBody: 'A pass keeps the minimum result of a check. It is not your physical passport.',
    passAdd: 'Add eligibility',
    passOpen: 'See the pass',
    validUntil: 'Valid until',
    verified: 'Verified',
    simulated: 'Simulated for this demo',
    answers: 'Your answers',
    answersNone: 'No answers yet',
    sealed: (count: number) => `${count} sealed`,
    counted: (count: number) => `${count} counted`,
    missed: (count: number) => `${count} not counted`,
    receipts: (count: number) => (count === 1 ? '1 receipt' : `${count} receipts`),
    account: 'Midnight Passport',
    accountOff: 'Not connected',
    accountOn: 'Connected',
    settings: 'Settings',
    settingsHint: 'Language, appearance, privacy and help',
    feedback: 'Feedback',
    feedbackHint: 'Tell us what worked and what did not',
    back: 'Back to You',
  },
  es: {
    title: 'Vos',
    lead: 'Tu pase, tus respuestas y tu cuenta.',
    pass: 'Tu pase',
    passNone: 'Todavía no tenés un pase',
    passNoneBody:
      'Un pase guarda el resultado mínimo de una verificación. No es tu pasaporte físico.',
    passAdd: 'Añadir elegibilidad',
    passOpen: 'Ver el pase',
    validUntil: 'Válido hasta',
    verified: 'Verificado',
    simulated: 'Simulado para esta demo',
    answers: 'Tus respuestas',
    answersNone: 'Todavía no hay respuestas',
    sealed: (count: number) => (count === 1 ? '1 sellada' : `${count} selladas`),
    counted: (count: number) => (count === 1 ? '1 contada' : `${count} contadas`),
    missed: (count: number) => (count === 1 ? '1 sin contar' : `${count} sin contar`),
    receipts: (count: number) => (count === 1 ? '1 comprobante' : `${count} comprobantes`),
    account: 'Midnight Passport',
    accountOff: 'Sin conectar',
    accountOn: 'Conectado',
    settings: 'Ajustes',
    settingsHint: 'Idioma, apariencia, privacidad y ayuda',
    feedback: 'Feedback',
    feedbackHint: 'Contanos qué funcionó y qué no',
    back: 'Volver a Vos',
  },
  fr: {
    title: 'Vous',
    lead: 'Votre laissez-passer, vos réponses et votre compte.',
    pass: 'Votre laissez-passer',
    passNone: 'Aucun laissez-passer pour le moment',
    passNoneBody:
      "Un laissez-passer conserve le résultat minimal d'une vérification. Ce n'est pas votre passeport physique.",
    passAdd: 'Ajouter une éligibilité',
    passOpen: 'Voir le laissez-passer',
    validUntil: "Valable jusqu'au",
    verified: 'Vérifié',
    simulated: 'Simulé pour cette démo',
    answers: 'Vos réponses',
    answersNone: 'Aucune réponse pour le moment',
    sealed: (count: number) => (count === 1 ? '1 scellée' : `${count} scellées`),
    counted: (count: number) => (count === 1 ? '1 comptée' : `${count} comptées`),
    missed: (count: number) => (count === 1 ? '1 non comptée' : `${count} non comptées`),
    receipts: (count: number) => (count === 1 ? '1 reçu' : `${count} reçus`),
    account: 'Midnight Passport',
    accountOff: 'Non connecté',
    accountOn: 'Connecté',
    settings: 'Réglages',
    settingsHint: 'Langue, apparence, confidentialité et aide',
    feedback: 'Retours',
    feedbackHint: 'Dites-nous ce qui a fonctionné ou non',
    back: 'Retour à Vous',
  },
} as const;

/** One line for where the answers stand. It names counts and never a choice. */
export function summarizeAnswers(
  sealedAnswers: readonly SealedAnswer[],
  receipts: readonly VoteReceipt[],
  locale: CicoLocale,
): string {
  const copy = COPY[locale];
  const count = (state: SealedAnswer['state']) =>
    sealedAnswers.filter((answer) => answer.state === state).length;
  const parts = [
    count('sealed') ? copy.sealed(count('sealed')) : '',
    count('counted') ? copy.counted(count('counted')) : '',
    count('missed') ? copy.missed(count('missed')) : '',
    receipts.length ? copy.receipts(receipts.length) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : copy.answersNone;
}

export interface YouViewProps {
  readonly credential: DemoCredentialSummary | null;
  readonly passportSession: CivicPassportSession | null;
  readonly sealedAnswers: readonly SealedAnswer[];
  readonly receipts: readonly VoteReceipt[];
  readonly onVerify: () => void;
  readonly onOpen: (section: Exclude<YouSection, 'hub'>) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenFeedback: () => void;
  readonly locale: CicoLocale;
}

function Row({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="you-row" onClick={onClick}>
      <span className="you-row__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="you-row__copy">
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      <CaretRight size={18} aria-hidden="true" />
    </button>
  );
}

export function YouView({
  credential,
  passportSession,
  sealedAnswers,
  receipts,
  onVerify,
  onOpen,
  onOpenSettings,
  onOpenFeedback,
  locale,
}: YouViewProps) {
  const copy = COPY[locale];
  const connected = Boolean(passportSession);

  return (
    <main className="you">
      <header className="you__head">
        <Display>{copy.title}</Display>
        <p>{copy.lead}</p>
      </header>

      <section aria-labelledby="you-pass-title">
        <Card className="you-pass" data-held={Boolean(credential)}>
          <div className="you-pass__top">
            <span className="you-pass__mark" aria-hidden="true">
              {credential ? (
                <ShieldCheck size={24} weight="fill" />
              ) : (
                <IdentificationCard size={24} />
              )}
            </span>
            <p className="you-pass__kicker" id="you-pass-title">
              {copy.pass}
            </p>
          </div>
          {credential ? (
            <>
              <h2>
                {countryName(credential.country, locale)} · {credential.ageClass}
              </h2>
              <p className="you-pass__facts">
                {copy.validUntil}{' '}
                {formatDate(credential.validUntil, locale) ?? credential.validUntil}
                <span aria-hidden="true"> · </span>
                {credential.kind === 'synthetic-demo-credential' ? copy.simulated : copy.verified}
              </p>
              <Button variant="secondary" size="sm" onClick={() => onOpen('pass')}>
                {copy.passOpen}
              </Button>
            </>
          ) : (
            <>
              <h2>{copy.passNone}</h2>
              <p className="you-pass__facts">{copy.passNoneBody}</p>
              <Button onClick={onVerify}>
                <Plus size={17} /> {copy.passAdd}
              </Button>
            </>
          )}
        </Card>
      </section>

      <Card className="you__rows" flush>
        <Row
          icon={<Receipt size={20} />}
          title={copy.answers}
          hint={summarizeAnswers(sealedAnswers, receipts, locale)}
          onClick={() => onOpen('answers')}
        />
        <Row
          icon={<Fingerprint size={20} />}
          title={copy.account}
          hint={connected ? copy.accountOn : copy.accountOff}
          onClick={() => onOpen('account')}
        />
        <Row
          icon={<GearSix size={20} />}
          title={copy.settings}
          hint={copy.settingsHint}
          onClick={onOpenSettings}
        />
        <Row
          icon={<ChatCircleText size={20} />}
          title={copy.feedback}
          hint={copy.feedbackHint}
          onClick={onOpenFeedback}
        />
      </Card>
    </main>
  );
}

/** The way back from one part of `You` to its summary. */
export function BackToYou({ onBack, locale }: { onBack: () => void; locale: CicoLocale }) {
  const copy = COPY[locale];
  return (
    <button type="button" className="you-back" onClick={onBack} aria-label={copy.back}>
      <ArrowLeft size={18} weight="bold" aria-hidden="true" />
      <span aria-hidden="true">{copy.title}</span>
    </button>
  );
}
