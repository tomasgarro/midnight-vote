import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type {
  AppProviders,
  ExecutionMode,
  ReferendumV2HostedProvingProviderRuntime,
  ReferendumV2Providers,
  ReferendumV2SponsoredProviderRuntime,
  WalletlessActionExecutionContext,
} from 'midnight-referendum-api';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useWallet } from '@/hooks/use-wallet';
import { resolveAppMode } from '@/integration/app-mode';
import {
  acceptHostedProving,
  readHostedProvingConsent,
  resolveHostedProofServerUrl,
  withdrawHostedProving,
} from '@/integration/hosted-proving';

/**
 * Hosted proving (ADR-010), as the interface sees it. `offered` means this
 * build has a proving server and no wallet is connected, so the person can be
 * asked. Nothing is sent to that server before `accept` is called.
 */
export interface HostedProvingState {
  readonly offered: boolean;
  readonly accepted: boolean;
  /** Accepted, and the runtime is still being composed. */
  readonly preparing: boolean;
  readonly error: string | null;
  readonly accept: () => void;
  readonly withdraw: () => void;
}

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
  hostedProving: HostedProvingState;
  /** Who builds the proof for the active providers; null while there are none. */
  provingParty: 'wallet' | 'hosted-server' | null;
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
const HOSTED_PROOF_SERVER_URL = resolveHostedProofServerUrl(
  import.meta.env.VITE_HOSTED_PROOF_SERVER_URL,
);
/** Hosted proving rides the sponsored relay, so it needs everything the relay needs. */
const HOSTED_PROVING_CONFIGURED =
  REAL_RUNTIME_ENABLED &&
  HOSTED_PROOF_SERVER_URL !== null &&
  Boolean(RELAYER_URL && CICO_API_URL && INDEXER_URL && INDEXER_WS_URL);

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
  const [hostedRuntime, setHostedRuntime] =
    useState<ReferendumV2HostedProvingProviderRuntime | null>(null);
  const [hostedAccepted, setHostedAccepted] = useState(
    () => HOSTED_PROVING_CONFIGURED && readHostedProvingConsent() !== null,
  );
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [executionMode, setExecutionModeState] = useState<ExecutionMode>('direct-wallet');
  const [sponsoredError, setSponsoredError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setExecutionMode = useCallback(
    (mode: ExecutionMode) => {
      if (mode === 'sponsored-wallet' && !sponsoredRuntime) return;
      // Hosted proving is entered through its disclosure, never through a mode switch.
      if (mode === 'sponsored-hosted-proving') return;
      setExecutionModeState(mode);
    },
    [sponsoredRuntime],
  );

  const acceptHosted = useCallback(() => {
    if (!HOSTED_PROVING_CONFIGURED) return;
    acceptHostedProving();
    setHostedError(null);
    setHostedAccepted(true);
  }, []);

  const withdrawHosted = useCallback(() => {
    withdrawHostedProving();
    setHostedAccepted(false);
    setHostedRuntime(null);
    setHostedError(null);
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
      setHostedRuntime(null);
      setHostedError(null);
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

      // Without a wallet the only way to build a proof is the hosted server,
      // and only once the person has accepted what that server can see.
      if (!HOSTED_PROVING_CONFIGURED || HOSTED_PROOF_SERVER_URL === null || !hostedAccepted) {
        setHostedRuntime(null);
        return;
      }
      const proofServerUri = HOSTED_PROOF_SERVER_URL;
      import('midnight-referendum-api')
        .then(
          async ({ createReferendumV2ProviderRuntime, HttpWalletlessActionCapabilityIssuer }) => {
            const hosted = await createReferendumV2ProviderRuntime({
              mode: 'sponsored-hosted-proving',
              options: {
                relayUrl: RELAYER_URL,
                networkId: IS_UNDEPLOYED ? 'undeployed' : 'preview',
                indexerUri: INDEXER_URL,
                indexerWsUri: INDEXER_WS_URL,
                capabilityIssuer: new HttpWalletlessActionCapabilityIssuer({
                  baseUrl: CICO_API_URL,
                }),
                hostedProving: { proofServerUri, disclosureAccepted: true },
              },
            });
            if (hosted.mode !== 'sponsored-hosted-proving') {
              throw new Error('Hosted proving composition returned the wrong execution mode');
            }
            if (!cancelled) {
              setHostedRuntime(hosted);
              setHostedError(null);
            }
          },
        )
        .catch((hostedFailure) => {
          if (!cancelled) {
            setHostedRuntime(null);
            setHostedError(
              hostedFailure instanceof Error
                ? hostedFailure.message
                : 'Hosted proving is unavailable',
            );
          }
        });
      return () => {
        cancelled = true;
      };
    }

    // A wallet always wins: the proof is built on the device.
    setHostedRuntime(null);
    setHostedError(null);

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
  }, [connectedApi, status, hostedAccepted]);

  const walletConnected = status === 'connected' && connectedApi !== null;
  const hostedSelected = !walletConnected && hostedRuntime !== null;
  const sponsoredSelected =
    !hostedSelected && executionMode === 'sponsored-wallet' && sponsoredRuntime !== null;
  const referendumV2Providers = hostedSelected
    ? hostedRuntime.providers
    : sponsoredSelected
      ? sponsoredRuntime.providers
      : directProviders;
  const referendumV2ActionContext = hostedSelected
    ? hostedRuntime.actionContext
    : sponsoredSelected
      ? sponsoredRuntime.actionContext
      : null;
  const hostedOffered = HOSTED_PROVING_CONFIGURED && !walletConnected;

  return (
    <MidnightProvidersContext.Provider
      value={{
        providers,
        publicDataProvider,
        publicReadReady: publicDataProvider !== null,
        publicReadError,
        referendumV2Providers,
        referendumV2ActionContext,
        executionMode: hostedSelected ? 'sponsored-hosted-proving' : executionMode,
        setExecutionMode,
        sponsoredAvailable: sponsoredRuntime !== null,
        sponsoredError,
        hostedProving: {
          offered: hostedOffered,
          accepted: hostedOffered && hostedAccepted,
          preparing: hostedOffered && hostedAccepted && hostedRuntime === null && !hostedError,
          error: hostedOffered ? hostedError : null,
          accept: acceptHosted,
          withdraw: withdrawHosted,
        },
        provingParty: hostedSelected
          ? 'hosted-server'
          : referendumV2Providers !== null
            ? 'wallet'
            : null,
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
