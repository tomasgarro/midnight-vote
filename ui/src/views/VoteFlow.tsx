import { Check, X } from '@phosphor-icons/react';
import type { ExecutionMode } from 'midnight-referendum-api';
import { useEffect, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  Display,
  Eyebrow,
  JourneyProgress,
  Screen,
  Sheet,
  StatGroup,
  StatRow,
  SuccessMark,
} from '@/components/system';
import { WalletWidget } from '@/components/wallet-widget';
import { formatDate } from '@/integration/format';
import { HOSTED_PROVING_COPY } from '@/integration/hosted-proving';
import type { CicoLocale } from '@/integration/locale';
import { SEALED_ANSWER_COPY } from '@/integration/sealed-answers';
import {
  formatElapsed,
  needsHostedConsent,
  WALLETLESS_PROVING_COPY,
  type WalletlessProvingState,
} from '@/integration/walletless-proving';
import { CHAIN_RUNTIME_ENABLED, type FlowStage, networkLabel } from '@/views/app-runtime';
import { CopyReceiptButton } from '@/views/CopyReceiptButton';
import { type Choice, localizePoll, type Poll, type VoteReceipt } from '@/views/poll-model';
import './vote-flow.css';

/**
 * Casting a vote: one choice, a confirmation, and a receipt.
 *
 * It used to claim three steps. `verify` and `eligible` were the first two,
 * and nothing in the app could reach them -- `startVote` sends a credentialled
 * user directly to `choose` -- so the first screen a voter ever saw announced
 * "Paso 3 de 3". Both screens are deleted rather than wired up: everything
 * they said (your Passport profile is separate from your vote, your evidence
 * never left the device) is now said once, in the Passport journey, where the
 * reader is actually deciding whether to share it.
 *
 * What is left is the real sequence, and it drives the same filling bar the
 * Passport journey uses, so the product has one progress language instead of
 * three competing ones.
 *
 * Review is now a Sheet over the choice screen rather than a fourth screen.
 * Confirming a vote is a short interruption the user answers and dismisses:
 * they can see the answer they picked behind it, and backing out returns them
 * to the choice instead of needing its own back button. Its body is the
 * RariMe proof-request pattern -- labelled StatGroups of StatRows -- because
 * "Tu respuesta: Sí" is read in a glance where the paragraph that said the
 * same thing was not read at all.
 *
 * The choice buttons were three cards tinted yes-green, no-red and
 * abstain-grey. On a consultation with no house position, that is the
 * interface telling you which answer is the agreeable one. They are three
 * identical rows; the accent marks the one you picked, and nothing else.
 */

