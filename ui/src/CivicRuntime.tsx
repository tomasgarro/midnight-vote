import { ArrowRight, CheckCircle, X } from '@phosphor-icons/react';
import type { CivicPassportSession, CredentialSummary } from 'midnight-referendum-api';
import {
  browserBallotOpeningVault,
  browserCivicCredentialVault,
  browserRarimoEnrollmentVault,
  createIndexerRegistryHistory,
  MidnightCivicActionAdapter,
  RarimoCivicCredentialAdapter,
} from 'midnight-referendum-api';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PassportJourney } from '@/components/passport-v2/PassportJourney';
import type { PreviewPassportJourneyPorts } from '@/components/passport-v2/PreviewPassportJourney';
import { useWallet } from '@/hooks/use-wallet';
import type { DemoCredentialSummary } from '@/integration/cico-passport-journey';
import type { OnboardingStage } from '@/integration/civic-state';
import { ASSIGNED_COUNTRIES } from '@/integration/country-catalog';
import { createAppAssistant } from '@/integration/deliberation';
import { type CicoLocale, detectLocale, persistLocale } from '@/integration/locale';
import { PassportIdentityBridge } from '@/integration/passport';
import { MidnightPassportSessionAdapter } from '@/integration/passport-session-port';
import {
  HttpCivicCredentialIssuerPort,
  HttpRarimoVerificationGateway,
} from '@/integration/passport-v2-http-ports';
import { parsePassportV2RuntimeConfig } from '@/integration/passport-v2-runtime-config';
import { getPollAvailability } from '@/integration/poll-lifecycle';
import {
  findRuntimeReferendum,
  getPreviewReadiness,
  resolvePassportV2ActionRoute,
} from '@/integration/preview';
import { deriveProfileId, deriveReceiptProfileKey } from '@/integration/profile';
import { rarimoIsoCountryMapper } from '@/integration/rarimo-country-mapper';
import {
  clearPassportReceipts,
  loadPassportReceipts,
  savePassportReceipt,
} from '@/integration/receipt-store';
import { RUNTIME_COPY, sealRefusalMessage } from '@/integration/runtime-copy';
import { sealWhenAdmitted } from '@/integration/seal-admission';
import {
  browserAnswerMarkerStore,
  type CountOutcome,
  countSealedAnswer,
  listSealedAnswers,
  type OnChainAnswerStatus,
  type SealedAnswer,
} from '@/integration/sealed-answers';
import {
  applyTheme,
  detectThemePreference,
  persistThemePreference,
  type ThemePreference,
  watchSystemTheme,
} from '@/integration/theme';
import { needsHostedConsent } from '@/integration/walletless-proving';
import {
  MidnightProvidersProvider,
  PUBLIC_INDEXER_URL,
  useMidnightProviders,
} from '@/providers/midnight-providers';
import { WalletProvider } from '@/providers/wallet-context';
import { ActivityView } from '@/views/ActivityView';
import {
  APP_MODE,
  APP_NETWORK_LABEL,
  APP_ROUTE,
  CHAIN_RUNTIME_ENABLED,
  type FlowStage,
  ONBOARDING_SESSION_KEY,
  PASSPORT_ACCOUNT_NETWORK,
  PASSPORT_ORIGIN,
  PULSE_ROUTE,
  shouldShowFirstRunOnboarding,
  type Tab,
  type YouSection,
} from '@/views/app-runtime';
import { CatalogueChat, type CatalogueMessage } from '@/views/CatalogueChat';
import { AppHeader, BottomNav } from '@/views/Chrome';
import { CredentialsView } from '@/views/CredentialsView';
import { canUseCatalogueDialogue } from '@/views/catalogue-guide';
import { canUseDemoPass } from '@/views/discovery-presentation';
import { PolicyDetailView } from '@/views/PolicyDetailView';
import { ProfileView } from '@/views/ProfileView';
import {
  type Choice,
  DEFAULT_POLL,
  POLLS,
  toRuntimePolls,
  type VoteReceipt,
} from '@/views/poll-model';
import { SettingsView } from '@/views/SettingsView';
import { VoteFlow } from '@/views/VoteFlow';
import { VotesView } from '@/views/VotesView';
import { BackToYou, YouView } from '@/views/YouView';
import '@/views/dashboard.css';

/**
 * Lets a pass be proven against the newest registry root a consultation
 * admitted that already held it. The lookup names the registry only.
 */
const REGISTRY_HISTORY = PUBLIC_INDEXER_URL
  ? createIndexerRegistryHistory({ indexerUri: PUBLIC_INDEXER_URL })
  : null;

/** Re-exported so the runtime-catalog conversion keeps its existing test entry point. */
export { toRuntimePolls };

const PulseExperience = lazy(async () => {
  const module = await import('@/pulse/PulseExperience');
  return { default: module.PulseExperience };
});

