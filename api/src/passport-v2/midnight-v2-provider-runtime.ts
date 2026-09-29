import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { ReferendumV2Providers } from './midnight-v2-executors.js';
import {
  createReferendumV2WalletProviders,
  type ReferendumV2WalletProviderOptions,
} from './midnight-v2-providers.js';
import {
  createReferendumV2WalletlessProviders,
  type HostedProvingOptions,
  type ReferendumV2WalletlessProviderOptions,
  type ReferendumV2WalletlessRuntime,
} from './midnight-v2-relayer-providers.js';

/** The only execution modes supported by the Passport-v2 action boundary. */
export const REFERENDUM_V2_EXECUTION_MODES = [
  'direct-wallet',
  'sponsored-wallet',
  'sponsored-hosted-proving',
] as const;

export type ExecutionMode = (typeof REFERENDUM_V2_EXECUTION_MODES)[number];

/**
 * Deliberately browser-safe direct-wallet options. A proof-server URI is not
 * part of this public composition API: proving is delegated to Lace.
 */
export type ReferendumV2DirectWalletOptions = Omit<
  ReferendumV2WalletProviderOptions,
  'proofServerUri'
>;

/**
 * Deliberately browser-safe sponsored-wallet options. The lower-level
 * walletless factory still exposes its Node proof-server escape hatch for
 * operator scripts, but it cannot be selected through this browser-facing
 * composition API.
 */
export type ReferendumV2SponsoredWalletOptions = Omit<
  ReferendumV2WalletlessProviderOptions,
  'api' | 'proofServerUri' | 'zkConfigProvider'
>;

/**
 * Options for a browser with no wallet. There is no `api` and no free-form
 * proof-server field: the proving server arrives only inside `hostedProving`,
 * next to the disclosure flag (ADR-010).
 */
export type ReferendumV2HostedProvingOptions = Omit<
  ReferendumV2WalletlessProviderOptions,
  'api' | 'proofServerUri' | 'zkConfigProvider' | 'hostedProving'
> & { readonly hostedProving: HostedProvingOptions };

export interface ReferendumV2DirectProviderRuntime {
  readonly mode: 'direct-wallet';
  readonly providers: ReferendumV2Providers;
}

export interface ReferendumV2SponsoredProviderRuntime
  extends Pick<ReferendumV2WalletlessRuntime, 'actionContext' | 'getLastActionTrace'> {
  readonly mode: 'sponsored-wallet';
  readonly providers: ReferendumV2Providers;
}

export interface ReferendumV2HostedProvingProviderRuntime
  extends Pick<ReferendumV2WalletlessRuntime, 'actionContext' | 'getLastActionTrace'> {
  readonly mode: 'sponsored-hosted-proving';
  readonly providers: ReferendumV2Providers;
  /** Always `hosted-server`; present so the interface can name who proves. */
  readonly provingParty: 'hosted-server';
}

export type ReferendumV2ProviderRuntime =
  | ReferendumV2DirectProviderRuntime
  | ReferendumV2SponsoredProviderRuntime
  | ReferendumV2HostedProvingProviderRuntime;

export type ReferendumV2ProviderRuntimeOptions =
  | {
      readonly mode: 'direct-wallet';
      readonly api: ConnectedAPI;
      readonly options?: ReferendumV2DirectWalletOptions;
    }
  | {
      readonly mode: 'sponsored-wallet';
      readonly api: ConnectedAPI;
      readonly options: ReferendumV2SponsoredWalletOptions;
    }
  | {
      readonly mode: 'sponsored-hosted-proving';
      readonly options: ReferendumV2HostedProvingOptions;
    };

/**
 * Compose the approved Passport-v2 execution modes.
 *
 * The two wallet modes require a connected Lace API and obtain the proving
 * provider from Lace. Sponsored mode uses the relay only for the already
 * proved transaction's fee funding, submission, and canonical receipt; its
 * relay options intentionally have no browser proof-server field.
 *
 * `sponsored-hosted-proving` exists for browsers without a wallet. It sends the
 * witness to the operator's proving server and therefore requires the
 * disclosure flag; see ADR-010 for what that server can see.
 */
export async function createReferendumV2ProviderRuntime(
  options: ReferendumV2ProviderRuntimeOptions,
): Promise<ReferendumV2ProviderRuntime> {
  if (options.mode === 'direct-wallet') {
    return {
      mode: options.mode,
      providers: await createReferendumV2WalletProviders(options.api, options.options),
    };
  }

  if (options.mode === 'sponsored-hosted-proving') {
    const hostedRuntime = await createReferendumV2WalletlessProviders(options.options);
    if (hostedRuntime.provingParty !== 'hosted-server') {
      throw new Error('Hosted proving composition returned a different proving party');
    }
    return {
      mode: options.mode,
      providers: hostedRuntime.providers,
      provingParty: hostedRuntime.provingParty,
      actionContext: hostedRuntime.actionContext,
      getLastActionTrace: hostedRuntime.getLastActionTrace,
    };
  }

  const runtime = await createReferendumV2WalletlessProviders({
    ...options.options,
    api: options.api,
  });
  return {
    mode: options.mode,
    providers: runtime.providers,
    actionContext: runtime.actionContext,
    getLastActionTrace: runtime.getLastActionTrace,
  };
}