const COPY = {
  es: {
    step: (n: number, total: number) => `Paso ${n} de ${total}`,
    close: 'Salir sin votar',
    back: 'Volver',
    // choose
    chooseLabel: 'Tu respuesta',
    yes: 'Sí',
    no: 'No',
    abstain: 'Sin decidir',
    yesBody: 'Estoy de acuerdo con priorizar esta propuesta',
    noBody: 'No estoy de acuerdo con priorizarla así',
    abstainBody: 'Todavía no tomé una posición',
    review: 'Revisar mi voto',
    // review sheet
    reviewTitle: 'Revisá antes de confirmar',
    yourVote: 'Tu voto',
    consultation: 'Consulta',
    answer: 'Tu respuesta',
    visibility: 'Visibilidad',
    privateUntil: 'privada hasta el recuento',
    howSent: 'Cómo se envía',
    signer: 'Firma',
    relayer: 'relay atómico, sin ver tu elección',
    signerDemo: 'nada sale de este dispositivo',
    feePayer: 'Quién cubre las tarifas',
    directMode: 'Mi wallet',
    directModeBody: 'Lace crea la prueba, agrega DUST y envía la transacción.',
    sponsoredMode: 'Patrocinado',
    sponsoredModeBody: 'Lace crea la prueba; el relay aporta DUST y envía.',
    sponsoredUnavailable: 'El envío patrocinado todavía no está disponible.',
    wallet: 'Wallet',
    walletConnected: 'conectada',
    walletPending: 'pendiente',
    dust: 'DUST',
    dustUnavailable: 'saldo no disponible',
    available: 'disponible',
    change: 'Cambiar mi respuesta',
    confirmReal: 'Confirmar acción real',
    confirmSimulated: 'Crear comprobante simulado',
    simulatedNote:
      'Este comprobante será simulado y se guardará localmente. Una prueba real requiere red compatible, contrato desplegado y wallet.',
    cannotSubmit: 'todavía no puede enviar',
    // processing
    processingTitle: 'Preparando tu comprobante',
    processingRelayer:
      'La prueba se crea localmente; el relay reserva DUST, envía una vez y espera confirmación.',
    processingWallet:
      'El flujo reúne prueba, balanceo DUST/NIGHT, aprobación del wallet y confirmación canónica.',
    processingHosted:
      'Nuestro servidor de pruebas crea la prueba; el relay paga la tarifa, envía una vez y espera la confirmación.',
    sealedTitle: 'Tu respuesta está sellada',
    sealedBody: (closes: string | null) =>
      closes
        ? `Se cuenta cuando vuelvas en este dispositivo después del ${closes}. Nadie más puede contarla por vos.`
        : 'Se cuenta cuando vuelvas en este dispositivo después del cierre. Nadie más puede contarla por vos.',
    sealedState: 'sellada',
    closes: 'Cierra',
    viewSealed: 'Ver mis respuestas',
    processingDuration: 'Suele tardar entre 30 y 90 segundos. No cierres esta pantalla.',
    processingDurationDemo: 'En demo esto es inmediato: no se envía nada a ninguna red.',
    processingNoCancel:
      'Una vez enviada, la transacción no se puede cancelar desde acá. Si algo falla, volvés a la pantalla de confirmación y podés reintentar.',
    // receipt
    receiptTitle: 'Gracias por participar',
    receiptBody: 'Guardá este identificador para verificar el resultado.',
    receiptGroup: 'Tu comprobante',
    identifier: 'Identificador',
    inProfile: 'Disponible en tu perfil',
    network: 'Red',
    state: 'Estado',
    confirmed: 'confirmado',
    simulated: 'simulado',
    notATransaction: 'No representa una transacción ni una prueba de voto real.',
    openExplorer: 'Abrir en explorer',
    viewReceipt: 'Ver mi comprobante',
  },
  en: {
    step: (n: number, total: number) => `Step ${n} of ${total}`,
    close: 'Leave without voting',
    back: 'Back',
    chooseLabel: 'Your response',
    yes: 'Yes',
    no: 'No',
    abstain: 'Undecided',
    yesBody: 'I support prioritising this proposal',
    noBody: 'I do not support prioritising it this way',
    abstainBody: 'I have not taken a position yet',
    review: 'Review my vote',
    reviewTitle: 'Review before confirming',
    yourVote: 'Your vote',
    consultation: 'Consultation',
    answer: 'Your response',
    visibility: 'Visibility',
    privateUntil: 'private until counting',
    howSent: 'How it is sent',
    signer: 'Signed by',
    relayer: 'atomic relay, never sees your choice',
    signerDemo: 'nothing leaves this device',
    feePayer: 'Who covers network fees',
    directMode: 'My wallet',
    directModeBody: 'Lace proves, adds DUST, and submits the transaction.',
    sponsoredMode: 'Sponsored',
    sponsoredModeBody: 'Lace proves; the relay supplies DUST and submits.',
    sponsoredUnavailable: 'Sponsored submission is not available yet.',
    wallet: 'Wallet',
    walletConnected: 'connected',
    walletPending: 'pending',
    dust: 'DUST',
    dustUnavailable: 'balance unavailable',
    available: 'available',
    change: 'Change my response',
    confirmReal: 'Confirm real action',
    confirmSimulated: 'Create simulated receipt',
    simulatedNote:
      'This receipt will be simulated and saved locally. A real proof requires a compatible network, a deployed contract, and a wallet.',
    cannotSubmit: 'cannot submit yet',
    processingTitle: 'Preparing your receipt',
    processingRelayer:
      'The proof is created locally; the relay reserves DUST, submits once, and waits for confirmation.',
    processingWallet:
      'The flow combines proof, DUST/NIGHT balancing, wallet approval, and canonical confirmation.',
    processingHosted:
      'Our proving server builds the proof; the relay pays the fee, submits once, and waits for confirmation.',
    sealedTitle: 'Your answer is sealed',
    sealedBody: (closes: string | null) =>
      closes
        ? `It is counted when you return on this device after ${closes}. Nobody else can count it for you.`
        : 'It is counted when you return on this device after the consultation closes. Nobody else can count it for you.',
    sealedState: 'sealed',
    closes: 'Closes',
    viewSealed: 'View my answers',
    processingDuration: 'This usually takes 30 to 90 seconds. Do not close this screen.',
    processingDurationDemo: 'In demo this is instant: nothing is sent to any network.',
    processingNoCancel:
      'Once submitted, the transaction cannot be cancelled from here. If it fails you return to the confirmation screen and can retry.',
    receiptTitle: 'Thank you for participating',
    receiptBody: 'Save this identifier to verify the result.',
    receiptGroup: 'Your receipt',
    identifier: 'Identifier',
    inProfile: 'Available in your profile',
    network: 'Network',
    state: 'Status',
    confirmed: 'confirmed',
    simulated: 'simulated',
    notATransaction: 'This is not a transaction or a real vote proof.',
    openExplorer: 'Open in explorer',
    viewReceipt: 'View my receipt',
  },
  fr: {
    step: (n: number, total: number) => `Étape ${n} sur ${total}`,
    close: 'Quitter sans voter',
    back: 'Retour',
    chooseLabel: 'Votre réponse',
    yes: 'Oui',
    no: 'Non',
    abstain: 'Ne se prononce pas',
    yesBody: 'Je soutiens la priorité donnée à cette proposition',
    noBody: 'Je ne soutiens pas cette priorité sous cette forme',
    abstainBody: "Je n'ai pas encore pris position",
    review: 'Relire mon vote',
    reviewTitle: 'Relisez avant de confirmer',
    yourVote: 'Votre vote',
    consultation: 'Consultation',
    answer: 'Votre réponse',
    visibility: 'Visibilité',
    privateUntil: "privé jusqu'au dépouillement",
    howSent: 'Comment il est transmis',
    signer: 'Signé par',
    relayer: 'relais atomique, il ne voit jamais votre choix',
    signerDemo: 'rien ne quitte cet appareil',
    feePayer: 'Qui paie les frais de réseau',
    directMode: 'Mon portefeuille',
    directModeBody: 'Lace produit la preuve, ajoute le DUST et soumet la transaction.',
    sponsoredMode: 'Parrainé',
    sponsoredModeBody: 'Lace produit la preuve ; le relais fournit le DUST et soumet.',
    sponsoredUnavailable: "La soumission parrainée n'est pas encore disponible.",
    wallet: 'Portefeuille',
    walletConnected: 'connecté',
    walletPending: 'en attente',
    dust: 'DUST',
    dustUnavailable: 'solde indisponible',
    available: 'disponible',
    change: 'Modifier ma réponse',
    confirmReal: "Confirmer l'action réelle",
    confirmSimulated: 'Créer un reçu simulé',
    simulatedNote:
      'Ce reçu sera simulé et enregistré localement. Une preuve réelle exige un réseau compatible, un contrat déployé et un portefeuille.',
    cannotSubmit: 'soumission impossible pour le moment',
    processingTitle: 'Préparation de votre reçu',
    processingRelayer:
      'La preuve est créée localement ; le relais réserve le DUST, soumet une seule fois et attend la confirmation.',
    processingWallet:
      "Le processus combine la preuve, l'équilibrage DUST/NIGHT, l'approbation du portefeuille et la confirmation canonique.",
    processingHosted:
      'Notre serveur de preuve produit la preuve ; le relais paie les frais, soumet une seule fois et attend la confirmation.',
    sealedTitle: 'Votre réponse est scellée',
    sealedBody: (closes: string | null) =>
      closes
        ? `Elle sera comptée quand vous reviendrez sur cet appareil après le ${closes}. Personne d'autre ne peut la compter à votre place.`
        : "Elle sera comptée quand vous reviendrez sur cet appareil après la clôture. Personne d'autre ne peut la compter à votre place.",
    sealedState: 'scellée',
    closes: 'Clôture',
    viewSealed: 'Voir mes réponses',
    processingDuration: 'Cela prend en général 30 à 90 secondes. Ne fermez pas cet écran.',
    processingDurationDemo: "En démo, c'est instantané : rien n'est envoyé sur un réseau.",
    processingNoCancel:
      "Une fois soumise, la transaction ne peut plus être annulée depuis cet écran. En cas d'échec, vous revenez à la confirmation et pouvez réessayer.",
    receiptTitle: 'Merci pour votre participation',
    receiptBody: 'Conservez cet identifiant pour vérifier le résultat.',
    receiptGroup: 'Votre reçu',
    identifier: 'Identifiant',
    inProfile: 'Disponible dans votre profil',
    network: 'Réseau',
    state: 'Statut',
    confirmed: 'confirmé',
    simulated: 'simulé',
    notATransaction: "Ceci n'est ni une transaction ni une preuve de vote réelle.",
    openExplorer: "Ouvrir dans l'explorateur",
    viewReceipt: 'Voir mon reçu',
  },
} as const;

