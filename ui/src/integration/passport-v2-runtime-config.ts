import {
  deriveRegistryContractBinding,
  type FrozenCredentialRegistryReference,
  padBytes32,
  type ReferendumV2CatalogEntry,
} from 'midnight-referendum-api';

export interface PassportV2RuntimeConfig {
  readonly network: 'undeployed' | 'preview';
  readonly apiUrl: string;
  readonly issuerId: string;
  readonly credentialEpoch: number;
  readonly credentialTtlMs: number;
  readonly uniquenessTimestampUpperBoundUnixSeconds: number;
  readonly registry: FrozenCredentialRegistryReference;
  readonly referenda: readonly PassportV2RuntimeReferendum[];
}

/** Runtime-only presentation fields; contract/action semantics remain unchanged. */
export type PassportV2RuntimeReferendum = ReferendumV2CatalogEntry & {
  readonly title: string;
  readonly question: string;
  readonly description?: string;
  /** Optional editorial/lifecycle metadata supplied by the public catalog. */
  readonly opened?: string;
  readonly deadline?: string;
  readonly opensAt?: string;
  readonly closesAt?: string;
  readonly eligible?: string;
  readonly participation?: string;
  /** The same consultation in other languages. The top-level text is the fallback. */
  readonly translations?: ReferendumTranslations;
};

/** What a catalogue may say about a consultation in one language. */
export interface ReferendumText {
  readonly title?: string;
  readonly question?: string;
  readonly description?: string;
}
export type ReferendumTranslations = Partial<Record<'es' | 'en' | 'fr', ReferendumText>>;

interface ReferendumWireEntry {
  readonly referendumId?: unknown;
  readonly contractAddress?: unknown;
  readonly eventIdHex?: unknown;
  readonly organizerKeyHex?: unknown;
  /** Narrow authority that admits later registry roots; never the organizer. */
  readonly rootPublisherKeyHex?: unknown;
  /** The registry root this consultation was deployed against, as a decimal string. */
  readonly initialRootField?: unknown;
  /** On-chain enforced schedule, as decimal unix-second strings. */
  readonly opensAtUnix?: unknown;
  readonly enrollmentClosesAtUnix?: unknown;
  readonly closesAtUnix?: unknown;
  readonly revealClosesAtUnix?: unknown;
  readonly countryPolicy?: unknown;
  readonly minimumAssurance?: unknown;
  readonly requireAdult?: unknown;
  readonly validityReference?: unknown;
  readonly title?: unknown;
  readonly question?: unknown;
  readonly description?: unknown;
  readonly opened?: unknown;
  readonly deadline?: unknown;
  readonly opensAt?: unknown;
  readonly closesAt?: unknown;
  readonly eligible?: unknown;
  readonly participation?: unknown;
  readonly translations?: unknown;
}

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

/** What names a registry, apart from the root a consultation pins. */
type RegistryIdentity = Omit<FrozenCredentialRegistryReference, 'frozenRoot'>;

