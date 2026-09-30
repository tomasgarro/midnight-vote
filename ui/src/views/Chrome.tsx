import { Scales, UserCircle, X } from '@phosphor-icons/react';
import bust from '@/assets/companion/cleisthenes-bust.webp';
import { Button } from '@/components/system';
import { LanguageToggle } from '@/components/system/LanguageToggle';
import type { CicoLocale } from '@/integration/locale';
import { APP_COPY, APP_MODE, type Tab } from '@/views/app-runtime';
import './chrome.css';

/** Shell strings that never belonged in inline `locale === 'es'` ternaries. */
const CHROME_COPY = {
  es: {
    passportFailed: 'No se pudo conectar Passport',
    dismissNotice: 'Cerrar aviso',
    retry: 'Reintentar',
    language: 'Cambiar idioma',
    primaryNav: 'Navegación principal',
  },
  en: {
    passportFailed: 'Passport could not connect',
    dismissNotice: 'Dismiss notice',
    retry: 'Try again',
    language: 'Change language',
    primaryNav: 'Primary navigation',
  },
  fr: {
    passportFailed: 'Passport n’a pas pu se connecter',
    dismissNotice: "Fermer l'avis",
    retry: 'Réessayer',
    language: 'Changer de langue',
    primaryNav: 'Navigation principale',
  },
} as const;

/**
 * The app shell: a quiet header and three destinations.
 *
 * The header says where you are and in which mode, and lets you change the
 * language. Feedback and settings are in `You`, with everything else that is
 * about the person. Five controls in the header and five in the bar made ten
 * things to read before the first consultation.
 *
 * The accent is kept for the active destination and for the small, truthful
 * mode signal.
 */

export interface AppHeaderProps {
  readonly passportError: string | null;
  readonly onConnectPassport: () => void;
  readonly onDismissPassportError: () => void;
  readonly locale: CicoLocale;
  readonly onLocaleChange: (locale: CicoLocale) => void;
}

export function AppHeader({
  passportError,
  onConnectPassport,
  onDismissPassportError,
  locale,
  onLocaleChange,
}: AppHeaderProps) {
  const chrome = CHROME_COPY[locale];
  const environment =
    APP_MODE === 'showcase'
      ? 'LIVE'
      : APP_MODE === 'preview'
        ? 'PREVIEW'
        : APP_MODE === 'undeployed'
          ? 'LOCAL'
          : 'DEMO';
  return (
    <header className="chrome-header">
      <div className="chrome-header__identity">
        <span className="dashboard-brand">
          <img
            className="dashboard-symbol dashboard-symbol--product"
            src="/brand/midnight-vote-d3-black.svg"
            alt="midnight.vote"
          />
          <span aria-hidden="true">midnight.vote</span>
        </span>
        <span className={`chrome-environment chrome-environment--${APP_MODE}`}>
          <span className="chrome-environment__dot" aria-hidden="true" />
          {environment}
        </span>
      </div>
      <div className="chrome-actions">
        <LanguageToggle locale={locale} onChange={onLocaleChange} label={chrome.language} compact />
      </div>
      {passportError ? (
        <div className="chrome-popover chrome-popover--header" role="alert">
          <div className="chrome-popover__head">
            <strong>{chrome.passportFailed}</strong>
            <button
              type="button"
              className="chrome-popover__close"
              onClick={onDismissPassportError}
              aria-label={chrome.dismissNotice}
            >
              <X size={15} />
            </button>
          </div>
          <p>{passportError}</p>
          <Button variant="link" size="sm" onClick={onConnectPassport}>
            {chrome.retry}
          </Button>
        </div>
      ) : null}
    </header>
  );
}

export interface BottomNavProps {
  readonly tab: Tab;
  readonly onChange: (tab: Tab) => void;
  readonly locale: CicoLocale;
}

export function BottomNav({ tab, onChange, locale }: BottomNavProps) {
  const copy = APP_COPY[locale];
  const chrome = CHROME_COPY[locale];
  const current = (id: Tab) => (tab === id ? 'page' : undefined);
  const itemClass = (id: Tab, extra = '') =>
    `chrome-nav__item ${extra} ${tab === id ? 'chrome-nav__item--active' : ''}`
      .replace(/\s+/gu, ' ')
      .trim();
  return (
    <div className="chrome-bar">
      {/* Tab switching is met 100+ times a day, so it gets the platform
          default and nothing else: no slide, no icon animation. */}
      <nav className="chrome-nav" aria-label={chrome.primaryNav}>
        <button
          type="button"
          className={itemClass('consultations')}
          onClick={() => onChange('consultations')}
          aria-current={current('consultations')}
        >
          <span className="chrome-nav__icon" aria-hidden="true">
            <Scales size={22} weight={tab === 'consultations' ? 'fill' : 'regular'} />
          </span>
          <span className="chrome-nav__label">{copy.nav.consultations}</span>
        </button>
        {/* The guide is a place like the other two, so he is inside the list
            and can be the current one. His face is his icon. */}
        <button
          type="button"
          className={itemClass('cleisthenes', 'chrome-nav__item--guide')}
          onClick={() => onChange('cleisthenes')}
          aria-current={current('cleisthenes')}
        >
          <span className="chrome-nav__face" aria-hidden="true">
            <img src={bust} alt="" width="52" height="52" />
          </span>
          <span className="chrome-nav__label">{copy.nav.cleisthenes}</span>
        </button>
        <button
          type="button"
          className={itemClass('you')}
          onClick={() => onChange('you')}
          aria-current={current('you')}
        >
          <span className="chrome-nav__icon" aria-hidden="true">
            <UserCircle size={22} weight={tab === 'you' ? 'fill' : 'regular'} />
          </span>
          <span className="chrome-nav__label">{copy.nav.you}</span>
        </button>
      </nav>
    </div>
  );
}