/** Milliseconds since `startedAt`, refreshed every second; null when idle. */
function useElapsed(startedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? null : Math.max(0, now - startedAt);
}

/**
 * The three screens a vote actually has. Review is a sheet over `choose`, not
 * a screen, so it does not get a stop on the bar.
 */
const VOTE_SCREENS: readonly FlowStage[] = ['choose', 'processing', 'receipt'];
const VOTE_STAGE_LABEL = {
  es: { choose: 'Elegí', processing: 'Enviando', receipt: 'Comprobante' },
  en: { choose: 'Choose', processing: 'Submitting', receipt: 'Receipt' },
  fr: { choose: 'Choisir', processing: 'Envoi', receipt: 'Reçu' },
} as const;

export interface VoteFlowProps {
  readonly poll: Poll;
  readonly stage: FlowStage;
  readonly choice: Choice | null;
  readonly onChoice: (choice: Choice) => void;
  readonly onStage: (stage: FlowStage) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly onViewReceipt: () => void;
  readonly walletStatus: string;
  readonly executionMode: ExecutionMode;
  readonly onExecutionModeChange: (mode: ExecutionMode) => void;
  readonly sponsoredAvailable: boolean;
  readonly sponsoredError?: string | null;
  /** Proving without a wallet: on this device, or on the disclosed server. */
  readonly walletlessProving?: WalletlessProvingState;
  readonly provingParty?: 'wallet' | 'device' | 'hosted-server' | null;
  /** When this device started the proof it is building now. */
  readonly deviceProofStartedAt?: number | null;
  readonly previewError: string | null;
  readonly receipt: VoteReceipt | null;
  readonly dustBalance?: bigint | null;
  readonly locale: CicoLocale;
}