/** Returns null when Passport v2 is intentionally disabled; partial config fails closed. */
export function parsePassportV2RuntimeConfig(env: RuntimeEnv): PassportV2RuntimeConfig | null {
  const apiUrl = env.VITE_PASSPORT_V2_API_URL?.trim();
  if (!apiUrl) return null;
  const network = env.VITE_MIDNIGHT_NETWORK?.trim() || 'preview';
  if (network !== 'preview' && network !== 'undeployed') {
    throw new TypeError('Passport v2 runtime requires the Preview or Undeployed network');
  }

  const issuerId = required(env, 'VITE_CICO_ISSUER_ID');
  const credentialEpoch = unsignedNumber(required(env, 'VITE_CICO_CREDENTIAL_EPOCH'), 64);
  const credentialTtlMs = unsignedNumber(required(env, 'VITE_CICO_CREDENTIAL_TTL_MS'), 53);
  if (credentialTtlMs < 1_000 || credentialTtlMs > 30 * 24 * 60 * 60 * 1_000) {
    throw new TypeError('VITE_CICO_CREDENTIAL_TTL_MS is outside the supported range');
  }
  const uniquenessTimestampUpperBoundUnixSeconds = unsignedNumber(
    required(env, 'VITE_RARIMO_UNIQUENESS_TIMESTAMP_UPPER_BOUND'),
    64,
  );
  const registryContractAddress = required(env, 'VITE_CICO_REGISTRY_ADDRESS');
  const registryIdentity: RegistryIdentity = {
    registryContractAddress,
    registryContractBinding: deriveRegistryContractBinding(registryContractAddress),
    registryId: bytes32(required(env, 'VITE_CICO_REGISTRY_ID_HEX'), 'registry ID'),
    issuerId: bytes32(required(env, 'VITE_CICO_ISSUER_ID_HEX'), 'issuer ID'),
    credentialEpoch: BigInt(credentialEpoch),
  };
  if (!equalBytes(registryIdentity.issuerId, padBytes32(issuerId))) {
    throw new TypeError('CICO issuer text does not match the frozen registry issuer ID');
  }
  // A frozen registry has one root, pinned by every consultation. A registry
  // that keeps enrolling has none: each consultation is pinned to the root it
  // was deployed against, which the catalogue carries as `initialRootField`.
  const enrollmentModel = env.VITE_CICO_ENROLLMENT_MODEL?.trim() || 'frozen';
  if (enrollmentModel !== 'frozen' && enrollmentModel !== 'open') {
    throw new TypeError('VITE_CICO_ENROLLMENT_MODEL must be frozen or open');
  }
  const frozenRootField = env.VITE_CICO_FROZEN_ROOT_FIELD?.trim();
  if (enrollmentModel === 'open' && frozenRootField) {
    throw new TypeError(
      'An open registry has no frozen root; leave VITE_CICO_FROZEN_ROOT_FIELD empty',
    );
  }
  const frozenRoot =
    enrollmentModel === 'frozen'
      ? { field: unsignedBigInt(required(env, 'VITE_CICO_FROZEN_ROOT_FIELD'), 256) }
      : null;

  let wire: unknown;
  try {
    wire = JSON.parse(required(env, 'VITE_CICO_REFERENDA_JSON'));
  } catch {
    throw new TypeError('VITE_CICO_REFERENDA_JSON must be valid JSON');
  }
  if (!Array.isArray(wire) || wire.length === 0) {
    throw new TypeError('At least one v2 referendum must be configured');
  }
  const referenda = wire.map((candidate, index) =>
    parseReferendum(candidate, index, registryIdentity, frozenRoot, network),
  );
  if (new Set(referenda.map((entry) => entry.referendumId)).size !== referenda.length) {
    throw new TypeError('V2 referendum IDs must be unique');
  }
  // The array is not empty, so the first entry exists. With an open registry
  // this carries the first consultation's root; each consultation's own
  // reference is in its `config.registry`.
  const registry = (referenda[0] as PassportV2RuntimeReferendum).config.registry;

  return {
    network,
    apiUrl,
    issuerId,
    credentialEpoch,
    credentialTtlMs,
    uniquenessTimestampUpperBoundUnixSeconds,
    registry,
    referenda,
  };
}

