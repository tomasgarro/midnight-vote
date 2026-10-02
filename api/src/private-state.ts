import type { ContractAddress, SigningKey } from '@midnight-ntwrk/compact-runtime';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import type {
  BallotOpening,
  BallotOpeningVaultPort,
  CivicCredentialVaultPort,
  StoredCivicCredential,
} from './passport-v2/ports.js';
import type {
  HolderKeyVaultPort,
  RarimoEnrollmentVaultPort,
  StoredHolderKey,
  StoredRarimoEnrollment,
} from './passport-v2/rarimo-credential-adapter.js';

const PRIVATE_STATE_DB = 'midnight-referendum-private-state';
const PRIVATE_STATE_DB_VERSION = 2;
const STATE_STORE = 'states';
const SIGNING_KEY_STORE = 'signing-keys';
const META_STORE = 'meta';

type EncryptedRecord = {
  iv: number[];
  ciphertext: number[];
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function serializePrivateStateForStorage(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown): JsonValue => {
    if (typeof current === 'bigint') return { $bigint: current.toString() };
    if (current instanceof Uint8Array) {
      return { $bytes: bytesToBase64(current) };
    }
    return current as JsonValue;
  });
}

export function deserializePrivateStateFromStorage<T>(value: string): T {
  return JSON.parse(value, (_key, current: unknown) => {
    if (!current || typeof current !== 'object') return current;
    const candidate = current as Record<string, unknown>;
    if (typeof candidate.$bigint === 'string') return BigInt(candidate.$bigint);
    if (typeof candidate.$bytes === 'string') return base64ToBytes(candidate.$bytes);
    return current;
  }) as T;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRIVATE_STATE_DB, PRIVATE_STATE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE);
      if (!database.objectStoreNames.contains(SIGNING_KEY_STORE))
        database.createObjectStore(SIGNING_KEY_STORE);
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open private state storage'));
  });
}

async function readRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not read private state storage'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not read private state storage'));
  });
}

async function writeRecord(storeName: string, key: IDBValidKey, value: unknown): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not write private state storage'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Private state storage write was aborted'));
  });
}

async function clearStore(storeName: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not clear private state storage'));
  });
}

async function encryptionKey(): Promise<CryptoKey> {
  const existing = await readRecord<CryptoKey>(META_STORE, 'encryption-key');
  if (existing) return existing;

  const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await writeRecord(META_STORE, 'encryption-key', created);
  return created;
}

async function seal(value: unknown): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    new TextEncoder().encode(serializePrivateStateForStorage(value)),
  );
  return {
    iv: [...iv],
    ciphertext: [...new Uint8Array(ciphertext)],
  };
}

async function unseal<T>(record: EncryptedRecord): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
    await encryptionKey(),
    new Uint8Array(record.ciphertext),
  );
  return deserializePrivateStateFromStorage<T>(new TextDecoder().decode(plaintext));
}

/**
 * Session-scoped, in-memory fallback implementation of the full
 * PrivateStateProvider interface. It is used by tests, SSR, and browsers
 * without IndexedDB/WebCrypto support.
 *
 * This implements the complete 13-method PrivateStateProvider<PSI, PS>
 * contract. The export/import methods are not meaningful for an ephemeral
 * in-memory store, so they reject â€” swap in an encrypting persistent provider
 * (e.g. IndexedDB) if you need cross-session private state or real exports.
 */
export function inMemoryPrivateStateProvider<PSI extends string, PS>(): PrivateStateProvider<
  PSI,
  PS
> {
  const states = new Map<string, PS>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let contractScope = 'unbound';
  const stateKey = (id: PSI) => `${contractScope}:${id}`;

  return {
    setContractAddress: (address: ContractAddress) => {
      contractScope = String(address);
    },

    set: async (id: PSI, state: PS) => {
      states.set(stateKey(id), state);
    },
    get: async (id: PSI) => states.get(stateKey(id)) ?? null,
    remove: async (id: PSI) => {
      states.delete(stateKey(id));
    },
    clear: async () => {
      states.clear();
    },

    setSigningKey: async (address: ContractAddress, signingKey: SigningKey) => {
      signingKeys.set(address, signingKey);
    },
    getSigningKey: async (address: ContractAddress) => signingKeys.get(address) ?? null,
    removeSigningKey: async (address: ContractAddress) => {
      signingKeys.delete(address);
    },
    clearSigningKeys: async () => {
      signingKeys.clear();
    },

    exportPrivateStates: async () => {
      throw new Error(
        'inMemoryPrivateStateProvider does not support exportPrivateStates; ' +
          'use a persistent encrypting provider for exports.',
      );
    },
    importPrivateStates: async () => {
      throw new Error(
        'inMemoryPrivateStateProvider does not support importPrivateStates; ' +
          'use a persistent encrypting provider for imports.',
      );
    },
    exportSigningKeys: async () => {
      throw new Error(
        'inMemoryPrivateStateProvider does not support exportSigningKeys; ' +
          'use a persistent encrypting provider for exports.',
      );
    },
    importSigningKeys: async () => {
      throw new Error(
        'inMemoryPrivateStateProvider does not support importSigningKeys; ' +
          'use a persistent encrypting provider for imports.',
      );
    },
  };
}

