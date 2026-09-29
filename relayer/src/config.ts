/**
 * Relayer configuration.
 *
 * The seed is read from the environment and never logged, never returned by
 * an endpoint, and never written to disk by this process. Everything else
 * here is public infrastructure detail.
 */

import { isCitizenCircuit } from './v2-types.js';

/** The longest delay an operator may configure before a submission. */
const MAX_SUBMIT_DELAY_MS = 60_000;

export interface RelayerConfig {
  seedHex: string;
  networkId: string;
  indexerHttpUrl: string;
  indexerWsUrl: string;
  relayUrl: string;
  provingServerUrl: string;
  host: string;
  port: number;
  /** Exact browser origins allowed to call the relayer. Never "*". */
  allowedOrigins: string[];
  /** Optional service-to-service bearer token; capabilities remain mandatory. */
  v2AuthToken: string;
  /** HMAC secret used to validate short-lived one-time action capabilities. */
  v2CapabilitySecret: string;
  v2AllowedNetworks: string[];
  v2AllowedContracts: string[];
  v2AllowedCircuits: string[];
  /**
   * Upper bound of the random wait before an accepted action is submitted.
   * Zero submits at once.
   */
  v2SubmitDelayMaxMs: number;
  /** Production uses PostgreSQL; file path is for local/test adapter only. */
  v2DatabaseUrl: string;
  v2JobStorePath: string;
  v2ExplorerBaseUrl: string;
  /** Compatibility-only v1 transaction routes. Disabled unless explicitly opted in. */
  legacyApiEnabled: boolean;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Copy relayer/.env.example to relayer/.env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function list(name: string, fallback: string): string[] {
  return optional(name, fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function boolean(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

export function loadConfig(): RelayerConfig {
  const seedHex = required('RELAYER_SEED').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(seedHex)) {
    // Fail on shape alone; the value itself must never reach a log line.
    throw new Error('RELAYER_SEED must be 64 hexadecimal characters (32 bytes).');
  }

  const v2AllowedCircuits = list('RELAYER_V2_ALLOWED_CIRCUITS', 'castVote');
  if (
    v2AllowedCircuits.length === 0 ||
    new Set(v2AllowedCircuits).size !== v2AllowedCircuits.length ||
    !v2AllowedCircuits.every(isCitizenCircuit)
  ) {
    throw new Error(
      'The public v2 relayer may allow only the citizen circuits castVote and revealVote.',
    );
  }

  const submitDelay = optional('RELAYER_V2_SUBMIT_DELAY_MAX_MS', '0');
  const v2SubmitDelayMaxMs = Number(submitDelay);
  if (
    !/^\d+$/u.test(submitDelay) ||
    !Number.isSafeInteger(v2SubmitDelayMaxMs) ||
    v2SubmitDelayMaxMs > MAX_SUBMIT_DELAY_MS
  ) {
    throw new Error(
      `RELAYER_V2_SUBMIT_DELAY_MAX_MS must be a whole number from 0 to ${MAX_SUBMIT_DELAY_MS}.`,
    );
  }

  return {
    seedHex,
    networkId: optional('RELAYER_NETWORK_ID', 'preview'),
    indexerHttpUrl: optional(
      'RELAYER_INDEXER_HTTP_URL',
      'https://indexer.preview.midnight.network/api/v4/graphql',
    ),
    indexerWsUrl: optional(
      'RELAYER_INDEXER_WS_URL',
      'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    ),
    relayUrl: optional('RELAYER_NODE_URL', 'wss://rpc.preview.midnight.network'),
    provingServerUrl: optional('RELAYER_PROOF_SERVER_URL', 'http://localhost:6300'),
    host: optional('RELAYER_HOST', '127.0.0.1'),
    port: Number.parseInt(optional('RELAYER_PORT', '8790'), 10),
    allowedOrigins: optional('RELAYER_ALLOWED_ORIGINS', 'http://localhost:4173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    v2AuthToken: optional('RELAYER_V2_AUTH_TOKEN', ''),
    v2CapabilitySecret: optional('RELAYER_V2_CAPABILITY_SECRET', ''),
    v2AllowedNetworks: list('RELAYER_V2_ALLOWED_NETWORKS', 'preview'),
    v2AllowedContracts: list('RELAYER_V2_ALLOWED_CONTRACTS', ''),
    v2AllowedCircuits,
    v2SubmitDelayMaxMs,
    v2DatabaseUrl: optional('RELAYER_V2_DATABASE_URL', ''),
    v2JobStorePath: optional('RELAYER_V2_JOB_STORE_PATH', '.state/v2-actions.json'),
    v2ExplorerBaseUrl: optional('RELAYER_EXPLORER_BASE_URL', ''),
    legacyApiEnabled: boolean('RELAYER_LEGACY_API_ENABLED'),
  };
}