function parseReferendum(
  value: unknown,
  index: number,
  registryIdentity: RegistryIdentity,
  frozenRoot: FrozenCredentialRegistryReference['frozenRoot'] | null,
  network: PassportV2RuntimeConfig['network'],
): PassportV2RuntimeReferendum {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Referendum ${index} must be an object`);
  }
  const entry = value as ReferendumWireEntry;
  let pinnedRoot = frozenRoot;
  if (!pinnedRoot) {
    try {
      pinnedRoot = { field: unsignedBigInt(entry.initialRootField, 256) };
    } catch {
      throw new TypeError(
        `Referendum ${index} needs initialRootField: its registry keeps enrolling`,
      );
    }
  }
  const registry: FrozenCredentialRegistryReference = {
    ...registryIdentity,
    frozenRoot: pinnedRoot,
  };
  const referendumId = nonEmptyString(entry.referendumId, `referendum ${index} ID`);
  const contractAddress = nonEmptyString(entry.contractAddress, `referendum ${index} address`);
  const countryPolicy =
    entry.countryPolicy === null
      ? new Uint8Array(32)
      : padBytes32(nonEmptyString(entry.countryPolicy, `referendum ${index} country policy`));
  const minimumAssurance = unsignedBigInt(entry.minimumAssurance, 8);
  if (typeof entry.requireAdult !== 'boolean') {
    throw new TypeError(`Referendum ${index} requireAdult must be boolean`);
  }
  const opensAt = optionalText(entry.opensAt);
  const closesAt = optionalText(entry.closesAt);
  if (Boolean(opensAt) !== Boolean(closesAt)) {
    throw new TypeError(`Referendum ${index} must configure both opensAt and closesAt`);
  }
  if (opensAt && closesAt) {
    const openTime = Date.parse(opensAt);
    const closeTime = Date.parse(closesAt);
    if (!Number.isFinite(openTime) || !Number.isFinite(closeTime) || closeTime <= openTime) {
      throw new TypeError(`Referendum ${index} lifecycle dates are invalid`);
    }
  }
  return {
    referendumId,
    contractAddress,
    title: nonEmptyString(entry.title, `referendum ${index} title`),
    question: nonEmptyString(entry.question, `referendum ${index} question`),
    ...(optionalText(entry.description) ? { description: optionalText(entry.description) } : {}),
    ...(optionalText(entry.opened) ? { opened: optionalText(entry.opened) } : {}),
    ...(optionalText(entry.deadline) ? { deadline: optionalText(entry.deadline) } : {}),
    ...(opensAt && closesAt ? { opensAt, closesAt } : {}),
    ...(optionalText(entry.eligible) ? { eligible: optionalText(entry.eligible) } : {}),
    ...(optionalText(entry.participation)
      ? { participation: optionalText(entry.participation) }
      : {}),
    ...translations(entry.translations, index),
    config: {
      registry,
      eventId: bytes32(entry.eventIdHex, `referendum ${index} event ID`),
      organizerKey: bytes32(entry.organizerKeyHex, `referendum ${index} organizer key`),
      rootPublisherKey: bytes32(
        entry.rootPublisherKeyHex,
        `referendum ${index} root publisher key`,
      ),
      opensAtUnix: unsignedBigInt(entry.opensAtUnix, 64),
      enrollmentClosesAtUnix: unsignedBigInt(entry.enrollmentClosesAtUnix, 64),
      closesAtUnix: unsignedBigInt(entry.closesAtUnix, 64),
      revealClosesAtUnix: unsignedBigInt(entry.revealClosesAtUnix, 64),
      countryPolicy,
      countryPolicyEnabled: entry.countryPolicy !== null,
      minimumAssurance,
      requireAdult: entry.requireAdult,
      validityReference: unsignedBigInt(entry.validityReference, 64),
      network,
      ...(network === 'preview'
        ? { explorerBaseUrl: 'https://explorer.preview.midnight.network/tx' }
        : {}),
    },
  };
}

/**
 * Text is the only thing a translation may carry. A translation cannot change
 * a consultation's identity, its schedule or its rule, so nothing else is read.
 */
function translations(
  value: unknown,
  index: number,
): { readonly translations?: ReferendumTranslations } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Referendum ${index} translations must be an object`);
  }
  const result: { es?: ReferendumText; en?: ReferendumText; fr?: ReferendumText } = {};
  for (const locale of ['es', 'en', 'fr'] as const) {
    const text = (value as Record<string, unknown>)[locale];
    if (text === undefined) continue;
    if (!text || typeof text !== 'object' || Array.isArray(text)) {
      throw new TypeError(`Referendum ${index} ${locale} translation must be an object`);
    }
    const { title, question, description } = text as Record<string, unknown>;
    const parsed = {
      ...(optionalText(title) ? { title: optionalText(title) } : {}),
      ...(optionalText(question) ? { question: optionalText(question) } : {}),
      ...(optionalText(description) ? { description: optionalText(description) } : {}),
    };
    if (Object.keys(parsed).length > 0) result[locale] = parsed;
  }
  return Object.keys(result).length > 0 ? { translations: result } : {};
}

function required(env: RuntimeEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new TypeError(`${key} is required when Passport v2 is enabled`);
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function bytes32(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-f]{64}$/iu.test(value)) {
    throw new TypeError(`${label} must be 32-byte hexadecimal data`);
  }
  const normalized = value.replace(/^0x/iu, '');
  return Uint8Array.from(normalized.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function unsignedNumber(value: unknown, bits: number): number {
  const parsed = unsignedBigInt(value, bits);
  const number = Number(parsed);
  if (!Number.isSafeInteger(number)) throw new TypeError(`Uint<${bits}> value is not JS-safe`);
  return number;
}

function unsignedBigInt(value: unknown, bits: number): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new TypeError(`Uint<${bits}> value is required`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new TypeError(`Invalid Uint<${bits}> value`);
  }
  if (parsed < 0n || parsed > (1n << BigInt(bits)) - 1n) {
    throw new TypeError(`Value is outside Uint<${bits}> range`);
  }
  return parsed;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
