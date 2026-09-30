import { ArrowRight, CheckCircle, Lock } from '@phosphor-icons/react';
import type { CivicPassportSession, PassportSessionPort } from 'midnight-referendum-api';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CompanionFigure } from '@/components/companion';
import { CountryFlag, CountryPicker, JourneyTopBar, Sheet } from '@/components/system';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import type { OnboardingStage } from '@/integration/civic-state';
import { countryName } from '@/integration/country-catalog';
import { type CicoLocale, detectLocale, persistLocale } from '@/integration/locale';
import { passportErrorCopy } from '@/integration/passport-error-copy';
import { PASSPORT_ACCOUNT_NETWORK } from '@/views/app-runtime';
import { ConnectionStatus } from './ConnectionStatus';
import { DocumentVerificationJourney } from './DocumentVerificationJourney';
import { ONBOARDING_COPY } from './onboarding-copy';
import { PassportPageArt } from './PassportPageArt';
import { PreviewPassportJourney, type PreviewPassportJourneyPorts } from './PreviewPassportJourney';
import { useJourneyHistory } from './useJourneyHistory';
import './journey.css';
import './onboarding.css';

export type OnboardingOutcome = 'browsing' | 'deferred' | 'demo-ready' | 'verified';
export interface UnifiedPassportOnboardingProps {
  mode: 'demo' | 'showcase' | 'preview' | 'undeployed';
  passportPort?: PassportSessionPort;
  previewPorts?: PreviewPassportJourneyPorts;
  onClose: () => void;
  onComplete?: (outcome: OnboardingOutcome) => void;
  dismissible?: boolean;
  onCredentialReady?: (credential: DemoCredentialSummary) => void;
  onPassportConnected?: (session: CivicPassportSession | null) => void;
  initialSession?: CivicPassportSession | null;
  initialStage?: OnboardingStage;
  initialLocale?: CicoLocale;
  onLocaleChange?: (locale: CicoLocale) => void;
}