export function VoteFlow({
  poll,
  stage,
  choice,
  onChoice,
  onStage,
  onClose,
  onConfirm,
  onViewReceipt,
  walletStatus,
  executionMode,
  onExecutionModeChange,
  sponsoredAvailable,
  sponsoredError = null,
  walletlessProving,
  provingParty = null,
  deviceProofStartedAt = null,
  previewError,
  receipt,
  dustBalance = null,
  locale,
}: VoteFlowProps) {
  const copy = COPY[locale];
  const hostedCopy = HOSTED_PROVING_COPY[locale];
  const proverCopy = WALLETLESS_PROVING_COPY[locale];
  const displayPoll = localizePoll(poll, locale);
  const live = CHAIN_RUNTIME_ENABLED;
  const relayerMode = executionMode !== 'direct-wallet';
  const deviceActive = executionMode === 'sponsored-device-proving';
  const hostedActive = executionMode === 'sponsored-hosted-proving';
  /* Offered means: no wallet here, and this build can prove without one. The
     device is the default. The server is used only after its disclosure. */
  const walletless =
    live && walletStatus !== 'connected' && walletlessProving?.offered ? walletlessProving : null;
  const hostedChosen = walletless?.selected === 'hosted-server';
  const hostedNeedsConsent = needsHostedConsent(walletless ?? undefined);
  const walletlessWaiting =
    walletless !== null && !hostedNeedsConsent && !(hostedChosen ? hostedActive : deviceActive);
  const elapsed = useElapsed(deviceProofStartedAt);
  const choiceLabel = (value: Choice) =>
    value === 'YES' ? copy.yes : value === 'NO' ? copy.no : copy.abstain;
  const screenIndex = Math.max(VOTE_SCREENS.indexOf(stage === 'review' ? 'choose' : stage), 0);
  const stageKey = (stage === 'review' ? 'choose' : stage) as keyof (typeof VOTE_STAGE_LABEL)['es'];
  /* The same bar the Passport journey draws, continuing rather than restarting
     a second numbering scheme. Closing stays available on every screen except
     the one where a submission is already in flight. */
  const header = (closable: boolean) => (
    <div className="flow__head">
      <JourneyProgress
        current={screenIndex + 1}
        total={VOTE_SCREENS.length}
        stageLabel={VOTE_STAGE_LABEL[locale][stageKey]}
        label={copy.step(screenIndex + 1, VOTE_SCREENS.length)}
      />
      {closable ? (
        <button type="button" className="flow__close" onClick={onClose} aria-label={copy.close}>
          <X size={19} />
        </button>
      ) : null}
    </div>
  );

  if (stage === 'processing') {
    return (
      <Screen header={header(false)}>
        <Display>{copy.processingTitle}</Display>
        <p className="flow__body">
          {deviceActive
            ? proverCopy.deviceProcessing
            : hostedActive
              ? copy.processingHosted
              : relayerMode
                ? copy.processingRelayer
                : copy.processingWallet}
        </p>
        {/* Indeterminate: the pipeline reports no percentage, so the bar must
            not imply one. What it can honestly report is how long this
            normally takes, which is the difference between waiting and
            wondering whether the app has stopped. */}
        <div className="flow__indeterminate" role="progressbar" aria-label={copy.processingTitle}>
          <span />
        </div>
        <p className="flow__wait-note" role="status">
          {!live
            ? copy.processingDurationDemo
            : deviceActive
              ? proverCopy.deviceWait
              : copy.processingDuration}
        </p>
        {/* A proof built here runs for minutes. The running time is what tells
            the person that the device is working and has not stopped. */}
        {deviceActive && elapsed !== null ? (
          <p className="flow__wait-note">
            {proverCopy.elapsed}: <span className="flow__elapsed">{formatElapsed(elapsed)}</span>
          </p>
        ) : null}
        {live ? <Callout>{copy.processingNoCancel}</Callout> : null}
      </Screen>
    );
  }

  if (stage === 'receipt' && receipt?.sealed) {
    /* A sealed answer is not finished: it still has to be counted, and only
       this device can do that. So the screen says when to come back, and it
       shows no identifier -- a transaction id here would tie this device to an
       answer that becomes public at the count. */
    const closes = formatDate(poll.closesAt, locale);
    return (
      <Screen
        header={header(false)}
        footer={
          <Button block onClick={onViewReceipt}>
            {copy.viewSealed}
          </Button>
        }
      >
        <SuccessMark label={copy.sealedTitle} size="sm" />
        <Display>{copy.sealedTitle}</Display>
        <p className="flow__body">{copy.sealedBody(closes)}</p>
        <Card>
          <StatGroup label={copy.receiptGroup}>
            <StatRow label={copy.state} value={copy.sealedState} />
            <StatRow label={copy.network} value={receipt.network} />
            {closes ? <StatRow label={copy.closes} value={closes} /> : null}
            <StatRow
              label={hostedCopy.provedBy}
              value={
                receipt.sealed.provingParty === 'hosted-server'
                  ? hostedCopy.byServer
                  : receipt.sealed.provingParty === 'device'
                    ? proverCopy.byDevice
                    : hostedCopy.byWallet
              }
            />
          </StatGroup>
        </Card>
        <Callout>{SEALED_ANSWER_COPY[locale].publicAtCount}</Callout>
      </Screen>
    );
  }

  if (stage === 'receipt') {
    const confirmed = receipt?.status === 'confirmed';
    return (
      <Screen
        header={header(false)}
        footer={
          <Button block onClick={onViewReceipt}>
            {copy.viewReceipt}
          </Button>
        }
      >
        <SuccessMark label={copy.receiptTitle} size="sm" />
        <Display>{copy.receiptTitle}</Display>
        <p className="flow__body">{copy.receiptBody}</p>
        <Card>
          <StatGroup label={copy.receiptGroup}>
            <StatRow label={copy.state} value={confirmed ? copy.confirmed : copy.simulated} />
            <StatRow label={copy.network} value={receipt?.network ?? networkLabel(locale)} />
            <StatRow
              label={copy.identifier}
              value={<code className="flow__code">{receipt?.id ?? copy.inProfile}</code>}
            />
          </StatGroup>
          {receipt ? (
            <div className="flow__receipt-actions">
              <CopyReceiptButton receiptId={receipt.id} locale={locale} />
              {receipt.explorerUrl ? (
                <a
                  className="flow__link"
                  href={receipt.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.openExplorer}
                </a>
              ) : null}
            </div>
          ) : null}
        </Card>
        {confirmed ? null : <Callout>{copy.notATransaction}</Callout>}
      </Screen>
    );
  }

  /* choose, and review as a sheet over it */
  const options = [
    { value: 'YES' as const, label: copy.yes, body: copy.yesBody },
    { value: 'NO' as const, label: copy.no, body: copy.noBody },
    { value: 'ABSTAIN' as const, label: copy.abstain, body: copy.abstainBody },
  ];

  return (
    <>
      <Screen
        header={header(true)}
        footer={
          <Button block disabled={!choice} onClick={() => onStage('review')}>
            {copy.review}
          </Button>
        }
      >
        {/* The consultation questions are 20-30 words of policy prose. In
            display type that is nine lines and the options fall below the
            fold, so the question gets its own smaller size and the title
            above it carries the context Display would have. */}
        <Eyebrow>{displayPoll.title}</Eyebrow>
        <h1 className="flow__question">{displayPoll.question}</h1>
        <fieldset className="flow__choices">
          <legend className="sr-only">{copy.chooseLabel}</legend>
          {options.map((option) => {
            const selected = choice === option.value;
            return (
              <button
                type="button"
                key={option.value}
                className={`flow__choice ${selected ? 'flow__choice--selected' : ''}`.trim()}
                aria-pressed={selected}
                onClick={() => onChoice(option.value)}
              >
                <span className="flow__choice-copy">
                  <span className="flow__choice-label">{option.label}</span>
                  <span className="flow__choice-body">{option.body}</span>
                </span>
                <span className="flow__choice-mark" aria-hidden="true">
                  {selected ? <Check size={14} weight="bold" /> : null}
                </span>
              </button>
            );
          })}
        </fieldset>
      </Screen>

      <Sheet
        open={stage === 'review'}
        title={copy.reviewTitle}
        onClose={() => onStage('choose')}
        closeLabel={copy.change}
        actions={
          <>
            {/* One primary action at a time: first the disclosure is accepted,
                then the answer is confirmed. */}
            {hostedNeedsConsent ? (
              <Button block onClick={() => walletless?.acceptHosted()}>
                {hostedCopy.accept}
              </Button>
            ) : (
              <Button block disabled={walletlessWaiting} onClick={onConfirm}>
                {walletlessWaiting && !walletless?.error
                  ? hostedCopy.preparing
                  : live
                    ? copy.confirmReal
                    : copy.confirmSimulated}
              </Button>
            )}
            <Button variant="link" onClick={() => onStage('choose')}>
              {copy.change}
            </Button>
          </>
        }
      >
        {walletless ? (
          <div className="flow__sheet-group">
            {walletless.deviceAvailable && walletless.hostedAvailable ? (
              <fieldset className="flow__execution-modes">
                <legend>{proverCopy.legend}</legend>
                <label className="flow__execution-mode">
                  <input
                    type="radio"
                    name="walletless-prover"
                    value="device"
                    checked={!hostedChosen}
                    onChange={() => walletless.chooseDevice()}
                  />
                  <span>
                    <strong>{proverCopy.deviceTitle}</strong>
                    <small>{proverCopy.deviceBody}</small>
                  </span>
                </label>
                <label className="flow__execution-mode">
                  <input
                    type="radio"
                    name="walletless-prover"
                    value="hosted-server"
                    checked={hostedChosen}
                    onChange={() => walletless.chooseHosted()}
                  />
                  <span>
                    <strong>{proverCopy.hostedTitle}</strong>
                    <small>{proverCopy.hostedBody}</small>
                  </span>
                </label>
              </fieldset>
            ) : hostedChosen ? null : (
              <Callout role="status" title={proverCopy.deviceTitle}>
                {proverCopy.deviceBody}
              </Callout>
            )}
            {hostedChosen ? (
              <Callout tone="warning" role="status" title={hostedCopy.title}>
                {hostedCopy.body} {hostedCopy.alternative}
              </Callout>
            ) : null}
            {walletless.error ? (
              <Callout tone="danger" role="alert">
                {hostedCopy.unavailable}
              </Callout>
            ) : null}
            {hostedChosen && walletless.hostedAccepted ? (
              <Button variant="link" onClick={() => walletless.withdrawHosted()}>
                {hostedCopy.withdraw}
              </Button>
            ) : null}
          </div>
        ) : live ? (
          <fieldset className="flow__execution-modes">
            <legend>{copy.feePayer}</legend>
            <label className="flow__execution-mode">
              <input
                type="radio"
                name="execution-mode"
                value="direct-wallet"
                checked={!relayerMode}
                onChange={() => onExecutionModeChange('direct-wallet')}
              />
              <span>
                <strong>{copy.directMode}</strong>
                <small>{copy.directModeBody}</small>
              </span>
            </label>
            <label
              className={`flow__execution-mode ${
                sponsoredAvailable ? '' : 'flow__execution-mode--disabled'
              }`.trim()}
            >
              <input
                type="radio"
                name="execution-mode"
                value="sponsored-wallet"
                checked={relayerMode}
                disabled={!sponsoredAvailable}
                onChange={() => onExecutionModeChange('sponsored-wallet')}
              />
              <span>
                <strong>{copy.sponsoredMode}</strong>
                <small>{copy.sponsoredModeBody}</small>
              </span>
            </label>
            {!sponsoredAvailable && sponsoredError ? (
              <p className="flow__execution-error" role="status">
                {copy.sponsoredUnavailable}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <StatGroup label={copy.yourVote}>
          <StatRow label={copy.consultation} value={displayPoll.title} />
          <StatRow label={copy.answer} value={choice ? choiceLabel(choice) : '—'} />
          <StatRow label={copy.visibility} value={copy.privateUntil} />
        </StatGroup>
        <div className="flow__sheet-group">
          <StatGroup label={copy.howSent}>
            {/* In demo there is no wallet anywhere in the path, so "Wallet:
                pendiente / DUST: saldo no disponible" reported two failures
                about a thing the reader was never asked for and cannot fix.
                The demo says what actually happens instead. */}
            {!live ? (
              <StatRow label={copy.signer} value={copy.signerDemo} />
            ) : walletless ? (
              <>
                <StatRow
                  label={hostedCopy.provedBy}
                  value={hostedChosen ? hostedCopy.byServer : proverCopy.byDevice}
                />
                <StatRow label={copy.signer} value={copy.relayer} />
              </>
            ) : relayerMode ? (
              <>
                <StatRow
                  label={hostedCopy.provedBy}
                  value={
                    provingParty === 'hosted-server'
                      ? hostedCopy.byServer
                      : provingParty === 'device'
                        ? proverCopy.byDevice
                        : hostedCopy.byWallet
                  }
                />
                <StatRow label={copy.signer} value={copy.relayer} />
              </>
            ) : (
              <>
                <StatRow
                  label={copy.wallet}
                  value={walletStatus === 'connected' ? copy.walletConnected : copy.walletPending}
                />
                <StatRow
                  label={copy.dust}
                  value={
                    dustBalance === null
                      ? copy.dustUnavailable
                      : `${dustBalance.toString()} ${copy.available}`
                  }
                />
              </>
            )}
          </StatGroup>
        </div>
        {live && !relayerMode && !walletless ? <WalletWidget /> : null}
        {previewError ? (
          <div className="flow__sheet-group">
            <Callout
              tone="danger"
              role="alert"
              title={`${networkLabel(locale)} ${copy.cannotSubmit}`}
            >
              {previewError}
            </Callout>
          </div>
        ) : null}
        {live ? null : (
          <div className="flow__sheet-group">
            <Callout>{copy.simulatedNote}</Callout>
          </div>
        )}
      </Sheet>
    </>
  );
}