/**
 * Browser provider for contract private state. Values are encrypted with a
 * non-extractable WebCrypto key and stored in IndexedDB, so voter secrets and
 * salts survive refresh without being written to localStorage. Signing keys
 * use the same encrypted store; exports remain deliberately disabled until a
 * user-controlled recovery flow is designed.
 */
export function browserPrivateStateProvider<PSI extends string, PS>(): PrivateStateProvider<
  PSI,
  PS
> {
  const memory = inMemoryPrivateStateProvider<PSI, PS>();
  const usable =
    typeof indexedDB !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined';

  if (!usable) return memory;

  let contractScope = 'unbound';
  const stateKey = (id: PSI) => `state:${contractScope}:${id}`;
  // Read-only fallback for states written before contract scoping shipped.
  const legacyStateKey = (id: PSI) => `state:${id}`;
  const signingKeyKey = (address: ContractAddress) => `signing-key:${String(address)}`;

  return {
    setContractAddress: (address) => {
      contractScope = String(address);
    },
    set: async (id, state) => writeRecord(STATE_STORE, stateKey(id), await seal(state)),
    get: async (id) => {
      const record =
        (await readRecord<EncryptedRecord>(STATE_STORE, stateKey(id))) ??
        (await readRecord<EncryptedRecord>(STATE_STORE, legacyStateKey(id)));
      return record ? unseal<PS>(record) : null;
    },
    remove: async (id) => {
      const database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STATE_STORE, 'readwrite');
        transaction.objectStore(STATE_STORE).delete(stateKey(id));
        transaction.objectStore(STATE_STORE).delete(legacyStateKey(id));
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Could not remove private state'));
      });
    },
    clear: async () => clearStore(STATE_STORE),
    setSigningKey: async (address, signingKey) =>
      writeRecord(SIGNING_KEY_STORE, signingKeyKey(address), await seal(signingKey)),
    getSigningKey: async (address) => {
      const record = await readRecord<EncryptedRecord>(SIGNING_KEY_STORE, signingKeyKey(address));
      return record ? unseal<SigningKey>(record) : null;
    },
    removeSigningKey: async (address) => {
      const database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SIGNING_KEY_STORE, 'readwrite');
        transaction.objectStore(SIGNING_KEY_STORE).delete(signingKeyKey(address));
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('Could not remove signing key'));
      });
    },
    clearSigningKeys: async () => clearStore(SIGNING_KEY_STORE),
    exportPrivateStates: async () => {
      throw new Error('Private state export is not enabled in the browser yet');
    },
    importPrivateStates: async () => {
      throw new Error('Private state import is not enabled in the browser yet');
    },
    exportSigningKeys: async () => {
      throw new Error('Signing key export is not enabled in the browser yet');
    },
    importSigningKeys: async () => {
      throw new Error('Signing key import is not enabled in the browser yet');
    },
  };
}

const CIVIC_CREDENTIAL_VAULT_ID = 'cico-civic-credential-v1' as const;

/**
 * Stores the active civic credential in the same non-extractable AES-GCM
 * IndexedDB boundary as Compact private state. The caller supplies a public
 * runtime scope (normally network + issuer + epoch), preventing material from
 * being silently reused across deployments.
 */
export function browserCivicCredentialVault(scope: string): CivicCredentialVaultPort {
  const normalizedScope = scope.trim();
  if (!normalizedScope) throw new TypeError('Credential vault scope must not be empty');
  const provider = browserPrivateStateProvider<
    typeof CIVIC_CREDENTIAL_VAULT_ID,
    StoredCivicCredential
  >();
  provider.setContractAddress(normalizedScope as ContractAddress);
  return {
    load: async () => provider.get(CIVIC_CREDENTIAL_VAULT_ID),
    save: async (credential) => provider.set(CIVIC_CREDENTIAL_VAULT_ID, credential),
    clear: async () => provider.remove(CIVIC_CREDENTIAL_VAULT_ID),
  };
}