export function UnifiedPassportOnboarding({
  mode,
  passportPort,
  previewPorts,
  onClose,
  onComplete,
  dismissible = true,
  onCredentialReady,
  onPassportConnected,
  initialSession = null,
  initialStage = 'welcome',
  initialLocale,
  onLocaleChange,
}: UnifiedPassportOnboardingProps) {
  const [locale, setLocale] = useState<CicoLocale>(() => initialLocale ?? detectLocale());
  const entry =
    initialStage === 'demo-country' || initialStage === 'credential-success'
      ? 'eligibility'
      : initialStage === 'consent-return'
        ? 'passport'
        : initialStage;
  const history = useJourneyHistory<OnboardingStage>(entry);
  const { stage, go, back, canBack } = history;
  const [session, setSession] = useState(initialSession);
  const demoSelected = session?.sessionId === 'local-demo-explicit';
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState('FR');
  const [age, setAge] = useState(25);
  const [countrySearchOpen, setCountrySearchOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [createdDemo, setCreatedDemo] = useState<DemoCredentialSummary | null>(null);
  const attempt = useRef(0);
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (stage) {
      attempt.current += 1;
      busy.current = false;
      setConnecting(false);
    }
  }, [stage]);
  const t = ONBOARDING_COPY[locale];
  const realMode = mode === 'preview' || mode === 'undeployed';
  const port = passportPort ?? previewPorts?.passport;
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );
  useLayoutEffect(() => {
    if (stage) heading.current?.focus();
  }, [stage]);
  const language = (next: CicoLocale) => {
    setLocale(next);
    persistLocale(next);
    onLocaleChange?.(next);
  };
  const cancel = () => {
    attempt.current += 1;
    busy.current = false;
    setConnecting(false);
  };
  const finish = (outcome: OnboardingOutcome) => {
    cancel();
    onComplete?.(outcome);
    onClose();
  };
  const navigateBack = () => {
    cancel();
    setError(null);
    back();
  };
  const connect = async (demo = false) => {
    if (busy.current) return;
    busy.current = true;
    const id = ++attempt.current;
    setConnecting(true);
    setError(null);
    try {
      if (!demo && !port) throw new Error(t.error);
      const next: CivicPassportSession = demo
        ? {
            sessionId: 'local-demo-explicit',
            origin: window.location.origin,
            network: 'devnet',
            status: 'connected',
            profile: { displayName: 'Demo Passport' },
            capabilities: ['session', 'profile'],
          }
        : await (port as PassportSessionPort).connect({
            origin: window.location.origin,
            network: PASSPORT_ACCOUNT_NETWORK,
            requestedCapabilities: ['session', 'profile'],
          });
      if (id !== attempt.current) return;
      setSession(next);
      onPassportConnected?.(next);
    } catch (cause) {
      if (id === attempt.current) setError(passportErrorCopy(cause, locale));
    } finally {
      if (id === attempt.current) {
        busy.current = false;
        setConnecting(false);
      }
    }
  };
  const createDemo = () => {
    const next: DemoCredentialSummary = {
      kind: 'synthetic-demo-credential',
      issuer: 'cico-demo-issuer',
      country,
      ageClass: age >= 18 ? '18+' : 'under-18',
      assurance: 'fixture',
      epoch: 'preview-2026-08',
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      commitment: '0x7a91…c420',
    };
    setCreatedDemo(next);
    go('credential-success');
  };
  const indices: Partial<Record<OnboardingStage, number>> = {
    welcome: 1,
    privacy: 2,
    passport: 3,
    eligibility: 4,
    'credential-success': 4,
    'demo-country': 4,
  };
  const current = indices[stage] ?? 1;
  const actions = (
    primary: string,
    action: () => void,
    secondary?: string,
    secondaryAction?: () => void,
  ) => (
    <div className="onboarding-actions">
      <button type="button" className="onboarding-primary" onClick={action}>
        {primary}
        <ArrowRight size={19} />
      </button>
      {secondary && (
        <button type="button" className="onboarding-secondary" onClick={secondaryAction}>
          {secondary}
        </button>
      )}
    </div>
  );
  const title = (text: string, id: string) => (
    <h1 id={id} ref={heading} tabIndex={-1}>
      {text}
    </h1>
  );

  if (stage === 'eligibility' && realMode && session && previewPorts)
    return (
      <PreviewPassportJourney
        mode={mode}
        ports={previewPorts}
        initialSession={session}
        initialLocale={locale}
        onLocaleChange={language}
        onBackToPassport={() => (canBack ? back() : go('passport'))}
        onClose={() => finish('deferred')}
        onVerified={() => finish('verified')}
        onCredentialReady={onCredentialReady}
        onPassportConnected={onPassportConnected}
      />
    );

  return (
    <main
      className="page-content passport-journey-page unified-onboarding onboarding-v3"
      data-stage={stage}
    >
      <JourneyTopBar
        locale={locale}
        onLocaleChange={language}
        languageLabel={t.language}
        {...(dismissible ? { onExit: () => finish('browsing'), exitLabel: t.exit } : {})}
        {...(canBack && !documentOpen ? { onBack: navigateBack } : {})}
        backLabel={t.back}
        badge={mode === 'demo' ? 'Demo' : mode === 'undeployed' ? 'Local' : 'Preview'}
        showProgress={stage !== 'welcome' && !documentOpen}
        current={current}
        total={4}
        stageLabel={stage}
        progressLabel={`${t.step} ${current} ${t.of} 4`}
      />
      {stage === 'welcome' && (
        <section
          className="onboarding-screen onboarding-welcome"
          aria-labelledby="onboarding-welcome-title"
        >
          <div className="onboarding-brand">
            <img src="/brand/midnight-vote-d3-black.svg" alt="" />
            midnight<span>.vote</span>
          </div>
          <div className="onboarding-welcome-art">
            <span className="onboarding-orbit" />
            <CompanionFigure pose="welcome" motion priority />
            <span className="onboarding-art-label">
              <Lock size={12} /> midnight
            </span>
          </div>
          {title(t.welcome, 'onboarding-welcome-title')}
          <p className="onboarding-secret">{t.secret}</p>
          <p className="onboarding-body">{t.invitation}</p>
          {actions(
            t.start,
            () => go('privacy'),
            t.returning,
            () => go('passport'),
          )}
        </section>
      )}
      {stage === 'privacy' && (
        <section className="onboarding-screen" aria-labelledby="onboarding-privacy-title">
          <p className="onboarding-eyebrow">MIDNIGHT / PRIVACY</p>
          {title(t.privacyTitle, 'onboarding-privacy-title')}
          <figure className="onboarding-privacy-art">
            <svg viewBox="0 0 400 210" aria-hidden="true" focusable="false">
              <ellipse cx="200" cy="113" rx="166" ry="81" fill="#ebe2d5" />
              <circle
                cx="102"
                cy="77"
                r="43"
                fill="none"
                stroke="#d7bea5"
                strokeWidth="15"
                strokeDasharray="11 7"
              />
              <circle
                cx="298"
                cy="120"
                r="52"
                fill="none"
                stroke="#b5aaa2"
                strokeWidth="13"
                strokeDasharray="12 7"
              />
              <circle cx="277" cy="38" r="19" fill="none" stroke="#d2b18f" strokeWidth="9" />
              <path
                d="M196 24 C222 42 252 48 274 49 L272 112 C269 151 236 180 198 199 C159 179 125 150 122 112 L121 49 C145 48 172 41 196 24Z"
                fill="#c57b4b"
              />
              <path
                d="M196 38 C218 53 244 59 260 60 L259 112 C255 143 229 168 198 184 C166 167 139 143 136 112 L135 60 C153 58 177 52 196 38Z"
                fill="none"
                stroke="#f8dfbf"
                strokeWidth="1.5"
              />
              <image
                href="/brand/midnight-symbol-white.svg"
                x="169"
                y="78"
                width="58"
                height="58"
              />
              <g transform="translate(55 134) rotate(-9)">
                <rect width="84" height="56" rx="10" fill="#faf7ef" stroke="#d5c7b6" />
                <path d="M17 19 H65 M17 28 H56 M17 37 H60" stroke="#afa08c" strokeWidth="4" />
              </g>
              <g transform="translate(274 161)">
                <rect width="57" height="35" rx="17" fill="#f7f3ea" stroke="#cec1b1" />
                <path
                  d="M18 18 L25 24 L38 11"
                  stroke="#7b715c"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </svg>
            <figcaption>
              <span>
                <Lock size={12} />
                {t.privateNote}
              </span>
              <span>{t.sharedNote}</span>
            </figcaption>
          </figure>
          <p className="onboarding-body">{t.privacyBody}</p>
          <ul className="onboarding-features">
            {t.features.map((feature) => (
              <li key={feature}>
                <CheckCircle size={18} />
                {feature}
              </li>
            ))}
          </ul>
          <details className="onboarding-details">
            <summary>{t.more}</summary>
            <div className="onboarding-explanation">
              <CompanionFigure pose="explain" motion />
              <p>{t.detail}</p>
            </div>
          </details>
          {actions(t.continue, () => go('passport'))}
        </section>
      )}
      {stage === 'passport' && (
        <section className="onboarding-screen" aria-labelledby="onboarding-passport-title">
          <div className="onboarding-passport-mark">
            <img src="/brand/midnight-symbol-black.svg" alt="" />
          </div>
          {title(t.connectTitle, 'onboarding-passport-title')}
          <p className="onboarding-body">{t.connectBody}</p>
          <ul className="onboarding-permissions">
            <li>
              <CheckCircle size={22} />
              {t.shares}
            </li>
            <li>
              <Lock size={22} />
              {t.protects}
            </li>
          </ul>
          {session ? (
            <div className="onboarding-connected" data-demo={demoSelected} role="status">
              {demoSelected ? (
                <span className="onboarding-demo-badge">DEMO</span>
              ) : (
                <ConnectionStatus state="success" />
              )}
              <div>
                <strong>
                  {demoSelected
                    ? locale === 'es'
                      ? 'Perfil de prueba seleccionado'
                      : locale === 'fr'
                        ? 'Profil de démo sélectionné'
                        : 'Demo profile selected'
                    : t.connected}
                </strong>
                <span>
                  {demoSelected
                    ? locale === 'es'
                      ? 'No se conectó ninguna cuenta real.'
                      : locale === 'fr'
                        ? 'Aucun compte réel n’est connecté.'
                        : 'No real account has been connected.'
                    : (session.profile?.displayName ?? 'Passport')}
                </span>
              </div>
            </div>
          ) : null}
          {connecting && (
            <div className="onboarding-waiting" role="status">
              <ConnectionStatus state="waiting" />
              <p>{t.waiting}</p>
            </div>
          )}
          {error && (
            <div className="onboarding-error" role="alert">
              <ConnectionStatus state="error" />
              <p>{error}</p>
            </div>
          )}
          <div className="onboarding-actions">
            {demoSelected && (
              <button
                type="button"
                className="onboarding-secondary"
                onClick={() => {
                  cancel();
                  setSession(null);
                  setCreatedDemo(null);
                  setError(null);
                  onPassportConnected?.(null);
                }}
              >
                {locale === 'es'
                  ? 'Usar mi Passport real'
                  : locale === 'fr'
                    ? 'Utiliser mon vrai Passport'
                    : 'Use my real Passport'}
              </button>
            )}
            <button
              className="onboarding-primary"
              type="button"
              disabled={connecting}
              onClick={() => (session ? go('eligibility') : void connect())}
            >
              {connecting ? t.waiting : session ? t.continue : t.connect}
              <ArrowRight size={19} />
            </button>
            {connecting ? (
              <button className="onboarding-secondary" type="button" onClick={cancel}>
                {t.cancel}
              </button>
            ) : (
              <>
                <button
                  className="onboarding-secondary"
                  type="button"
                  onClick={() => finish(session ? 'deferred' : 'browsing')}
                >
                  {t.skip}
                </button>
                {mode === 'demo' && !session && (
                  <button
                    className="onboarding-demo-link"
                    type="button"
                    onClick={() => void connect(true)}
                  >
                    {t.demo}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      )}
      {stage === 'eligibility' && (
        <section
          className="onboarding-screen"
          aria-labelledby={documentOpen ? undefined : 'onboarding-evidence-title'}
        >
          {documentOpen ? (
            <>
              <DocumentVerificationJourney
                locale={locale}
                onCancel={() => setDocumentOpen(false)}
                onDocumentRead={(result) => {
                  if (result.country === 'FRA') setCountry('FR');
                  if (result.country === 'ARG') setCountry('AR');
                }}
              />
              <button
                className="onboarding-secondary"
                type="button"
                onClick={() => finish('deferred')}
              >
                {t.later}
              </button>
            </>
          ) : (
            <>
              <div className="onboarding-document-art">
                <PassportPageArt />
                <CompanionFigure pose="passport" motion />
              </div>
              {title(t.documentTitle, 'onboarding-evidence-title')}
              <p className="onboarding-body">{t.documentBody}</p>
              <p className="onboarding-note">{t.documentNote}</p>
              {realMode ? (
                <p className="onboarding-note" role="status">
                  {t.connectBody}
                </p>
              ) : null}
              {!realMode && (
                <button
                  className="onboarding-demo-entry"
                  type="button"
                  onClick={() => go('demo-country')}
                >
                  <span>
                    <strong>{t.demoTitle}</strong>
                    <small>
                      {locale === 'es'
                        ? 'Elegí país y edad. Sin documentos.'
                        : locale === 'fr'
                          ? 'Choisissez le pays et l’âge. Sans document.'
                          : 'Choose a country and age. No document needed.'}
                    </small>
                  </span>
                  <ArrowRight size={20} />
                </button>
              )}
              {actions(
                realMode ? t.connect : t.verify,
                () => (realMode ? go('passport') : setDocumentOpen(true)),
                t.later,
                () => finish('deferred'),
              )}
            </>
          )}
        </section>
      )}
      {stage === 'demo-country' && !realMode && (
        <section className="onboarding-screen onboarding-demo-form">
          <p className="onboarding-eyebrow">DEMO</p>
          {title(t.demoTitle, 'demo-pass-title')}
          <p>{t.demoNote}</p>
          <fieldset className="onboarding-countries">
            <legend>{t.country}</legend>
            {[...new Set(['FR', 'AR', 'CH', 'IT', 'ES', country])].map((code) => (
              <label key={code} data-selected={country === code}>
                <input
                  type="radio"
                  name="demo-country"
                  value={code}
                  checked={country === code}
                  onChange={() => setCountry(code)}
                />
                <CountryFlag alpha2={code} size="sm" />
                {countryName(code, locale)}
              </label>
            ))}
          </fieldset>
          <button
            className="onboarding-secondary"
            type="button"
            onClick={() => setCountrySearchOpen(true)}
          >
            {locale === 'es' ? 'Más países' : locale === 'fr' ? 'Autres pays' : 'More countries'}
          </button>
          <Sheet
            open={countrySearchOpen}
            title={t.country}
            closeLabel={locale === 'es' ? 'Cerrar' : locale === 'fr' ? 'Fermer' : 'Close'}
            onClose={() => setCountrySearchOpen(false)}
          >
            <CountryPicker
              value={country}
              locale={locale}
              onChange={(code) => {
                setCountry(code);
                setCountrySearchOpen(false);
              }}
              searchLabel={t.country}
              searchPlaceholder={t.country}
              listLabel={t.country}
              suggested={['FR', 'AR', 'CH', 'IT', 'ES']}
              suggestedLabel={t.country}
              emptyLabel={
                locale === 'es'
                  ? 'No se encontró el país'
                  : locale === 'fr'
                    ? 'Aucun pays trouvé'
                    : 'No country found'
              }
            />
          </Sheet>
          <label className="onboarding-demo-age">
            <span>
              {locale === 'es' ? 'Edad de prueba' : locale === 'fr' ? 'Âge de test' : 'Test age'}
            </span>
            <input
              type="number"
              min={1}
              max={120}
              step={1}
              value={Number.isNaN(age) ? '' : age}
              onChange={(event) => setAge(event.target.valueAsNumber)}
            />
          </label>
          <button
            className="onboarding-primary"
            type="button"
            disabled={!Number.isInteger(age) || age < 1 || age > 120}
            onClick={createDemo}
          >
            {t.create}
            <ArrowRight size={19} />
          </button>
        </section>
      )}
      {stage === 'credential-success' && createdDemo && (
        <section
          className="onboarding-screen onboarding-success"
          aria-labelledby="onboarding-success-title"
        >
          <div className="onboarding-pass-confirmation" aria-hidden="true">
            <div className="onboarding-pass-confirmation__card">
              <img src="/brand/midnight-symbol-black.svg" alt="" />
              <span>DEMO</span>
              <ConnectionStatus state="success" />
            </div>
            <CompanionFigure pose="success" motion priority />
          </div>
          <p className="onboarding-eyebrow">DEMO</p>
          {title(t.success, 'onboarding-success-title')}
          <p className="onboarding-body">
            {createdDemo.ageClass === '18+'
              ? t.successBody
              : locale === 'es'
                ? 'Podés explorar y conversar. El voto de prueba requiere 18 años o más.'
                : locale === 'fr'
                  ? 'Vous pouvez explorer et discuter. Le vote de test est réservé aux 18 ans et plus.'
                  : 'You can explore and chat. Test voting requires age 18 or older.'}
          </p>
          <dl className="onboarding-summary">
            <div>
              <dt>{t.testCountry}</dt>
              <dd>{countryName(country, locale)}</dd>
            </div>
            <div>
              <dt>{t.age}</dt>
              <dd>{createdDemo.ageClass === '18+' ? '18+' : '< 18'}</dd>
            </div>
            <div>
              <dt>{t.simulated}</dt>
              <dd>Demo</dd>
            </div>
          </dl>
          {actions(t.dashboard, () => {
            onCredentialReady?.(createdDemo);
            finish('demo-ready');
          })}
        </section>
      )}
    </main>
  );
}
