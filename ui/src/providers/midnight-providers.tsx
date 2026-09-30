import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type {
  AppProviders,
  ExecutionMode,
  ReferendumV2DeviceProvingProviderRuntime,
  ReferendumV2HostedProvingProviderRuntime,
  ReferendumV2Providers,
  ReferendumV2SponsoredProviderRuntime,
  WalletlessActionExecutionContext,
} from 'midnight-referendum-api';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useWallet } from '@/hooks/use-wallet';
import { resolveAppMode } from '@/integration/app-mode';
import {
  createWorkerProvingProvider,
  deviceProvingSupported,
  keepScreenAwake,
} from '@/integration/device-prover';
import {
  acceptHostedProving,
  readHostedProvingConsent,
  resolveHostedProofServerUrl,
  withdrawHostedProving,
} from '@/integration/hosted-proving';
import {
  readProverChoice,
  rememberProverChoice,
  resolveDeviceParamsUrl,
  resolveProver,
  type WalletlessProver,
  type WalletlessProvingState,
} from '@/integration/walletless-proving';

type WalletlessRuntime =
  | ReferendumV2DeviceProvingProviderRuntime
  | ReferendumV2HostedProvingProviderRuntime;

interface MidnightProvidersContextValue {
  providers: AppProviders | null;
  /** Indexer-only provider; available without a wallet for public state. */
  publicDataProvider: AppProviders['publicDataProvider'] | null;
  publicReadReady: boolean;
  publicReadError: string | null;
  referendumV2Providers: ReferendumV2Providers | null;
  referendumV2ActionContext: WalletlessActionExecutionContext | null;
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;
  sponsoredAvailable: boolean;
  sponsoredError: string | null;
  walletlessProving: WalletlessProvingState;
  /** Who builds the proof for the active providers; null while there are none. */
  provingParty: 'wallet' | 'device' | 'hosted-server' | null;
  /** When this device started the proof it is building now; null otherwise. */
  deviceProofStartedAt: number | null;
  isReady: boolean;
  error: string | null;
}

const MidnightProvidersContext = createContext<MidnightProvidersContextValue | null>(null);

const APP_MODE = resolveAppMode(import.meta.env.MODE, import.meta.env.VITE_APP_MODE);
const REAL_RUNTIME_ENABLED = APP_MODE === 'preview' || APP_MODE === 'undeployed';
const IS_UNDEPLOYED = APP_MODE === 'undeployed';
/** Set to run the wallet-less sponsored-relayer path. */
const INDEXER_URL =
  import.meta.env.VITE_MIDNIGHT_INDEXER_URL?.trim() ||
  (APP_MODE === 'preview' ? 'https://indexer.preview.midnight.network/api/v4/graphql' : '');
const INDEXER_WS_URL =
  import.meta.env.VITE_MIDNIGHT_INDEXER_WS_URL?.trim() ||
  (APP_MODE === 'preview' ? 'wss://indexer.preview.midnight.network/api/v4/graphql/ws' : '');
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL?.trim() || '';
const CICO_API_URL = import.meta.env.VITE_PASSPORT_V2_API_URL?.trim() || '';
/** Proving without a wallet rides the sponsored relay, so it needs what the relay needs. */
const RELAY_CONFIGURED =
  REAL_RUNTIME_ENABLED && Boolean(RELAYER_URL && CICO_API_URL && INDEXER_URL && INDEXER_WS_URL);
const HOSTED_PROOF_SERVER_URL = resolveHostedProofServerUrl(
  import.meta.env.VITE_HOSTED_PROOF_SERVER_URL,
);
const HOSTED_AVAILABLE = RELAY_CONFIGURED && HOSTED_PROOF_SERVER_URL !== null;
const DEVICE_PROVING_ENABLED = import.meta.env.VITE_DEVICE_PROVING?.trim() !== 'off';

function deviceParamsUrl(): string | null {
  if (!RELAY_CONFIGURED || !DEVICE_PROVING_ENABLED || typeof window === 'undefined') return null;
  if (!deviceProvingSupported()) return null;
  return resolveDeviceParamsUrl(import.meta.env.VITE_DEVICE_PARAMS_URL, window.location.origin);
}