const PENDING_ENROLLMENT_VAULT_ID = 'cico-pending-enrollment-v1' as const;

/**
 * Stores a verification in progress beside the civic credential, in the same
 * encrypted boundary and under the same scope. It lets a page that was
 * dropped during the passport scan pick the attempt up again.
 */
export function browserRarimoEnrollmentVault(scope: string): RarimoEnrollmentVaultPort {
  const normalizedScope = scope.trim();
  if (!normalizedScope) throw new TypeError('Enrollment vault scope must not be empty');
  const provider = browserPrivateStateProvider<
    typeof PENDING_ENROLLMENT_VAULT_ID,
    StoredRarimoEnrollment
  >();
  provider.setContractAddress(normalizedScope as ContractAddress);
  return {
    load: async () => provider.get(PENDING_ENROLLMENT_VAULT_ID),
    save: async (enrollment) => provider.set(PENDING_ENROLLMENT_VAULT_ID, enrollment),
    clear: async () => provider.remove(PENDING_ENROLLMENT_VAULT_ID),
  };
}

const HOLDER_KEY_VAULT_ID = 'cico-holder-key-v1' as const;

/**
 * Stores this device's holder secret in the same encrypted boundary and under
 * the same scope as its pass. It outlives the pass: a pass expires and is
 * renewed, and the issuer renews it only for the holder the document already
 * has. There is no way to clear it here. Without it, the document could get no
 * pass again on this device for as long as the registry's epoch lasts.
 */
export function browserHolderKeyVault(scope: string): HolderKeyVaultPort {
  const normalizedScope = scope.trim();
  if (!normalizedScope) throw new TypeError('Holder key vault scope must not be empty');
  const provider = browserPrivateStateProvider<typeof HOLDER_KEY_VAULT_ID, StoredHolderKey>();
  provider.setContractAddress(normalizedScope as ContractAddress);
  return {
    load: async () => provider.get(HOLDER_KEY_VAULT_ID),
    save: async (key) => provider.set(HOLDER_KEY_VAULT_ID, key),
  };
}

const BALLOT_OPENING_RECORD = 'ballot-openings-v1';
const BALLOT_BYTES = 32;

/**
 * How well the browser keeps an opening until the count.
 *
 * - `persistent`: encrypted on disk, and the browser agreed not to evict it.
 * - `best-effort`: encrypted on disk, but the browser may evict it under
 *   storage pressure or after a period without visits.
 * - `memory`: storage is blocked, for example in a private window. The opening
 *   is lost when the page closes, so the answer would never be counted.
 */
export type BallotOpeningDurability = 'persistent' | 'best-effort' | 'memory';

export interface BrowserBallotOpeningVault extends BallotOpeningVaultPort {
  durability(): Promise<BallotOpeningDurability>;
  /** Asks the browser to keep this site's storage. Resolves to whether it agreed. */
  requestPersistence(): Promise<boolean>;
}

/** The storage a ballot opening vault writes through; one record per referendum. */
export interface BallotOpeningRecordStore {
  get(recordId: string): Promise<unknown>;
  set(recordId: string, openings: readonly BallotOpening[]): Promise<void>;
  remove(recordId: string): Promise<void>;
}

const ballotVaultTails = new Map<string, Promise<void>>();
const ballotVaultMemory = new Map<string, readonly BallotOpening[]>();

function isBytes32(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === BALLOT_BYTES;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function copyOpening(opening: BallotOpening): BallotOpening {
  return {
    referendumId: opening.referendumId,
    contractAddress: opening.contractAddress,
    choice: opening.choice,
    voteSalt: new Uint8Array(opening.voteSalt),
    ballotCommitment: new Uint8Array(opening.ballotCommitment),
    status: opening.status,
    ...(opening.sealedAt === undefined ? {} : { sealedAt: opening.sealedAt }),
    ...(opening.countAuthorization === undefined
      ? {}
      : { countAuthorization: opening.countAuthorization }),
  };
}

function isBallotOpening(value: unknown, referendumId: string): value is BallotOpening {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.referendumId === referendumId &&
    typeof candidate.contractAddress === 'string' &&
    candidate.contractAddress.length > 0 &&
    (candidate.choice === 'YES' || candidate.choice === 'NO' || candidate.choice === 'ABSTAIN') &&
    isBytes32(candidate.voteSalt) &&
    isBytes32(candidate.ballotCommitment) &&
    (candidate.status === 'sealing' || candidate.status === 'sealed') &&
    (candidate.sealedAt === undefined || typeof candidate.sealedAt === 'string') &&
    (candidate.countAuthorization === undefined ||
      (typeof candidate.countAuthorization === 'string' &&
        candidate.countAuthorization.length > 0 &&
        candidate.countAuthorization.length <= 256))
  );
}

