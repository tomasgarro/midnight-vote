/// <reference types="vite/client" />

import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

interface ImportMetaEnv {
  readonly VITE_APP_MODE?: string;
  readonly VITE_MIDNIGHT_PREFERRED_WALLET_RDNS?: string;
  readonly VITE_MIDNIGHT_NETWORK?: string;
  readonly VITE_MIDNIGHT_CONTRACT_ADDRESS?: string;
  readonly VITE_MIDNIGHT_PROOF_SERVER_URL?: string;
  readonly VITE_MIDNIGHT_EXPLORER_BASE_URL?: string;
  readonly VITE_MIDNIGHT_INDEXER_URL?: string;
  readonly VITE_MIDNIGHT_INDEXER_WS_URL?: string;
  readonly VITE_PASSPORT_ORIGIN?: string;
  /** Passport account/profile network; separate from the contract runtime network. */
  readonly VITE_PASSPORT_NETWORK?: string;
  /** HTTPS CICO backend exposing browser-safe Passport v2 domain endpoints. */
  readonly VITE_PASSPORT_V2_API_URL?: string;
  readonly VITE_CICO_ISSUER_ID?: string;
  readonly VITE_CICO_CREDENTIAL_EPOCH?: string;
  readonly VITE_CICO_CREDENTIAL_TTL_MS?: string;
  readonly VITE_RARIMO_UNIQUENESS_TIMESTAMP_UPPER_BOUND?: string;
  readonly VITE_CICO_REGISTRY_ADDRESS?: string;
  readonly VITE_CICO_REGISTRY_ID_HEX?: string;
  readonly VITE_CICO_ISSUER_ID_HEX?: string;
  readonly VITE_CICO_FROZEN_ROOT_FIELD?: string;
  /** Public JSON catalog; contains no organizer or issuer private key. */
  readonly VITE_CICO_REFERENDA_JSON?: string;
  /** Set to run the wallet-less sponsored-relayer path. */
  readonly VITE_RELAYER_URL?: string;
  /**
   * HTTPS proving server for browsers without a wallet (ADR-010). It sees the
   * answer while it proves, so the interface asks before using it.
   */
  readonly VITE_HOSTED_PROOF_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    // `@midnight-ntwrk/dapp-connector-api` already augments this on import; the
    // redeclaration keeps `window.midnight` typed project-wide. It must use the
    // SAME index signature as the package (`[key: string]: InitialAPI` â€” no
    // `| undefined` and no extra named keys) or TypeScript raises TS2717.
    // Each wallet is installed under its own key (a UUID); Lace also aliases
    // itself at `mnLace`.
    midnight?: { [key: string]: InitialAPI };
  }
}