function toDisplayCredential(summary: CredentialSummary): DemoCredentialSummary {
  const country =
    ASSIGNED_COUNTRIES.find((entry) => entry.numeric === String(summary.country))?.alpha2 ??
    String(summary.country);
  return {
    kind: 'verified-credential',
    issuer: summary.issuerId,
    country,
    ageClass: summary.ageClass === '18-plus' ? '18+' : summary.ageClass,
    assurance: summary.assurance,
    epoch: String(summary.credentialEpoch),
    validUntil: summary.validUntil,
  };
}

/**
 * Shown when the browser can keep nothing on disk, for example in a private
 * window. Sealing there would produce an answer that can never be counted.
 */
const SEAL_STORAGE_BLOCKED: Record<CicoLocale, string> = {
  es: 'Esta ventana no puede guardar tu respuesta sellada, así que nunca se podría contar. Abrí el sitio en una ventana normal, no privada.',
  en: 'This window cannot keep your sealed answer, so it could never be counted. Open the site in a normal window, not a private one.',
  fr: 'Cette fenêtre ne peut pas conserver votre réponse scellée ; elle ne pourrait donc jamais être comptée. Ouvrez le site dans une fenêtre normale, non privée.',
};

type CountNotice = Extract<CountOutcome, { state: 'waiting' }>['reason'];

/**
 * The tab title follows the chosen language like everything else. It names the
 * product and says "consultation": the app tells people it is not an official
 * referendum, and the tab said "Civic Referendum".
 */
const DOCUMENT_TITLE: Record<CicoLocale, string> = {
  es: 'midnight.vote · Consultas privadas y verificables',
  en: 'midnight.vote · Private, verifiable consultations',
  fr: 'midnight.vote · Consultations privées et vérifiables',
};

