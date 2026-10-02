import { join, resolve } from 'node:path';
import { deriveRoleKey, padBytes32 } from 'midnight-referendum-api';

/**
 * One referendum this service's root publisher is authorized to admit
 * registry roots into. Mirrors the relevant fields of a `referenda[]` entry
 * from the Passport v2 deployment manifest, so an operator can copy values
 * straight from it into `CICO_REFERENDA_JSON`.
 */
export interface CicoReferendumConfig {
  readonly contractAddress: string;
  readonly eventId: Uint8Array;
  readonly organizerKey: Uint8Array;
  readonly rootPublisherKey: Uint8Array;
  /** The registry root field this referendum was deployed against, as a decimal string source. */
  readonly initialRootField: bigint;
  readonly countryPolicy: string | null;
  readonly minimumAssurance: bigint;
  readonly requireAdult: boolean;
  readonly validityReference: bigint;
  readonly opensAtUnix: bigint;
  readonly enrollmentClosesAtUnix: bigint;
  readonly closesAtUnix: bigint;
  readonly revealClosesAtUnix: bigint;
}

export interface CicoServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly stateDirectory: string;
  readonly rarimoBaseUrl: string;
  readonly rarimoPrivateHeaders: Readonly<Record<string, string>>;
  readonly rarimoProofParamsAllowedOrigins: readonly string[];
  readonly rarimoProofRequestBaseUrl: string;
  readonly issuerIdText: string;
  readonly credentialEpoch: number;
  readonly credentialTtlMs: number;
  readonly maximumIssuanceDelayMs: number;
  /** Narrow authority: can admit voters into a referendum, but cannot close voting or reveal a tally. */
  readonly rootPublisherSecretHex: string;
  /** Referenda this service's root publisher keeps in sync with the registry; empty means no publisher runs. */
  readonly referenda: readonly CicoReferendumConfig[];
  /**
   * Compiled referendum-v2 zk assets. The issuer runtime's own zk config is
   * rooted at the credential registry's artifacts, so proving a referendum
   * circuit through it would fail to find its keys. Required only when
   * referenda are configured.
   */
  readonly referendumZkConfigPath: string | null;
  /**
   * One holder per document: `enforce` refuses a second holder, `observe`
   * records and logs without refusing, `off` keeps no record and lets every
   * verification choose its own event.
   */
  readonly documentUniqueness: 'enforce' | 'observe' | 'off';
  /** Tuning for CredentialRootPublisher; the publisher itself is wired up only where referenda are configured. */
  readonly rootPublisher: {
    readonly minBatchSize: number;
    readonly maxWaitMs: number;
    readonly intervalMs: number;
  };
  readonly actionCapabilities?: {
    readonly secret: string;
    readonly ttlSeconds: number;
    readonly allowedNetworks: readonly string[];
    readonly allowedContracts: readonly string[];
    readonly allowedCircuits: readonly string[];
  };
  readonly issuerRuntime: {
    readonly issuerSeedHex: string;
    readonly issuerRoleSecretHex: string;
    readonly networkId: 'preview';
    readonly indexerHttpUrl: string;
    readonly indexerWsUrl: string;
    readonly proofServerUrl: string;
    readonly approvedProofServerOrigins: readonly string[];
    readonly zkConfigBasePath: string;
    readonly registryContractAddress: string;
    readonly registryId: Uint8Array;
    readonly issuerId: Uint8Array;
    readonly credentialEpoch: bigint;
    readonly relayUrl: string;
    readonly explorerBaseUrl?: string;
    readonly walletStatePath: string;
  };
}

