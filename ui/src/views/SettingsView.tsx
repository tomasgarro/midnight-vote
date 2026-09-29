import {
  ArrowLeft,
  Bell,
  CaretRight,
  ChatCircleText,
  CheckCircle,
  CloudArrowUp,
  FileText,
  Fingerprint,
  GearSix,
  GoogleDriveLogo,
  HardDrives,
  Key,
  LockKey,
  Moon,
  ShieldCheck,
  Translate,
  Trash,
} from '@phosphor-icons/react';
import type { CivicPassportSession } from 'midnight-referendum-api';
import { type ReactNode, useState } from 'react';
import { Button, Card, Display, Eyebrow } from '@/components/system';
import type { CicoLocale } from '@/integration/locale';
import type { ThemePreference } from '@/integration/theme';
import { APP_MODE, networkLabel } from '@/views/app-runtime';
import { FeedbackForm } from './FeedbackForm';
import { PASSPORT_HELP, passportDisplay } from './passport-display';
import './settings-view.css';

type SettingsPanel = 'help' | 'root' | 'privacy' | 'terms' | 'feedback' | 'recovery' | 'advanced';

const COPY = {
  es: {
    title: 'Ajustes',
    back: 'Volver',
    account: 'Cuenta',
    fallbackName: 'Tu Passport ciudadano',
    connected: 'Passport conectado',
    pending: 'Passport sin conectar',
    accountHint: 'Sesión e identidad separadas de tu pase de elegibilidad.',
    preferences: 'Preferencias',
    darkMode: 'Modo oscuro',
    darkModeHint: 'Cambia la apariencia de esta app',
    haptics: 'Vibración',
    hapticsHint: 'Disponible cuando usemos una app nativa',
    language: 'Idioma',
    privacyAndHelp: 'Privacidad y ayuda',
    privacy: 'Política de privacidad',
    privacyHint: 'Qué recibimos, qué no guardamos y tus opciones',
    terms: 'Términos de uso',
    termsHint: 'Condiciones de esta experiencia de prototipo',
    feedback: 'Ayuda y feedback',
    feedbackHint: 'Escribinos qué deberíamos mejorar',
    security: 'Seguridad',
    recovery: 'Recuperación y backup',
    recoveryHint: 'Opciones locales y futuras, sin exponer secretos todavía',
    advanced: 'Ajustes avanzados',
    advancedHint: 'Entorno, sesión y acciones de mantenimiento',
    session: 'Sesión en este dispositivo',
    lock: 'Bloquear y conservar datos',
    lockHint: 'Cierra la sesión y conserva los datos locales.',
    remove: 'Eliminar datos locales',
    removeHint:
      'Borra el pase, los comprobantes y las respuestas selladas de este navegador. Una respuesta sellada que todavía no se contó no se contará nunca.',
    removeConfirm: 'Confirmar eliminación local',
    cancel: 'Cancelar',
    soon: 'Pronto',
    privacyTitle: 'Política de privacidad',
    privacyLead:
      'Resumen de privacidad para este prototipo. No reemplaza una política legal publicada.',
    privacySections: [
      ['Lo que recibimos', 'Passport comparte solo la sesión y los campos de perfil que aprobás.'],
      [
        'Lo que no guardamos',
        'El demo no lee NFC ni guarda datos de pasaporte, MRZ, rostro, secreto de voto o elección.',
      ],
      [
        'Lo que queda en este dispositivo',
        'El pase y los comprobantes de demo se conservan localmente para que puedas recorrer la experiencia.',
      ],
      [
        'Tus opciones',
        'Podés bloquear la sesión o eliminar los datos locales desde Ajustes. Eso no elimina tu cuenta Passport.',
      ],
    ],
    termsTitle: 'Términos de uso',
    termsLead: 'Esta app es una experiencia de investigación y demostración no vinculante.',
    termsSections: [
      ['Prototipo', 'El flujo puede usar estados simulados y no representa una elección legal.'],
      [
        'Elegibilidad',
        'Un pase demuestra el resultado mínimo de un proceso; no es un pasaporte ni una identidad completa.',
      ],
      ['Acciones reales', 'Ningún voto, pago o transacción real se envía desde el modo demo.'],
      [
        'Proveedores',
        'Passport y cualquier proveedor de evidencia operan dentro de sus propios límites y consentimientos.',
      ],
    ],
    feedbackTitle: 'Ayuda y feedback',
    feedbackLead: 'Contanos dónde te trabaste o qué haría más clara esta experiencia.',
    recoveryTitle: 'Recuperación y backup',
    recoveryLead:
      'La recuperación de secretos necesita una implementación revisada. Mostramos las opciones sin fingir que ya están disponibles.',
    localRecovery: 'Recuperación local',
    localRecoveryHint: 'Protección del dispositivo y almacenamiento cifrado',
    privateKey: 'Ver o exportar clave privada',
    privateKeyHint: 'No exponemos material secreto en este prototipo',
    encryptedBackup: 'Descargar backup cifrado',
    encryptedBackupHint: 'Exportación recuperable, pendiente de revisión',
    googleBackup: 'Backup con Google Drive',
    googleBackupHint: 'Copia cifrada fuera del dispositivo',
    rarimoBackup: 'Backup con Rarimo',
    rarimoBackupHint: 'Proveedor externo, sujeto a integración',
    recoveryNote:
      'Nunca inventamos una clave privada ni mostramos datos de documento para llenar una pantalla.',
    advancedTitle: 'Ajustes avanzados',
    advancedLead:
      'Detalles operativos y acciones que pueden cambiar el estado local de esta experiencia.',
    environment: 'Entorno',
    network: 'Red',
    passportSession: 'Sesión Passport',
    localOnly: 'Solo local',
    connectedStatus: 'Conectada',
    notConnectedStatus: 'Sin conectar',
    reviewJourney: 'Revisar cómo funciona',
    reviewJourneyHint: 'Volver a recorrer Passport, documento y pase',
    mode: 'Modo de ejecución',
  },
  en: {
    title: 'Settings',
    back: 'Back',
    account: 'Account',
    fallbackName: 'Your citizen Passport',
    connected: 'Passport connected',
    pending: 'Passport not connected',
    accountHint: 'Session and identity stay separate from your eligibility pass.',
    preferences: 'Preferences',
    darkMode: 'Dark mode',
    darkModeHint: 'Change the appearance of this app',
    haptics: 'Haptics',
    hapticsHint: 'Available when we ship a native app',
    language: 'Language',
    privacyAndHelp: 'Privacy and help',
    privacy: 'Privacy policy',
    privacyHint: 'What we receive, do not keep, and your choices',
    terms: 'Terms of use',
    termsHint: 'Conditions for this prototype experience',
    feedback: 'Help and feedback',
    feedbackHint: 'Tell us what should be clearer',
    security: 'Security',
    recovery: 'Recovery and backup',
    recoveryHint: 'Local and future options, without exposing secrets yet',
    advanced: 'Advanced settings',
    advancedHint: 'Environment, session, and maintenance actions',
    session: 'Session on this device',
    lock: 'Lock and keep data',
    lockHint: 'End the session while keeping local data.',
    remove: 'Remove local data',
    removeHint:
      'Delete the pass, receipts and sealed answers from this browser. A sealed answer that was not counted yet will never be counted.',
    removeConfirm: 'Confirm local deletion',
    cancel: 'Cancel',
    soon: 'Soon',
    privacyTitle: 'Privacy policy',
    privacyLead:
      'Privacy summary for this prototype. It does not replace a published legal policy.',
    privacySections: [
      ['What we receive', 'Passport shares only the session and profile fields you approve.'],
      [
        'What we do not keep',
        'The demo reads no NFC and stores no passport, MRZ, face, voting secret, or choice data.',
      ],
      [
        'What stays on this device',
        'Demo passes and receipts are kept locally so you can walk through the experience.',
      ],
      [
        'Your choices',
        'You can lock the session or remove local data from Settings. This does not delete your Passport account.',
      ],
    ],
    termsTitle: 'Terms of use',
    termsLead: 'This app is a non-binding research and demonstration experience.',
    termsSections: [
      ['Prototype', 'The flow may use simulated states and does not represent a legal election.'],
      [
        'Eligibility',
        'A pass represents the minimum result of a process; it is not a passport or a full identity.',
      ],
      ['Real actions', 'No real vote, payment, or transaction is sent from demo mode.'],
      [
        'Providers',
        'Passport and any evidence provider operate within their own boundaries and consent flows.',
      ],
    ],
    feedbackTitle: 'Help and feedback',
    feedbackLead: 'Tell us where you got stuck or what would make this experience clearer.',
    recoveryTitle: 'Recovery and backup',
    recoveryLead:
      'Secret recovery needs a reviewed implementation. We show the options without pretending they are available yet.',
    localRecovery: 'Local recovery',
    localRecoveryHint: 'Device protection and encrypted storage',
    privateKey: 'View or export private key',
    privateKeyHint: 'Secret material is not exposed in this prototype',
    encryptedBackup: 'Download encrypted backup',
    encryptedBackupHint: 'Recoverable export, pending review',
    googleBackup: 'Google Drive backup',
    googleBackupHint: 'Encrypted copy outside this device',
    rarimoBackup: 'Rarimo backup',
    rarimoBackupHint: 'External provider, pending integration',
    recoveryNote: 'We never invent a private key or show document data just to fill a screen.',
    advancedTitle: 'Advanced settings',
    advancedLead: 'Operational details and actions that can change this experience’s local state.',
    environment: 'Environment',
    network: 'Network',
    passportSession: 'Passport session',
    localOnly: 'Local only',
    connectedStatus: 'Connected',
    notConnectedStatus: 'Not connected',
    reviewJourney: 'Review how it works',
    reviewJourneyHint: 'Walk through Passport, document, and pass again',
    mode: 'Runtime mode',
  },
  fr: {
    title: 'Réglages',
    back: 'Retour',
    account: 'Compte',
    fallbackName: 'Votre Passport citoyen',
    connected: 'Passport connecté',
    pending: 'Passport non connecté',
    accountHint: 'La session et l’identité restent séparées de votre justificatif.',
    preferences: 'Préférences',
    darkMode: 'Mode sombre',
    darkModeHint: 'Modifier l’apparence de cette application',
    haptics: 'Vibrations',
    hapticsHint: 'Disponible avec une application native',
    language: 'Langue',
    privacyAndHelp: 'Confidentialité et aide',
    privacy: 'Politique de confidentialité',
    privacyHint: 'Ce que nous recevons, ne conservons pas et vos choix',
    terms: 'Conditions d’utilisation',
    termsHint: 'Conditions de cette expérience de prototype',
    feedback: 'Aide et retours',
    feedbackHint: 'Dites-nous ce qui devrait être plus clair',
    security: 'Sécurité',
    recovery: 'Récupération et sauvegarde',
    recoveryHint: 'Options locales et futures, sans exposer les secrets',
    advanced: 'Réglages avancés',
    advancedHint: 'Environnement, session et maintenance',
    session: 'Session sur cet appareil',
    lock: 'Verrouiller et conserver les données',
    lockHint: 'Terminer la session en conservant les données locales.',
    remove: 'Supprimer les données locales',
    removeHint:
      'Effacer le justificatif, les reçus et les réponses scellées de ce navigateur. Une réponse scellée pas encore comptée ne le sera jamais.',
    removeConfirm: 'Confirmer la suppression locale',
    cancel: 'Annuler',
    soon: 'Bientôt',
    privacyTitle: 'Politique de confidentialité',
    privacyLead:
      'Résumé de confidentialité pour ce prototype. Il ne remplace pas une politique légale publiée.',
    privacySections: [
      [
        'Ce que nous recevons',
        'Passport partage uniquement la session et les champs de profil que vous approuvez.',
      ],
      [
        'Ce que nous ne conservons pas',
        'La démo ne lit pas le NFC et ne conserve aucune donnée de passeport, MRZ, visage, secret ou choix de vote.',
      ],
      [
        'Ce qui reste sur cet appareil',
        'Les justificatifs et reçus de démo restent locaux pour vous permettre de parcourir l’expérience.',
      ],
      [
        'Vos choix',
        'Vous pouvez verrouiller la session ou supprimer les données locales dans Réglages. Cela ne supprime pas votre compte Passport.',
      ],
    ],
    termsTitle: 'Conditions d’utilisation',
    termsLead:
      'Cette application est une expérience de recherche et de démonstration non contractuelle.',
    termsSections: [
      [
        'Prototype',
        'Le parcours peut utiliser des états simulés et ne représente pas une élection légale.',
      ],
      [
        'Éligibilité',
        'Un justificatif représente le résultat minimal d’un processus ; ce n’est ni un passeport ni une identité complète.',
      ],
      [
        'Actions réelles',
        'Aucun vote, paiement ou transaction réel n’est envoyé depuis le mode démo.',
      ],
      [
        'Fournisseurs',
        'Passport et les fournisseurs de preuve agissent dans leurs propres limites et consentements.',
      ],
    ],
    feedbackTitle: 'Aide et retours',
    feedbackLead: 'Dites-nous où vous avez hésité ou ce qui rendrait cette expérience plus claire.',
    recoveryTitle: 'Récupération et sauvegarde',
    recoveryLead:
      'La récupération des secrets nécessite une implémentation revue. Nous affichons les options sans prétendre qu’elles sont disponibles.',
    localRecovery: 'Récupération locale',
    localRecoveryHint: 'Protection de l’appareil et stockage chiffré',
    privateKey: 'Voir ou exporter la clé privée',
    privateKeyHint: 'Le matériel secret n’est pas exposé dans ce prototype',
    encryptedBackup: 'Télécharger une sauvegarde chiffrée',
    encryptedBackupHint: 'Export récupérable, en attente de revue',
    googleBackup: 'Sauvegarde Google Drive',
    googleBackupHint: 'Copie chiffrée hors de cet appareil',
    rarimoBackup: 'Sauvegarde Rarimo',
    rarimoBackupHint: 'Fournisseur externe, intégration à venir',
    recoveryNote:
      'Nous n’inventons jamais une clé privée et n’affichons pas de données de document pour remplir un écran.',
    advancedTitle: 'Réglages avancés',
    advancedLead:
      'Détails opérationnels et actions qui peuvent modifier l’état local de cette expérience.',
    environment: 'Environnement',
    network: 'Réseau',
    passportSession: 'Session Passport',
    localOnly: 'Local uniquement',
    connectedStatus: 'Connectée',
    notConnectedStatus: 'Non connectée',
    reviewJourney: 'Revoir le fonctionnement',
    reviewJourneyHint: 'Reparcourir Passport, le document et le justificatif',
    mode: 'Mode d’exécution',
  },
} as const;