function CivicApp() {
  const initialOnboardingRequired = shouldShowFirstRunOnboarding();
  // Spanish is the product's default; an explicit persisted choice still wins.
  const [locale, setLocale] = useState<CicoLocale>(() => detectLocale('es-AR'));
  const [theme, setTheme] = useState<ThemePreference>(detectThemePreference);
  const [tab, setTab] = useState<Tab>('consultations');
  const [youSection, setYouSection] = useState<YouSection>('hub');
  const [guideMessages, setGuideMessages] = useState<CatalogueMessage[]>([]);
  const [reflectionContext, setReflectionContext] = useState<string | null>(null);
  const [flowStage, setFlowStage] = useState<FlowStage | null>(null);
  const [passportJourneyOpen, setPassportJourneyOpen] = useState(initialOnboardingRequired);
  // The civic pulse is outside the three steps, so no screen links to it. It
  // is kept, and its own address opens it.
  const [pulseOpen, setPulseOpen] = useState(() => window.location.hash === PULSE_ROUTE);
  useEffect(() => {
    const openFromAddress = () => {
      if (window.location.hash === PULSE_ROUTE) setPulseOpen(true);
    };
    window.addEventListener('hashchange', openFromAddress);
    return () => window.removeEventListener('hashchange', openFromAddress);
  }, []);
  const closePulse = () => {
    setPulseOpen(false);
    // Leave the address too, or a reload would open the pulse again.
    if (window.location.hash === PULSE_ROUTE) window.history.replaceState(null, '', APP_ROUTE);
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialPanel, setSettingsInitialPanel] = useState<'root' | 'feedback' | 'help'>(
    'root',
  );
  const [settingsViewKey, setSettingsViewKey] = useState(0);
  /**
   * Verify is an action, so it opens the document step for someone who already
   * has a Passport session. Only a first run -- or an explicit replay -- walks
   * the whole explanation again.
   */
  const [journeyStage, setJourneyStage] = useState<OnboardingStage>('welcome');
  const [onboardingRequired, setOnboardingRequired] = useState(initialOnboardingRequired);
  const [policyDetailId, setPolicyDetailId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  // Runtime modes intentionally start without a fixture ID. The v2 catalog below
  // selects the first configured referendum once it has been parsed.
  const [activePollId, setActivePollId] = useState(APP_MODE === 'demo' ? DEFAULT_POLL.id : '');
  const [receipt, setReceipt] = useState<VoteReceipt | null>(null);
  const [receipts, setReceipts] = useState<VoteReceipt[]>([]);
  const [receiptProfileKey, setReceiptProfileKey] = useState('');
  const [credential, setCredential] = useState<DemoCredentialSummary | null>(null);
  const [passportSession, setPassportSession] = useState<CivicPassportSession | null>(null);
  const [passportError, setPassportError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [receiptToastVisible, setReceiptToastVisible] = useState(false);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [theme]);
  const changeTheme = (next: ThemePreference) => {
    persistThemePreference(next);
    setTheme(next);
  };
  const changeLocale = (nextLocale: CicoLocale) => {
    setLocale(nextLocale);
    persistLocale(nextLocale);
  };
  const openSettings = (initialPanel: 'root' | 'feedback' | 'help') => {
    setPulseOpen(false);
    setFlowStage(null);
    setPolicyDetailId(null);
    setSettingsInitialPanel(initialPanel);
    setSettingsViewKey((key) => key + 1);
    setSettingsOpen(true);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = DOCUMENT_TITLE[locale];
  }, [locale]);
  const closeOnboarding = () => {
    window.sessionStorage.setItem(ONBOARDING_SESSION_KEY, '1');
    setOnboardingRequired(false);
    setPassportJourneyOpen(false);
    setTab('consultations');
  };
  const replayOnboarding = () => {
    setPulseOpen(false);
    setFlowStage(null);
    setPolicyDetailId(null);
    setSettingsOpen(false);
    setSettingsInitialPanel('root');
    setJourneyStage('welcome');
    setPassportJourneyOpen(true);
  };
  const openVerification = () => {
    setPulseOpen(false);
    setFlowStage(null);
    setPolicyDetailId(null);
    setJourneyStage(!CHAIN_RUNTIME_ENABLED || passportSession ? 'eligibility' : 'passport');
    setPassportJourneyOpen(true);
  };
  const { status: walletStatus, dustBalance } = useWallet();
  const {
    referendumV2Providers,
    referendumV2ActionContext,
    executionMode,
    setExecutionMode,
    sponsoredAvailable,
    sponsoredError,
    walletlessProving,
    provingParty,
    deviceProofStartedAt,
    isReady,
    error: providersError,
  } = useMidnightProviders();
  const passportSessionPort = useMemo(
    () =>
      new MidnightPassportSessionAdapter({
        bridge: new PassportIdentityBridge({ passportOrigin: PASSPORT_ORIGIN }),
        // The public profile bridge supports these fields, not wallet addresses.
        profileFields: ['displayName', 'passportContract'],
      }),
    [],
  );
  const passportV2Runtime = useMemo(() => {
    if (!CHAIN_RUNTIME_ENABLED) return { config: null, error: null };

    try {
      return {
        config: parsePassportV2RuntimeConfig(
          import.meta.env as unknown as Readonly<Record<string, string | undefined>>,
        ),
        error: null,
      };
    } catch (runtimeError) {
      return {
        config: null,
        error:
          runtimeError instanceof Error
            ? runtimeError.message
            : RUNTIME_COPY[detectLocale('es-AR')].passportConfigInvalid,
      };
    }
  }, []);
  // Built from public values only. It is handed no pass and no session, and
  // only the two values it reads, not the whole environment.
  const assistant = useMemo(
    () =>
      createAppAssistant(
        {
          VITE_ASSISTANT_API_URL: import.meta.env.VITE_ASSISTANT_API_URL,
          VITE_ASSISTANT_SOURCES_JSON: import.meta.env.VITE_ASSISTANT_SOURCES_JSON,
        },
        window.location.origin,
      ),
    [],
  );
  const polls = useMemo(
    () =>
      CHAIN_RUNTIME_ENABLED && passportV2Runtime.config
        ? toRuntimePolls(passportV2Runtime.config.referenda)
        : CHAIN_RUNTIME_ENABLED
          ? []
          : POLLS,
    [passportV2Runtime.config],
  );
  useEffect(() => {
    if ((!activePollId || !polls.some((poll) => poll.id === activePollId)) && polls[0]) {
      setActivePollId(polls[0].id);
    }
  }, [activePollId, polls]);
  // One scope for everything the device keeps about this deployment, so a
  // pass, a sealed answer and its marker never cross into another one.
  const deviceScope = passportV2Runtime.config
    ? `${APP_MODE}:${passportV2Runtime.config.issuerId}:${passportV2Runtime.config.credentialEpoch}`
    : null;
  const ballotVault = useMemo(
    () => (deviceScope ? browserBallotOpeningVault(deviceScope) : null),
    [deviceScope],
  );
  const answerMarkers = useMemo(
    () => (deviceScope ? browserAnswerMarkerStore(deviceScope) : null),
    [deviceScope],
  );
  const passportJourneyPorts = useMemo<PreviewPassportJourneyPorts>(() => {
    const base = { passport: passportSessionPort };
    if (passportV2Runtime.error) {
      return {
        ...base,
        configurationError: passportV2Runtime.error,
        runtimeCatalogConfigured: true,
      };
    }
    if (!passportV2Runtime.config) return { ...base, runtimeCatalogConfigured: false };
    const gateway = new HttpRarimoVerificationGateway({
      baseUrl: passportV2Runtime.config.apiUrl,
    });
    const issuer = new HttpCivicCredentialIssuerPort({
      baseUrl: passportV2Runtime.config.apiUrl,
    });
    const credential = new RarimoCivicCredentialAdapter({
      gateway,
      issuer,
      issuerId: passportV2Runtime.config.issuerId,
      credentialEpoch: passportV2Runtime.config.credentialEpoch,
      credentialTtlMs: passportV2Runtime.config.credentialTtlMs,
      // Time to finish the scan. A first scan includes registering the
      // document in the scanning app, which ten minutes did not always cover.
      enrollmentTtlMs: 30 * 60 * 1_000,
      vault: browserCivicCredentialVault(
        `${APP_MODE}:${passportV2Runtime.config.issuerId}:${passportV2Runtime.config.credentialEpoch}`,
      ),
      // A scan in progress survives the phone dropping this page.
      pendingVault: browserRarimoEnrollmentVault(
        `${APP_MODE}:${passportV2Runtime.config.issuerId}:${passportV2Runtime.config.credentialEpoch}`,
      ),
      countryMapper: rarimoIsoCountryMapper,
      uniquenessTimestampUpperBoundUnixSeconds:
        passportV2Runtime.config.uniquenessTimestampUpperBoundUnixSeconds,
    });
    const actions = referendumV2Providers
      ? new MidnightCivicActionAdapter({
          providers: referendumV2Providers,
          credential,
          referenda: passportV2Runtime.config.referenda,
          ...(referendumV2ActionContext
            ? { actionExecutionContext: referendumV2ActionContext }
            : {}),
          ...(ballotVault ? { ballotOpenings: ballotVault } : {}),
          ...(REGISTRY_HISTORY ? { registryHistory: REGISTRY_HISTORY } : {}),
        })
      : undefined;
    return {
      ...base,
      credential,
      ...(actions ? { actions } : {}),
      referenda: passportV2Runtime.config.referenda,
      runtimeCatalogConfigured: true,
    };
  }, [
    ballotVault,
    passportSessionPort,
    passportV2Runtime,
    referendumV2ActionContext,
    referendumV2Providers,
  ]);
  const runtimeContractAddress = passportV2Runtime.config?.referenda[0]?.contractAddress ?? null;

  /** True while a sealing waits for the person's pass to be admitted. */
  const [admissionWaiting, setAdmissionWaiting] = useState(false);
  const [sealedAnswers, setSealedAnswers] = useState<SealedAnswer[]>([]);
  const [countingId, setCountingId] = useState<string | null>(null);
  const [countNotices, setCountNotices] = useState<Readonly<Record<string, CountNotice>>>({});
  const autoCounted = useRef(new Set<string>());
  const refreshSealedAnswers = useCallback(async () => {
    const referenda = passportV2Runtime.config?.referenda;
    if (!ballotVault || !answerMarkers || !referenda) {
      setSealedAnswers([]);
      return;
    }
    // Only the action adapter can read the ballot tree. Without it, an attempt
    // whose outcome is unknown stays out of the list.
    const actions = passportJourneyPorts.actions as
      | { getSealedAnswerStatus?: (referendumId: string) => Promise<OnChainAnswerStatus> }
      | undefined;
    const readChain = actions?.getSealedAnswerStatus?.bind(actions);
    try {
      setSealedAnswers(
        await listSealedAnswers({
          referendumIds: referenda.map((entry) => entry.referendumId),
          vault: ballotVault,
          markers: answerMarkers,
          ...(readChain ? { resolveOnChain: readChain } : {}),
        }),
      );
    } catch {
      // Storage could not be read. Showing nothing is safer than showing a guess.
      setSealedAnswers([]);
    }
  }, [answerMarkers, ballotVault, passportJourneyPorts.actions, passportV2Runtime.config]);
  useEffect(() => {
    void refreshSealedAnswers();
  }, [refreshSealedAnswers]);
  const countAnswer = useCallback(
    async (referendumId: string) => {
      const actions = passportJourneyPorts.actions;
      const credentialPort = passportJourneyPorts.credential;
      if (!actions || !credentialPort || !answerMarkers) {
        setCountNotices((previous) => ({ ...previous, [referendumId]: 'try-again' }));
        return;
      }
      setCountingId(referendumId);
      try {
        const outcome = await countSealedAnswer({
          referendumId,
          actions,
          credential: credentialPort,
          markers: answerMarkers,
        });
        setCountNotices((previous) => {
          const { [referendumId]: _settled, ...rest } = previous;
          return outcome.state === 'waiting' ? { ...rest, [referendumId]: outcome.reason } : rest;
        });
      } finally {
        setCountingId(null);
        await refreshSealedAnswers();
      }
    },
    [
      answerMarkers,
      passportJourneyPorts.actions,
      passportJourneyPorts.credential,
      refreshSealedAnswers,
    ],
  );
  useEffect(() => {
    // A wallet asks for approval, so the person starts that count. Without a
    // wallet the returning device counts on its own, once per visit.
    if ((provingParty !== 'device' && provingParty !== 'hosted-server') || countingId) return;
    const due = sealedAnswers.find((answer) => {
      if (answer.state !== 'sealed' || autoCounted.current.has(answer.referendumId)) return false;
      const poll = polls.find((item) => item.id === answer.referendumId);
      if (!poll) return false;
      try {
        const availability = getPollAvailability(poll);
        return !availability.isOpen && availability.reason !== 'not-open';
      } catch {
        return false;
      }
    });
    if (!due) return;
    autoCounted.current.add(due.referendumId);
    void countAnswer(due.referendumId);
  }, [countAnswer, countingId, polls, provingParty, sealedAnswers]);
  useEffect(() => {
    let active = true;
    const credentialPort = passportJourneyPorts.credential;
    if (!credentialPort)
      return () => {
        active = false;
      };
    void credentialPort.getCredentialSummary().then((stored) => {
      if (active && stored?.status === 'issued') setCredential(toDisplayCredential(stored));
    });
    return () => {
      active = false;
    };
  }, [passportJourneyPorts.credential]);
  const profileId = useMemo(() => deriveProfileId(passportSession), [passportSession]);
  const previewReadiness = getPreviewReadiness(
    {
      appMode:
        APP_MODE === 'preview' ? 'preview' : APP_MODE === 'undeployed' ? 'undeployed' : 'demo',
      contractAddress: runtimeContractAddress,
      walletConnected: walletStatus === 'connected',
      providersReady: isReady && (!passportV2Runtime.config || referendumV2Providers !== null),
      providersError: providersError ?? passportV2Runtime.error,
      relayerMode: executionMode !== 'direct-wallet',
      walletlessProving: !walletlessProving.offered
        ? 'not-offered'
        : needsHostedConsent(walletlessProving)
          ? 'needs-consent'
          : walletlessProving.error
            ? 'failed'
            : walletlessProving.preparing
              ? 'preparing'
              : 'ready',
      v2RuntimeConfigured: CHAIN_RUNTIME_ENABLED,
      credentialVerified: credential?.kind === 'verified-credential',
    },
    locale,
  );
  useEffect(() => {
    let active = true;
    if (!passportSession) {
      setReceipts([]);
      return () => {
        active = false;
      };
    }
    void deriveReceiptProfileKey(passportSession).then((nextReceiptProfileKey) => {
      setReceiptProfileKey(nextReceiptProfileKey);
      return loadPassportReceipts(nextReceiptProfileKey).then((stored) => {
        if (active) setReceipts(stored);
      });
    });
    return () => {
      active = false;
    };
  }, [passportSession]);
  useEffect(() => {
    if (!receipt) {
      setReceiptToastVisible(false);
      return;
    }
    setReceiptToastVisible(true);
    const timeout = window.setTimeout(() => setReceiptToastVisible(false), 7000);
    return () => window.clearTimeout(timeout);
  }, [receipt]);
  const connectPassport = async () => {
    setPassportError(null);
    if (APP_MODE === 'demo') {
      setPassportSession({
        sessionId: 'local-demo-session',
        origin: window.location.origin,
        network: 'devnet',
        status: 'connected',
        profile: { displayName: 'Ciudadano demo' },
        capabilities: ['session', 'profile'],
      });
      return;
    }
    try {
      const session = await passportSessionPort.connect({
        origin: window.location.origin,
        network: PASSPORT_ACCOUNT_NETWORK,
        requestedCapabilities: ['session', 'profile'],
      });
      setPassportSession(session);
    } catch (error) {
      setPassportError(
        error instanceof Error ? error.message : RUNTIME_COPY[locale].passportConnectFailed,
      );
    }
  };

  const startVote = async (pollId: string) => {
    const poll = polls.find((item) => item.id === pollId);
    if (!poll || !getPollAvailability(poll).isOpen) {
      setPreviewError(RUNTIME_COPY[locale].consultationClosed);
      return;
    }
    if (
      !CHAIN_RUNTIME_ENABLED &&
      credential?.kind === 'synthetic-demo-credential' &&
      !canUseDemoPass(poll, credential)
    ) {
      setPreviewError(
        locale === 'es'
          ? 'Esta consulta requiere un pase de prueba vigente, del país correspondiente y de 18 años o más.'
          : locale === 'fr'
            ? 'Cette consultation exige un pass de test valide, du pays concerné, et un âge de 18 ans ou plus.'
            : 'This consultation requires a current test pass for the matching country and age 18 or older.',
      );
      return;
    }
    setActivePollId(pollId);
    setPolicyDetailId(null);
    setChoice(null);
    setReceipt(null);
    setPreviewError(null);
    if (credential) {
      setFlowStage('choose');
    } else {
      // Eligibility is a Passport-v2 credential journey. Never fall back to a legacy document reader.
      setPassportJourneyOpen(true);
    }
  };

  const confirmVote = async () => {
    if (CHAIN_RUNTIME_ENABLED) {
      if (previewReadiness.state !== 'ready') {
        setPreviewError(previewReadiness.message);
        return;
      }
      const poll = polls.find((item) => item.id === activePollId);
      if (!poll || !getPollAvailability(poll).isOpen) {
        setPreviewError(RUNTIME_COPY[locale].consultationClosed);
        return;
      }
      if (!choice) {
        setPreviewError(RUNTIME_COPY[locale].chooseFirst);
        return;
      }
      setPreviewError(null);
      setFlowStage('processing');
      try {
        if (passportV2Runtime.error) {
          throw new Error(RUNTIME_COPY[locale].runtimeInvalid(passportV2Runtime.error));
        }
        if (passportV2Runtime.config) {
          const referendum = findRuntimeReferendum(
            passportV2Runtime.config.referenda,
            activePollId,
          );
          const actionPort = passportJourneyPorts.actions;
          const credentialPort = passportJourneyPorts.credential;
          const route = resolvePassportV2ActionRoute(
            {
              runtimeConfigured: true,
              credentialVerified: credential?.kind === 'verified-credential',
              actionPortAvailable: Boolean(actionPort && credentialPort),
              referendumId: referendum?.referendumId ?? null,
            },
            locale,
          );
          if (route.mode === 'blocked') throw new Error(route.message);
          if (route.mode !== 'v2' || !actionPort || !credentialPort) {
            throw new Error(RUNTIME_COPY[locale].actionUnavailable);
          }
          const authorization = await credentialPort.getActionAuthorization();
          if (!authorization) {
            throw new Error(RUNTIME_COPY[locale].authorizationMissing);
          }
          if (!ballotVault || (await ballotVault.durability()) === 'memory') {
            throw new Error(SEAL_STORAGE_BLOCKED[locale]);
          }
          // Weeks can pass between sealing and the count. Ask the browser not
          // to evict the opening in the meantime; a refusal is not an error.
          void ballotVault.requestPersistence();
          // A pass issued a moment ago may not be admitted to this consultation
          // yet. The app waits for that itself; the person taps once.
          const askAdmission = actionPort.getPassAdmission?.bind(actionPort);
          const confirmed = await sealWhenAdmitted({
            seal: () =>
              actionPort.castVote({ referendumId: route.referendumId, choice, authorization }),
            ...(askAdmission ? { admission: () => askAdmission(route.referendumId) } : {}),
            onWaiting: setAdmissionWaiting,
          });
          // The sealed answer is tracked by the vault, not by a stored receipt.
          // This one lives for the receipt screen only and names no transaction.
          const nextReceipt: VoteReceipt = {
            id: `sealed:${route.referendumId}`,
            pollId: activePollId,
            createdAt: new Date().toISOString(),
            status: 'confirmed',
            network: confirmed.network,
            sealed: { provingParty: provingParty ?? 'wallet' },
          };
          setReceipt(nextReceipt);
          await refreshSealedAnswers();
          setFlowStage('receipt');
          return;
        }

        throw new Error(RUNTIME_COPY[locale].manifestMissing(APP_NETWORK_LABEL));
      } catch (error) {
        setPreviewError(sealRefusalMessage(error, locale, APP_NETWORK_LABEL));
        // An attempt may have just learned from the chain that an earlier one
        // landed. The answers list should show it at once.
        void refreshSealedAnswers();
        setFlowStage('review');
      }
      return;
    }
    const nextReceipt: VoteReceipt = {
      // One fixed identifier for every simulated vote silently destroyed the
      // previous receipt: receipts are de-duplicated by id, so voting on a
      // second consultation replaced the first one in the profile and the
      // verifier could never find it again. A simulated receipt is still
      // clearly simulated -- it just has to be its own receipt.
      id: `demo-${activePollId}-${Date.now().toString(36)}`,
      pollId: activePollId,
      createdAt: new Date().toISOString(),
      status: 'simulated',
      network: 'local-demo',
    };
    if (passportSession) {
      const receiptProfileKey = await deriveReceiptProfileKey(passportSession);
      await savePassportReceipt(receiptProfileKey, nextReceipt);
    }
    setReceipts((previous) => [
      nextReceipt,
      ...previous.filter((item) => item.id !== nextReceipt.id),
    ]);
    setReceipt(nextReceipt);
    setPreviewError(null);
    setFlowStage('receipt');
  };

  const lockAndDisconnect = async () => {
    setGuideMessages([]);
    setReflectionContext(null);
    await passportSessionPort.disconnect();
    setPassportSession(null);
    setPassportError(null);
  };
  const removeLocalData = async () => {
    window.localStorage.removeItem('midnight-civic-reflection-v1');
    setReflectionContext(null);
    setGuideMessages([]);
    const credentialPort = passportJourneyPorts.credential;
    if (credentialPort) await credentialPort.clearCredential();
    // Removing local data removes sealed answers too. Any that were not yet
    // counted can never be counted; the settings screen says so before this runs.
    if (ballotVault) {
      for (const entry of passportV2Runtime.config?.referenda ?? []) {
        await ballotVault.clear(entry.referendumId);
      }
    }
    answerMarkers?.clear();
    autoCounted.current.clear();
    setSealedAnswers([]);
    setCountNotices({});
    if (receiptProfileKey) await clearPassportReceipts(receiptProfileKey);
    await passportSessionPort.disconnect();
    setCredential(null);
    setReceipts([]);
    setReceipt(null);
    setPassportSession(null);
    setReceiptProfileKey('');
  };

  const openAnswers = () => {
    setTab('you');
    setYouSection('answers');
  };
  const backToYou = <BackToYou onBack={() => setYouSection('hub')} locale={locale} />;
  const currentTabContent =
    tab === 'cleisthenes' ? (
      <CatalogueChat
        reflectionContext={reflectionContext}
        onClearReflection={() => setReflectionContext(null)}
        initialMessages={guideMessages}
        onMessagesChange={setGuideMessages}
        polls={polls}
        briefIds={assistant ? polls.map((poll) => poll.id).filter(assistant.covers) : []}
        locale={locale}
        country={
          canUseCatalogueDialogue(credential, !CHAIN_RUNTIME_ENABLED)
            ? credential?.country
            : undefined
        }
        onOpenPolicy={setPolicyDetailId}
      />
    ) : tab === 'you' && youSection === 'pass' ? (
      <>
        {backToYou}
        <CredentialsView
          credentials={credential ? [credential] : []}
          onVerify={openVerification}
          locale={locale}
        />
      </>
    ) : tab === 'you' && youSection === 'answers' ? (
      <>
        {backToYou}
        <ActivityView
          polls={polls}
          receipts={receipts}
          sealedAnswers={sealedAnswers}
          countingId={countingId}
          countNotices={countNotices}
          onCount={(referendumId) => void countAnswer(referendumId)}
          walletlessProving={walletlessProving}
          deviceProofStartedAt={deviceProofStartedAt}
          locale={locale}
        />
      </>
    ) : tab === 'you' && youSection === 'account' ? (
      <>
        {backToYou}
        <ProfileView
          passportSession={passportSession}
          profileId={profileId}
          walletStatus={walletStatus}
          onConnectPassport={() => void connectPassport()}
          onOpenHelp={() => openSettings('help')}
          onLockAndDisconnect={() => void lockAndDisconnect()}
          onRemoveLocalData={removeLocalData}
          locale={locale}
          onLocaleChange={changeLocale}
          theme={theme}
          onThemeChange={changeTheme}
        />
      </>
    ) : tab === 'you' ? (
      <YouView
        credential={credential}
        passportSession={passportSession}
        sealedAnswers={sealedAnswers}
        receipts={receipts}
        onVerify={openVerification}
        onOpen={setYouSection}
        onOpenSettings={() => openSettings('root')}
        onOpenFeedback={() => openSettings('feedback')}
        locale={locale}
      />
    ) : (
      <VotesView
        polls={polls}
        credential={credential}
        publicContractAddress={runtimeContractAddress}
        onStartVote={startVote}
        onOpenPolicy={setPolicyDetailId}
        onOpenPassportJourney={openVerification}
        locale={locale}
      />
    );
  const selectedPolicy = policyDetailId
    ? (polls.find((poll) => poll.id === policyDetailId) ?? null)
    : null;
  const navigate = (nextTab: Tab) => {
    setPulseOpen(false);
    setSettingsOpen(false);
    setSettingsInitialPanel('root');
    setTab(nextTab);
    // Choosing a destination opens it at its start, `You` at its summary.
    setYouSection('hub');
    setFlowStage(null);
    setPolicyDetailId(null);
    setReceiptToastVisible(false);
  };
  return (
    <div className="app-shell dashboard-v4">
      {/* The mode strip is gone. It sat under the header on every screen
          announcing the network label and a line of mode help, plus a
          <details> the user had to open to learn whether anything was wrong.
          Readiness now surfaces where it is actionable: an unreadable
          contract is a warning in ResultsPanel, and a blocked submission is a
          danger Callout inside the confirm sheet. */}
      {!passportJourneyOpen ? (
        <AppHeader
          passportError={passportError}
          onConnectPassport={() => void connectPassport()}
          onDismissPassportError={() => setPassportError(null)}
          locale={locale}
          onLocaleChange={changeLocale}
        />
      ) : null}
      {passportJourneyOpen ? (
        <PassportJourney
          mode={APP_MODE}
          onClose={closeOnboarding}
          dismissible={!onboardingRequired}
          onCredentialReady={(nextCredential) => setCredential(nextCredential)}
          onPassportConnected={setPassportSession}
          initialStage={journeyStage}
          initialSession={passportSession}
          initialLocale={locale}
          onLocaleChange={changeLocale}
          passportPort={passportSessionPort}
          previewPorts={passportJourneyPorts}
        />
      ) : pulseOpen ? (
        <Suspense
          fallback={
            <main className="runtime-loading" aria-live="polite">
              <p>
                {locale === 'es'
                  ? 'Cargando el pulso cívico…'
                  : locale === 'fr'
                    ? 'Chargement du pouls civique…'
                    : 'Loading the civic pulse…'}
              </p>
            </main>
          }
        >
          <PulseExperience
            onDiscuss={(summary) => {
              setReflectionContext(summary);
              closePulse();
              setTab('cleisthenes');
            }}
            locale={locale}
            embedded
            onExit={closePulse}
            onExploreReferenda={closePulse}
          />
        </Suspense>
      ) : settingsOpen ? (
        <SettingsView
          key={settingsViewKey}
          passportSession={passportSession}
          initialPanel={settingsInitialPanel}
          locale={locale}
          onLocaleChange={changeLocale}
          theme={theme}
          onThemeChange={changeTheme}
          onBack={() => setSettingsOpen(false)}
          onReplayOnboarding={replayOnboarding}
          onLockAndDisconnect={() => void lockAndDisconnect()}
          onRemoveLocalData={removeLocalData}
        />
      ) : flowStage ? (
        (() => {
          const activePoll = polls.find((poll) => poll.id === activePollId);
          if (!activePoll) {
            return (
              <main className="page-content flow-page">
                <section className="flow-card" role="alert">
                  <h1>{RUNTIME_COPY[locale].consultationMissingTitle}</h1>
                  <p>{RUNTIME_COPY[locale].consultationMissingBody}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setFlowStage(null)}
                  >
                    {RUNTIME_COPY[locale].backToConsultations}
                  </button>
                </section>
              </main>
            );
          }
          return (
            <VoteFlow
              poll={activePoll}
              stage={flowStage}
              choice={choice}
              onChoice={setChoice}
              onStage={setFlowStage}
              onClose={() => setFlowStage(null)}
              onConfirm={() => void confirmVote()}
              onViewReceipt={() => {
                setFlowStage(null);
                openAnswers();
              }}
              walletStatus={walletStatus}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              sponsoredAvailable={sponsoredAvailable}
              sponsoredError={sponsoredError}
              walletlessProving={walletlessProving}
              provingParty={provingParty}
              deviceProofStartedAt={deviceProofStartedAt}
              admissionWaiting={admissionWaiting}
              previewError={previewError}
              receipt={receipt}
              dustBalance={dustBalance}
              locale={locale}
            />
          );
        })()
      ) : selectedPolicy ? (
        <PolicyDetailView
          poll={selectedPolicy}
          onBack={() => setPolicyDetailId(null)}
          onStartVote={startVote}
          credential={credential}
          onOpenPassportJourney={() => setPassportJourneyOpen(true)}
          assistant={assistant}
          locale={locale}
        />
      ) : (
        currentTabContent
      )}
      {!passportJourneyOpen && !pulseOpen && !settingsOpen && !flowStage && !selectedPolicy ? (
        <BottomNav
          tab={tab}
          onChange={(nextTab) => {
            setPassportJourneyOpen(false);
            navigate(nextTab);
          }}
          locale={locale}
        />
      ) : null}
      {/* The toast exists so a receipt created in the flow is still reachable
          after the user navigates away. On the receipt screen itself it is a
          second control pointing at the same place as the screen's own primary
          action, so it stays hidden there. */}
      {receipt && receiptToastVisible && flowStage !== 'receipt' ? (
        <div className="receipt-toast" role="status">
          <button
            type="button"
            className="receipt-toast-open"
            onClick={() => {
              setReceiptToastVisible(false);
              setFlowStage(null);
              openAnswers();
            }}
          >
            <CheckCircle size={18} /> {RUNTIME_COPY[locale].receiptReady} <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="receipt-toast-close"
            onClick={() => setReceiptToastVisible(false)}
            aria-label={RUNTIME_COPY[locale].dismissNotice}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CivicRuntime() {
  return (
    <WalletProvider runtimeEnabled={CHAIN_RUNTIME_ENABLED}>
      <MidnightProvidersProvider>
        <CivicApp />
      </MidnightProvidersProvider>
    </WalletProvider>
  );
}