export function loadCicoServiceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CicoServiceConfig {
  const network = optional(env, 'CICO_NETWORK', 'preview');
  if (network !== 'preview') throw new Error('CICO service is Preview-only');
  const issuerIdText = required(env, 'CICO_ISSUER_ID');
  const issuerId = bytes32(required(env, 'CICO_ISSUER_ID_HEX'), 'CICO_ISSUER_ID_HEX');
  if (!equalBytes(padBytes32(issuerIdText), issuerId)) {
    throw new Error('CICO_ISSUER_ID does not match CICO_ISSUER_ID_HEX');
  }
  const credentialEpoch = integer(env, 'CICO_CREDENTIAL_EPOCH', 0, Number.MAX_SAFE_INTEGER);
  const issuerSeedHex = secret(env, 'CICO_ISSUER_WALLET_SEED');
  const issuerRoleSecretHex = secret(env, 'CICO_ISSUER_ROLE_SECRET');
  if (issuerSeedHex === issuerRoleSecretHex) {
    throw new Error('CICO issuer wallet seed and role secret must be independent');
  }
  const rootPublisherSecretHex = secret(env, 'CICO_ROOT_PUBLISHER_SECRET_HEX');
  if (rootPublisherSecretHex === issuerRoleSecretHex) {
    throw new Error(
      'CICO_ROOT_PUBLISHER_SECRET_HEX must be independent of CICO_ISSUER_ROLE_SECRET',
    );
  }
  if (rootPublisherSecretHex === issuerSeedHex) {
    throw new Error(
      'CICO_ROOT_PUBLISHER_SECRET_HEX must be independent of CICO_ISSUER_WALLET_SEED',
    );
  }
  const referenda = parseReferenda(env);
  // A consultation takes a root only from the holder of its root-publisher
  // secret. With another secret every publish would be refused, and nobody
  // with a new pass could answer. Say so at start, not at the first person.
  const rootPublisherKey = deriveRoleKey(
    'cico:ref-v2:root-publisher:',
    bytes32(rootPublisherSecretHex, 'CICO_ROOT_PUBLISHER_SECRET_HEX'),
  );
  for (const referendum of referenda) {
    if (!equalBytes(referendum.rootPublisherKey, rootPublisherKey)) {
      throw new Error(
        `CICO_ROOT_PUBLISHER_SECRET_HEX is not the root publisher of the consultation ${referendum.contractAddress}: ` +
          'the key it derives is not the rootPublisherKeyHex in CICO_REFERENDA_JSON',
      );
    }
  }
  const rarimoBaseUrl = required(env, 'CICO_RARIMO_BASE_URL');
  const verifierOrigin = absoluteHttpUrl(rarimoBaseUrl, 'CICO_RARIMO_BASE_URL').origin;
  const explorerBaseUrl = env.CICO_EXPLORER_BASE_URL?.trim();
  const actionCapabilitySecret = env.CICO_ACTION_CAPABILITY_SECRET?.trim();
  if (actionCapabilitySecret && actionCapabilitySecret.length < 32) {
    throw new Error('CICO_ACTION_CAPABILITY_SECRET must contain at least 32 characters');
  }
  if (
    actionCapabilitySecret &&
    [issuerSeedHex, issuerRoleSecretHex].includes(actionCapabilitySecret)
  ) {
    throw new Error(
      'Action capability, issuer wallet, and issuer role secrets must be independent',
    );
  }
  const stateDirectory = resolve(optional(env, 'CICO_STATE_DIRECTORY', '.cico-state'));
  return {
    host: optional(env, 'CICO_HOST', '127.0.0.1'),
    port: integer(env, 'CICO_PORT', 1, 65_535, 8791),
    allowedOrigins: list(required(env, 'CICO_ALLOWED_ORIGINS')),
    stateDirectory,
    rarimoBaseUrl,
    rarimoPrivateHeaders: stringRecord(env.CICO_RARIMO_PRIVATE_HEADERS_JSON),
    rarimoProofParamsAllowedOrigins: list(
      optional(env, 'CICO_RARIMO_PROOF_PARAMS_ORIGINS', verifierOrigin),
    ),
    rarimoProofRequestBaseUrl: optional(
      env,
      'CICO_RARIMO_PROOF_REQUEST_BASE_URL',
      'https://app.rarime.com/external',
    ),
    issuerIdText,
    credentialEpoch,
    credentialTtlMs: integer(
      env,
      'CICO_CREDENTIAL_TTL_MS',
      1_000,
      30 * 24 * 60 * 60 * 1_000,
      24 * 60 * 60 * 1_000,
    ),
    maximumIssuanceDelayMs: integer(
      env,
      'CICO_MAXIMUM_ISSUANCE_DELAY_MS',
      1_000,
      60 * 60 * 1_000,
      10 * 60 * 1_000,
    ),
    rootPublisherSecretHex,
    documentUniqueness: documentUniqueness(env),
    referendumZkConfigPath:
      referenda.length > 0 ? resolve(required(env, 'CICO_REFERENDUM_ZK_CONFIG_PATH')) : null,
    referenda,
    rootPublisher: {
      minBatchSize: integer(env, 'CICO_ROOT_PUBLISH_MIN_BATCH', 1, 100_000, 16),
      maxWaitMs: integer(
        env,
        'CICO_ROOT_PUBLISH_MAX_WAIT_MS',
        1_000,
        24 * 60 * 60 * 1_000,
        900_000,
      ),
      intervalMs: integer(
        env,
        'CICO_ROOT_PUBLISH_INTERVAL_MS',
        1_000,
        24 * 60 * 60 * 1_000,
        60_000,
      ),
    },
    ...(actionCapabilitySecret
      ? {
          actionCapabilities: {
            secret: actionCapabilitySecret,
            ttlSeconds: integer(env, 'CICO_ACTION_CAPABILITY_TTL_SECONDS', 15, 600, 120),
            allowedNetworks: list(required(env, 'CICO_ACTION_ALLOWED_NETWORKS')),
            allowedContracts: list(required(env, 'CICO_ACTION_ALLOWED_CONTRACTS')),
            allowedCircuits: list(required(env, 'CICO_ACTION_ALLOWED_CIRCUITS')),
          },
        }
      : {}),
    issuerRuntime: {
      issuerSeedHex,
      issuerRoleSecretHex,
      networkId: 'preview',
      indexerHttpUrl: optional(
        env,
        'CICO_INDEXER_HTTP_URL',
        'https://indexer.preview.midnight.network/api/v4/graphql',
      ),
      indexerWsUrl: optional(
        env,
        'CICO_INDEXER_WS_URL',
        'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
      ),
      proofServerUrl: optional(env, 'CICO_PROOF_SERVER_URL', 'http://localhost:6300'),
      approvedProofServerOrigins: list(optional(env, 'CICO_APPROVED_PROOF_ORIGINS', '')),
      zkConfigBasePath: resolve(required(env, 'CICO_ZK_CONFIG_PATH')),
      registryContractAddress: required(env, 'CICO_REGISTRY_CONTRACT_ADDRESS'),
      registryId: bytes32(required(env, 'CICO_REGISTRY_ID_HEX'), 'CICO_REGISTRY_ID_HEX'),
      issuerId,
      credentialEpoch: BigInt(credentialEpoch),
      relayUrl: optional(env, 'CICO_NODE_URL', 'wss://rpc.preview.midnight.network'),
      ...(explorerBaseUrl ? { explorerBaseUrl } : {}),
      // Beside the service's other durable state, so it needs no setting of
      // its own where that directory is already a volume.
      walletStatePath: resolve(
        optional(env, 'CICO_WALLET_STATE_PATH', join(stateDirectory, 'issuer-wallet-state.json')),
      ),
    },
  };
}