interface SettingsViewProps {
  readonly passportSession: CivicPassportSession | null;
  readonly initialPanel?: SettingsPanel;
  readonly locale: CicoLocale;
  readonly onLocaleChange: (locale: CicoLocale) => void;
  readonly theme: ThemePreference;
  readonly onThemeChange: (theme: ThemePreference) => void;
  readonly onBack: () => void;
  readonly onReplayOnboarding: () => void;
  readonly onLockAndDisconnect: () => void;
  readonly onRemoveLocalData: () => Promise<void>;
}

function SoonBadge({ label }: { label: string }) {
  return <span className="settings-soon">{label}</span>;
}

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange?: () => void;
}) {
  return (
    <button
      type="button"
      className="settings-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function SettingsRow({
  icon,
  title,
  hint,
  onClick,
  trailing,
  disabled = false,
  danger = false,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  const content = (
    <>
      <span className="settings-row__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="settings-row__copy">
        <strong>{title}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      {trailing ? <span className="settings-row__trailing">{trailing}</span> : null}
    </>
  );

  return onClick ? (
    <button
      type="button"
      className={`settings-row settings-row--action${danger ? ' settings-row--danger' : ''}${disabled ? ' settings-row--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {content}
    </button>
  ) : (
    <div className={`settings-row${disabled ? ' settings-row--disabled' : ''}`}>{content}</div>
  );
}

function PanelHeader({
  title,
  backLabel,
  onBack,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <header className="settings__head">
      <button type="button" className="settings__back" onClick={onBack} aria-label={backLabel}>
        <ArrowLeft size={20} weight="bold" />
      </button>
      <Display>{title}</Display>
    </header>
  );
}

function PolicyPanel({
  title,
  lead,
  sections,
  backLabel,
  onBack,
}: {
  title: string;
  lead: string;
  sections: readonly (readonly [string, string])[];
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <main className="settings">
      <PanelHeader title={title} backLabel={backLabel} onBack={onBack} />
      <p className="settings__lead">{lead}</p>
      <div className="settings__reading">
        {sections.map(([heading, body]) => (
          <article key={heading}>
            <h2>{heading}</h2>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </main>
  );
}

export function SettingsView({
  passportSession,
  initialPanel = 'root',
  locale,
  onLocaleChange,
  theme,
  onThemeChange,
  onBack,
  onReplayOnboarding,
  onLockAndDisconnect,
  onRemoveLocalData,
}: SettingsViewProps) {
  const copy = COPY[locale];
  const [panel, setPanel] = useState<SettingsPanel>(initialPanel);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const displayName = passportDisplay(passportSession, locale);

  if (panel === 'privacy') {
    return (
      <PolicyPanel
        title={copy.privacyTitle}
        lead={copy.privacyLead}
        sections={copy.privacySections}
        backLabel={copy.back}
        onBack={() => setPanel('root')}
      />
    );
  }
  if (panel === 'terms') {
    return (
      <PolicyPanel
        title={copy.termsTitle}
        lead={copy.termsLead}
        sections={copy.termsSections}
        backLabel={copy.back}
        onBack={() => setPanel('root')}
      />
    );
  }
  if (panel === 'feedback') {
    return (
      <main className="settings">
        <PanelHeader
          title={copy.feedbackTitle}
          backLabel={copy.back}
          onBack={() => setPanel('root')}
        />
        <p className="settings__lead">{copy.feedbackLead}</p>
        <FeedbackForm locale={locale} />
        <a href="/feedback">midnight.vote/feedback ↗</a>
      </main>
    );
  }
  if (panel === 'recovery') {
    return (
      <main className="settings">
        <PanelHeader
          title={copy.recoveryTitle}
          backLabel={copy.back}
          onBack={() => setPanel('root')}
        />
        <p className="settings__lead">{copy.recoveryLead}</p>
        <Eyebrow>{copy.security}</Eyebrow>
        <Card className="settings__rows" flush>
          <SettingsRow
            icon={<HardDrives size={19} />}
            title={copy.localRecovery}
            hint={copy.localRecoveryHint}
            trailing={<SoonBadge label={copy.soon} />}
            disabled
          />
          <SettingsRow
            icon={<Key size={19} />}
            title={copy.privateKey}
            hint={copy.privateKeyHint}
            trailing={<SoonBadge label={copy.soon} />}
            disabled
          />
          <SettingsRow
            icon={<CloudArrowUp size={19} />}
            title={copy.encryptedBackup}
            hint={copy.encryptedBackupHint}
            trailing={<SoonBadge label={copy.soon} />}
            disabled
          />
          <SettingsRow
            icon={<GoogleDriveLogo size={19} />}
            title={copy.googleBackup}
            hint={copy.googleBackupHint}
            trailing={<SoonBadge label={copy.soon} />}
            disabled
          />
          <SettingsRow
            icon={<ShieldCheck size={19} />}
            title={copy.rarimoBackup}
            hint={copy.rarimoBackupHint}
            trailing={<SoonBadge label={copy.soon} />}
            disabled
          />
        </Card>
        <div className="settings__notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>{copy.recoveryNote}</p>
        </div>
      </main>
    );
  }
  if (panel === 'help') {
    return (
      <main className="settings">
        <PanelHeader
          title={PASSPORT_HELP[locale].title}
          backLabel={copy.back}
          onBack={() => setPanel('root')}
        />
        <Card className="settings__rows" flush>
          <SettingsRow
            icon={<Fingerprint size={19} />}
            title={copy.reviewJourney}
            hint={copy.reviewJourneyHint}
            onClick={onReplayOnboarding}
            trailing={<CaretRight size={18} />}
          />
          <a
            className="settings-row"
            href="https://midnight.domains/"
            target="_blank"
            rel="noreferrer"
          >
            <span className="settings-row__icon">
              <Moon size={19} />
            </span>
            <span className="settings-row__copy">
              <strong>{PASSPORT_HELP[locale].night}</strong>
              <small>{PASSPORT_HELP[locale].nightHint}</small>
            </span>
            <CaretRight size={18} />
          </a>
          <SettingsRow
            icon={<ShieldCheck size={19} />}
            title={copy.privacy}
            hint={copy.privacyHint}
            onClick={() => setPanel('privacy')}
            trailing={<CaretRight size={18} />}
          />
          <SettingsRow
            icon={<Key size={19} />}
            title={copy.recovery}
            hint={copy.recoveryHint}
            onClick={() => setPanel('recovery')}
            trailing={<CaretRight size={18} />}
          />
        </Card>
      </main>
    );
  }
  if (panel === 'advanced') {
    return (
      <main className="settings">
        <PanelHeader
          title={copy.advancedTitle}
          backLabel={copy.back}
          onBack={() => setPanel('root')}
        />
        <p className="settings__lead">{copy.advancedLead}</p>
        <Eyebrow>{copy.environment}</Eyebrow>
        <Card className="settings__rows" flush>
          <SettingsRow
            icon={<GearSix size={19} />}
            title={copy.mode}
            trailing={<strong className="settings-value">{APP_MODE}</strong>}
          />
          <SettingsRow
            icon={<HardDrives size={19} />}
            title={copy.network}
            trailing={<strong className="settings-value">{networkLabel(locale)}</strong>}
          />
          <SettingsRow
            icon={<Fingerprint size={19} />}
            title={copy.passportSession}
            trailing={
              <strong className="settings-value">
                {passportSession ? copy.connectedStatus : copy.notConnectedStatus}
              </strong>
            }
          />
        </Card>
        <Eyebrow>{copy.session}</Eyebrow>
        <Card className="settings__rows" flush>
          <SettingsRow
            icon={<Trash size={19} />}
            title={copy.remove}
            hint={copy.removeHint}
            danger
            onClick={() => setConfirmRemove(true)}
            trailing={<CaretRight size={18} />}
          />
        </Card>
        {confirmRemove ? (
          <div className="settings__confirm" role="alert">
            <p>{copy.removeHint}</p>
            <div>
              <Button variant="secondary" size="sm" onClick={() => setConfirmRemove(false)}>
                {copy.cancel}
              </Button>
              <Button variant="danger" size="sm" onClick={() => void onRemoveLocalData()}>
                {copy.removeConfirm}
              </Button>
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="settings">
      <PanelHeader title={copy.title} backLabel={copy.back} onBack={onBack} />

      <Card className="settings__account">
        <span className="settings__avatar" aria-hidden="true">
          <Fingerprint size={25} weight="bold" />
        </span>
        <span>
          <strong>{displayName}</strong>
          <small className={passportSession ? 'settings__status--connected' : undefined}>
            <CheckCircle size={14} weight="bold" />{' '}
            {passportSession ? copy.connected : copy.pending}
          </small>
          <em>{copy.accountHint}</em>
        </span>
      </Card>

      <Card className="settings__rows" flush>
        <SettingsRow
          icon={<ShieldCheck size={19} />}
          title={PASSPORT_HELP[locale].title}
          hint={PASSPORT_HELP[locale].hint}
          onClick={() => setPanel('help')}
          trailing={<CaretRight size={18} />}
        />
      </Card>
      <section className="settings__section">
        <Eyebrow>{copy.preferences}</Eyebrow>
        <Card className="settings__rows" flush>
          <div className="settings-row">
            <span className="settings-row__icon" aria-hidden="true">
              <Moon size={19} />
            </span>
            <span className="settings-row__copy">
              <strong>{copy.darkMode}</strong>
              <small>{copy.darkModeHint}</small>
            </span>
            <Switch
              checked={theme === 'dark'}
              label={copy.darkMode}
              onChange={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
            />
          </div>
          <div className="settings-row settings-row--disabled">
            <span className="settings-row__icon" aria-hidden="true">
              <Bell size={19} />
            </span>
            <span className="settings-row__copy">
              <strong>{copy.haptics}</strong>
              <small>{copy.hapticsHint}</small>
            </span>
            <span className="settings-row__trailing">
              <Switch checked={false} disabled label={copy.haptics} />
              <SoonBadge label={copy.soon} />
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row__icon" aria-hidden="true">
              <Translate size={19} />
            </span>
            <label className="settings-row__copy" htmlFor="settings-language">
              <strong>{copy.language}</strong>
            </label>
            <select
              id="settings-language"
              className="settings-select"
              value={locale}
              onChange={(event) => onLocaleChange(event.target.value as CicoLocale)}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>
        </Card>
      </section>

      <section className="settings__section">
        <Eyebrow>{copy.privacyAndHelp}</Eyebrow>
        <Card className="settings__rows" flush>
          <SettingsRow
            icon={<ShieldCheck size={19} />}
            title={copy.privacy}
            hint={copy.privacyHint}
            onClick={() => setPanel('privacy')}
            trailing={<CaretRight size={18} />}
          />
          <SettingsRow
            icon={<FileText size={19} />}
            title={copy.terms}
            hint={copy.termsHint}
            onClick={() => setPanel('terms')}
            trailing={<CaretRight size={18} />}
          />
          <SettingsRow
            icon={<ChatCircleText size={19} />}
            title={copy.feedback}
            hint={copy.feedbackHint}
            onClick={() => setPanel('feedback')}
            trailing={<CaretRight size={18} />}
          />
        </Card>
      </section>

      <section className="settings__section">
        <Eyebrow>{copy.security}</Eyebrow>
        <Card className="settings__rows" flush>
          <SettingsRow
            icon={<Key size={19} />}
            title={copy.recovery}
            hint={copy.recoveryHint}
            onClick={() => setPanel('recovery')}
            trailing={<CaretRight size={18} />}
          />
          <SettingsRow
            icon={<GearSix size={19} />}
            title={copy.advanced}
            hint={copy.advancedHint}
            onClick={() => setPanel('advanced')}
            trailing={<CaretRight size={18} />}
          />
        </Card>
      </section>

      <section className="settings__section">
        <Eyebrow>{copy.session}</Eyebrow>
        <Card className="settings__rows" flush>
          <SettingsRow
            icon={<LockKey size={19} />}
            title={copy.lock}
            hint={copy.lockHint}
            onClick={onLockAndDisconnect}
            disabled={!passportSession}
          />
          <SettingsRow
            icon={<Trash size={19} />}
            title={copy.remove}
            hint={copy.removeHint}
            danger
            onClick={() => setConfirmRemove(true)}
            trailing={<CaretRight size={18} />}
          />
        </Card>
      </section>

      {confirmRemove ? (
        <div className="settings__confirm" role="alert">
          <p>{copy.removeHint}</p>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setConfirmRemove(false)}>
              {copy.cancel}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void onRemoveLocalData()}>
              {copy.removeConfirm}
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