export function MidnightProvidersProvider({ children }: { children: ReactNode }) {
  const { connectedApi, status } = useWallet();
  const [providers, setProviders] = useState<AppProviders | null>(null);
  const [publicDataProvider, setPublicDataProvider] = useState<
    AppProviders['publicDataProvider'] | null
  >(null);
  const [publicReadError, setPublicReadError] = useState<string | null>(null);
  const [directProviders, setDirectProviders] = useState<ReferendumV2Providers | null>(null);
  const [sponsoredRuntime, setSponsoredRuntime] =
    useState<ReferendumV2SponsoredProviderRuntime | null>(null);
  const [walletlessRuntime, setWalletlessRuntime] = useState<WalletlessRuntime | null>(null);
  const [walletlessError, setWalletlessError] = useState<string | null>(null);
  const [proverChoice, setProverChoice] = useState<WalletlessProver | null>(readProverChoice);
  const [hostedAccepted, setHostedAccepted] = useState(
    () => HOSTED_AVAILABLE && readHostedProvingConsent() !== null,
  );
  const [deviceProofStartedAt, setDeviceProofStartedAt] = useState<number | null>(null);
  const [executionMode, setExecutionModeState] = useState<ExecutionMode>('direct-wallet');
  const [sponsoredError, setSponsoredError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paramsUrl = useMemo(deviceParamsUrl, []);
  const deviceAvailable = paramsUrl !== null;
  const selectedProver = resolveProver({
    deviceAvailable,
    hostedAvailable: HOSTED_AVAILABLE,
    choice: proverChoice,
  });

  const setExecutionMode = useCallback(
    (mode: ExecutionMode) => {
      if (mode === 'sponsored-wallet' && !sponsoredRuntime) return;
      // The walletless provers are chosen through their own controls, and the
      // proving server additionally through its disclosure.
      if (mode === 'sponsored-device-proving' || mode === 'sponsored-hosted-proving') return;
      setExecutionModeState(mode);
    },
    [sponsoredRuntime],
  );

  const choose = useCallback((choice: WalletlessProver) => {
    rememberProverChoice(choice);
    setWalletlessError(null);
    setProverChoice(choice);
  }, []);
  const chooseDevice = useCallback(() => choose('device'), [choose]);
  const chooseHosted = useCallback(() => choose('hosted-server'), [choose]);
  const acceptHosted = useCallback(() => {
    if (!HOSTED_AVAILABLE) return;
    acceptHostedProving();
    setWalletlessError(null);
    setHostedAccepted(true);
  }, []);
  const withdrawHosted = useCallback(() => {
    withdrawHostedProving();
    setHostedAccepted(false);
    setWalletlessError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Demo is a hard runtime boundary, not only presentation. Even stale or
    // inherited deployment variables must not activate a wallet, relayer,
    // indexer, or proof-server path in a public synthetic build.
    if (!REAL_RUNTIME_ENABLED) {
      setProviders(null);
      setPublicDataProvider(null);
      setPublicReadError(null);
      setDirectProviders(null);
      setSponsoredRuntime(null);
      setWalletlessRuntime(null);
      setWalletlessError(null);
      setExecutionModeState('direct-wallet');
      setSponsoredError(null);
      setError(null);
      return;
    }

    // Public state is intentionally assembled before wallet/action providers.
    // Reading the indexer must not inherit the wallet's connection state.
    try {
      if (!INDEXER_URL || !INDEXER_WS_URL) {
        throw new Error(
          `${IS_UNDEPLOYED ? 'Undeployed' : 'Preview'} requiere VITE_MIDNIGHT_INDEXER_URL y VITE_MIDNIGHT_INDEXER_WS_URL`,
        );
      }
      setPublicDataProvider(indexerPublicDataProvider(INDEXER_URL, INDEXER_WS_URL));
      setPublicReadError(null);
    } catch (err) {
      setPublicDataProvider(null);
      setPublicReadError(err instanceof Error ? err.message : 'No se pudo preparar el indexer');
    }

    if (status !== 'connected' || !connectedApi) {
      setProviders(null);
      setDirectProviders(null);
      setSponsoredRuntime(null);
      setExecutionModeState('direct-wallet');
      setSponsoredError(null);
      setError(null);
      setWalletlessRuntime(null);

      // Without a wallet the proof is built by this device, or by the proving
      // server once the person has accepted what that server can see.
      const hostedUri = HOSTED_PROOF_SERVER_URL;
      const useDevice = selectedProver === 'device' && paramsUrl !== null;
      const useHosted = selectedProver === 'hosted-server' && hostedAccepted && hostedUri !== null;
      if (!useDevice && !useHosted) return;

      import('midnight-referendum-api')
        .then(async (api) => {
          const relay = {
            relayUrl: RELAYER_URL,
            networkId: IS_UNDEPLOYED ? ('undeployed' as const) : ('preview' as const),
            indexerUri: INDEXER_URL,
            indexerWsUri: INDEXER_WS_URL,
            capabilityIssuer: new api.HttpWalletlessActionCapabilityIssuer({
              baseUrl: CICO_API_URL,
            }),
          };
          let runtime: Awaited<ReturnType<typeof api.createReferendumV2ProviderRuntime>>;
          if (useDevice && paramsUrl !== null) {
            let letScreenSleep: (() => void) | null = null;
            const provingProvider = api.observeDeviceProving(
              createWorkerProvingProvider({
                createWorker: () =>
                  new Worker(new URL('../workers/device-prover.worker.ts', import.meta.url), {
                    type: 'module',
                  }),
                keyMaterial: api.createReferendumV2DeviceKeyMaterial({
                  zkConfigBaseUrl: `${window.location.origin}/managed/referendum-v2`,
                  paramsBaseUrl: paramsUrl,
                }),
              }),
              {
                onStart: () => {
                  setDeviceProofStartedAt(Date.now());
                  void keepScreenAwake().then((release) => {
                    letScreenSleep = release;
                  });
                },
                onFinish: () => {
                  setDeviceProofStartedAt(null);
                  letScreenSleep?.();
                  letScreenSleep = null;
                },
              },
            );
            runtime = await api.createReferendumV2ProviderRuntime({
              mode: 'sponsored-device-proving',
              options: { ...relay, deviceProving: { provingProvider } },
            });
          } else {
            runtime = await api.createReferendumV2ProviderRuntime({
              mode: 'sponsored-hosted-proving',
              options: {
                ...relay,
                hostedProving: { proofServerUri: hostedUri as string, disclosureAccepted: true },
              },
            });
          }
          if (
            runtime.mode !== 'sponsored-device-proving' &&
            runtime.mode !== 'sponsored-hosted-proving'
          ) {
            throw new Error('Walletless composition returned the wrong execution mode');
          }
          if (!cancelled) {
            setWalletlessRuntime(runtime);
            setWalletlessError(null);
          }
        })
        .catch((failure) => {
          if (!cancelled) {
            setWalletlessRuntime(null);
            setWalletlessError(
              failure instanceof Error
                ? failure.message
                : 'Proving without a wallet is unavailable',
            );
          }
        });
      return () => {
        cancelled = true;
      };
    }

    // A wallet always wins: Lace builds the proof on the device.
    setWalletlessRuntime(null);
    setWalletlessError(null);

    import('midnight-referendum-api')
      .then(
        async ({
          createProviders,
          createReferendumV2ProviderRuntime,
          HttpWalletlessActionCapabilityIssuer,
        }) => {
          const [legacy, direct] = await Promise.all([
            createProviders(connectedApi),
            createReferendumV2ProviderRuntime({ mode: 'direct-wallet', api: connectedApi }),
          ]);
          if (!cancelled) {
            setProviders(legacy);
            setDirectProviders(direct.providers);
            setError(null);
          }

          if (!RELAYER_URL || !CICO_API_URL || !INDEXER_URL || !INDEXER_WS_URL) {
            if (!cancelled) {
              setSponsoredRuntime(null);
              setSponsoredError(null);
            }
            return;
          }

          try {
            const sponsored = await createReferendumV2ProviderRuntime({
              mode: 'sponsored-wallet',
              api: connectedApi,
              options: {
                relayUrl: RELAYER_URL,
                networkId: IS_UNDEPLOYED ? 'undeployed' : 'preview',
                indexerUri: INDEXER_URL,
                indexerWsUri: INDEXER_WS_URL,
                capabilityIssuer: new HttpWalletlessActionCapabilityIssuer({
                  baseUrl: CICO_API_URL,
                }),
              },
            });
            if (sponsored.mode !== 'sponsored-wallet') {
              throw new Error('Sponsored provider composition returned the wrong execution mode');
            }
            if (!cancelled) {
              setSponsoredRuntime(sponsored);
              setSponsoredError(null);
            }
          } catch (sponsoredFailure) {
            if (!cancelled) {
              setSponsoredRuntime(null);
              setExecutionModeState('direct-wallet');
              setSponsoredError(
                sponsoredFailure instanceof Error
                  ? sponsoredFailure.message
                  : 'Sponsored voting is unavailable',
              );
            }
          }
        },
      )
      .catch((err) => {
        if (!cancelled) {
          setDirectProviders(null);
          setSponsoredRuntime(null);
          setExecutionModeState('direct-wallet');
          setError(err instanceof Error ? err.message : 'Failed to create providers');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connectedApi, status, selectedProver, hostedAccepted, paramsUrl]);

  const walletConnected = status === 'connected' && connectedApi !== null;
  const walletlessOffered = !walletConnected && selectedProver !== null;
  // The runtime in hand must be the one for the prover now chosen. While a new
  // one is composed, the previous one is not used.
  const walletlessSelected =
    walletlessOffered &&
    walletlessRuntime !== null &&
    walletlessRuntime.provingParty === selectedProver &&
    (selectedProver === 'device' || hostedAccepted);
  const sponsoredSelected =
    !walletlessSelected && executionMode === 'sponsored-wallet' && sponsoredRuntime !== null;
  const referendumV2Providers = walletlessSelected
    ? walletlessRuntime.providers
    : sponsoredSelected
      ? sponsoredRuntime.providers
      : walletConnected
        ? directProviders
        : null;
  const referendumV2ActionContext = walletlessSelected
    ? walletlessRuntime.actionContext
    : sponsoredSelected
      ? sponsoredRuntime.actionContext
      : null;
  const proverUsable =
    walletlessOffered && (selectedProver === 'device' || hostedAccepted) && !walletlessError;

  return (
    <MidnightProvidersContext.Provider
      value={{
        providers,
        publicDataProvider,
        publicReadReady: publicDataProvider !== null,
        publicReadError,
        referendumV2Providers,
        referendumV2ActionContext,
        executionMode: walletlessSelected ? walletlessRuntime.mode : executionMode,
        setExecutionMode,
        sponsoredAvailable: sponsoredRuntime !== null,
        sponsoredError,
        walletlessProving: {
          offered: walletlessOffered,
          deviceAvailable: !walletConnected && deviceAvailable,
          hostedAvailable: !walletConnected && HOSTED_AVAILABLE,
          selected: walletConnected ? null : selectedProver,
          hostedAccepted: !walletConnected && hostedAccepted,
          preparing: proverUsable && !walletlessSelected,
          error: walletlessOffered ? walletlessError : null,
          chooseDevice,
          chooseHosted,
          acceptHosted,
          withdrawHosted,
        },
        provingParty: walletlessSelected
          ? walletlessRuntime.provingParty
          : referendumV2Providers !== null
            ? 'wallet'
            : null,
        deviceProofStartedAt,
        isReady: referendumV2Providers !== null,
        error,
      }}
    >
      {children}
    </MidnightProvidersContext.Provider>
  );
}

export function useMidnightProviders(): MidnightProvidersContextValue {
  const context = useContext(MidnightProvidersContext);
  if (!context) {
    throw new Error('useMidnightProviders must be used within a MidnightProvidersProvider');
  }
  return context;
}