function documentUniqueness(
  env: Readonly<Record<string, string | undefined>>,
): 'enforce' | 'observe' | 'off' {
  const value = optional(env, 'CICO_DOCUMENT_UNIQUENESS', 'enforce');
  if (value !== 'enforce' && value !== 'observe' && value !== 'off') {
    throw new Error('CICO_DOCUMENT_UNIQUENESS must be enforce, observe or off');
  }
  return value;
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: string,
): string {
  return env[name]?.trim() || fallback;
}

function secret(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = required(env, name).replace(/^0x/u, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${name} must be 32-byte hexadecimal data`);
  return value;
}

function bytes32(value: string, name: string): Uint8Array {
  const normalized = value.replace(/^0x/u, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`${name} must be 32-byte hexadecimal data`);
  }
  return Uint8Array.from(normalized.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

const UINT64_MAXIMUM = (1n << 64n) - 1n;
const UINT8_MAXIMUM = 255n;

/**
 * Parses and strictly validates `CICO_REFERENDA_JSON`. Fails closed: a
 * malformed entry throws rather than being skipped, because a silently
 * dropped referendum here means people enroll into the registry and then
 * cannot vote in it.
 */
function parseReferenda(
  env: Readonly<Record<string, string | undefined>>,
): readonly CicoReferendumConfig[] {
  const raw = env.CICO_REFERENDA_JSON?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CICO_REFERENDA_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('CICO_REFERENDA_JSON must be a JSON array');
  }
  return parsed.map((entry, index) => parseReferendumEntry(entry, index));
}

function parseReferendumEntry(entry: unknown, index: number): CicoReferendumConfig {
  const label = `CICO_REFERENDA_JSON[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const record = entry as Record<string, unknown>;
  const contractAddress = entryString(record, 'contractAddress', label);
  const eventId = bytes32(entryString(record, 'eventIdHex', label), `${label}.eventIdHex`);
  const organizerKey = bytes32(
    entryString(record, 'organizerKeyHex', label),
    `${label}.organizerKeyHex`,
  );
  const rootPublisherKey = bytes32(
    entryString(record, 'rootPublisherKeyHex', label),
    `${label}.rootPublisherKeyHex`,
  );
  if (equalBytes(rootPublisherKey, organizerKey)) {
    throw new Error(`${label}.rootPublisherKeyHex must not equal organizerKeyHex`);
  }
  const initialRootField = entryDecimal(record, 'initialRootField', label);
  const countryPolicy = entryCountryPolicy(record, label);
  const minimumAssurance = entryDecimal(record, 'minimumAssurance', label, 0n, UINT8_MAXIMUM);
  const requireAdult = entryBoolean(record, 'requireAdult', label);
  const validityReference = entryDecimal(record, 'validityReference', label, 0n, UINT64_MAXIMUM);
  const opensAtUnix = entryDecimal(record, 'opensAtUnix', label, 0n, UINT64_MAXIMUM);
  const enrollmentClosesAtUnix = entryDecimal(
    record,
    'enrollmentClosesAtUnix',
    label,
    0n,
    UINT64_MAXIMUM,
  );
  const closesAtUnix = entryDecimal(record, 'closesAtUnix', label, 0n, UINT64_MAXIMUM);
  const revealClosesAtUnix = entryDecimal(record, 'revealClosesAtUnix', label, 0n, UINT64_MAXIMUM);
  if (opensAtUnix > enrollmentClosesAtUnix || enrollmentClosesAtUnix > closesAtUnix) {
    throw new Error(
      `${label} schedule must satisfy opensAtUnix <= enrollmentClosesAtUnix <= closesAtUnix`,
    );
  }
  if (opensAtUnix >= closesAtUnix) {
    throw new Error(`${label} schedule must satisfy opensAtUnix < closesAtUnix`);
  }
  if (closesAtUnix >= revealClosesAtUnix) {
    throw new Error(`${label} schedule must satisfy closesAtUnix < revealClosesAtUnix`);
  }
  return {
    contractAddress,
    eventId,
    organizerKey,
    rootPublisherKey,
    initialRootField,
    countryPolicy,
    minimumAssurance,
    requireAdult,
    validityReference,
    opensAtUnix,
    enrollmentClosesAtUnix,
    closesAtUnix,
    revealClosesAtUnix,
  };
}

function entryString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function entryBoolean(record: Record<string, unknown>, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${label}.${key} must be a boolean`);
  }
  return value;
}

function entryDecimal(
  record: Record<string, unknown>,
  key: string,
  label: string,
  minimum: bigint = 0n,
  maximum?: bigint,
): bigint {
  const raw = entryString(record, key, label);
  if (!/^[0-9]+$/u.test(raw)) {
    throw new Error(`${label}.${key} must be an unsigned decimal string`);
  }
  const value = BigInt(raw);
  if (value < minimum || (maximum !== undefined && value > maximum)) {
    throw new Error(`${label}.${key} is outside its supported range`);
  }
  return value;
}

function entryCountryPolicy(record: Record<string, unknown>, label: string): string | null {
  if (!('countryPolicy' in record)) {
    throw new Error(`${label}.countryPolicy is required (a string or null)`);
  }
  const value = record.countryPolicy;
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}.countryPolicy must be a string or null`);
  }
  return value.trim();
}

function integer(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number {
  const text = env[name]?.trim();
  const value = text ? Number(text) : fallback;
  if (value === undefined || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside its supported integer range`);
  }
  return value;
}

function list(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringRecord(value: string | undefined): Readonly<Record<string, string>> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('CICO_RARIMO_PRIVATE_HEADERS_JSON must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CICO_RARIMO_PRIVATE_HEADERS_JSON must be a JSON object');
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== 'string' || !key.trim() || !item) {
      throw new Error('CICO_RARIMO_PRIVATE_HEADERS_JSON must contain string values');
    }
    result[key] = item;
  }
  return result;
}

function absoluteHttpUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  return url;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