function assertStorable(opening: BallotOpening): void {
  if (!opening.referendumId.trim()) {
    throw new TypeError('A ballot opening needs its referendum id');
  }
  if (!isBallotOpening(opening, opening.referendumId)) {
    throw new TypeError('The ballot opening is incomplete and cannot be stored');
  }
}

/**
 * Vault logic over any record store. Writes for one referendum run one after
 * another, across every vault instance of the same scope, because each write
 * replaces the whole record: two interleaved writes would drop an opening, and
 * a dropped opening is an answer that can never be counted.
 */
export function createBallotOpeningVault(
  store: BallotOpeningRecordStore,
  scope: string,
): BallotOpeningVaultPort {
  const normalizedScope = scope.trim();
  if (!normalizedScope) throw new TypeError('Ballot opening vault scope must not be empty');
  const recordId = (referendumId: string) => `${BALLOT_OPENING_RECORD}:${referendumId}`;

  const inOrder = <T>(referendumId: string, task: () => Promise<T>): Promise<T> => {
    const key = `${normalizedScope}\u0000${referendumId}`;
    const result = (ballotVaultTails.get(key) ?? Promise.resolve()).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    ballotVaultTails.set(key, tail);
    void tail.then(() => {
      if (ballotVaultTails.get(key) === tail) ballotVaultTails.delete(key);
    });
    return result;
  };

  const read = async (referendumId: string): Promise<BallotOpening[]> => {
    const stored = await store.get(recordId(referendumId));
    if (!Array.isArray(stored)) return [];
    return stored.filter((item) => isBallotOpening(item, referendumId)).map(copyOpening);
  };

  return {
    list: (referendumId) => inOrder(referendumId, () => read(referendumId)),
    save: (opening) => {
      assertStorable(opening);
      return inOrder(opening.referendumId, async () => {
        const held = await read(opening.referendumId);
        const next = held.filter(
          (item) => !sameBytes(item.ballotCommitment, opening.ballotCommitment),
        );
        next.push(copyOpening(opening));
        await store.set(recordId(opening.referendumId), next);
      });
    },
    clear: (referendumId) => inOrder(referendumId, () => store.remove(recordId(referendumId))),
  };
}

function encryptedStorageUsable(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined'
  );
}

/**
 * Keeps ballot openings in the same non-extractable AES-GCM IndexedDB boundary
 * as the civic credential. The scope (normally network + issuer + epoch) keeps
 * openings from one deployment out of another. Nothing here touches the
 * network.
 *
 * Without IndexedDB the openings live in memory for the life of the page, and
 * `durability()` reports `memory` so the interface can refuse to seal an
 * answer it could never count.
 */
export function browserBallotOpeningVault(scope: string): BrowserBallotOpeningVault {
  const normalizedScope = scope.trim();
  if (!normalizedScope) throw new TypeError('Ballot opening vault scope must not be empty');
  const encrypted = encryptedStorageUsable();

  let store: BallotOpeningRecordStore;
  if (encrypted) {
    const provider = browserPrivateStateProvider<string, readonly BallotOpening[]>();
    provider.setContractAddress(normalizedScope as ContractAddress);
    store = {
      get: (recordId) => provider.get(recordId),
      set: (recordId, openings) => provider.set(recordId, openings),
      remove: (recordId) => provider.remove(recordId),
    };
  } else {
    const memoryKey = (recordId: string) => `${normalizedScope}\u0000${recordId}`;
    store = {
      get: async (recordId) => ballotVaultMemory.get(memoryKey(recordId)),
      set: async (recordId, openings) => {
        ballotVaultMemory.set(memoryKey(recordId), openings);
      },
      remove: async (recordId) => {
        ballotVaultMemory.delete(memoryKey(recordId));
      },
    };
  }

  const storageManager = () =>
    typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;

  return {
    ...createBallotOpeningVault(store, normalizedScope),
    durability: async () => {
      if (!encrypted) return 'memory';
      try {
        return (await storageManager()?.persisted?.()) ? 'persistent' : 'best-effort';
      } catch {
        return 'best-effort';
      }
    },
    requestPersistence: async () => {
      if (!encrypted) return false;
      try {
        return (await storageManager()?.persist?.()) ?? false;
      } catch {
        return false;
      }
    },
  };
}
