export type ReceiptStatus = 'simulated' | 'confirmed';

export interface PassportReceiptRecord {
  id: string;
  pollId?: string;
  createdAt: string;
  status: ReceiptStatus;
  network: string;
  explorerUrl?: string;
  /**
   * Set for an answer sealed on-chain. Such a receipt carries no transaction
   * id and no explorer link: either would tie this device to a cast whose
   * answer becomes public at the count (ADR-009).
   */
  sealed?: { readonly provingParty: 'wallet' | 'device' | 'hosted-server' };
}

type EncryptedRecord = {
  iv: number[];
  ciphertext: number[];
};

const DATABASE_NAME = 'referendum-civico-receipts';
const DATABASE_VERSION = 1;
const RECEIPT_STORE = 'receipts';
const KEY_STORE = 'meta';
const FALLBACK_RECEIPTS = new Map<string, PassportReceiptRecord[]>();

function canUseEncryptedStorage(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined'
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECEIPT_STORE)) {
        database.createObjectStore(RECEIPT_STORE);
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open receipt storage'));
  });
}

async function readRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read receipt storage'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not read receipt storage'));
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
      reject(transaction.error ?? new Error('Could not write receipt storage'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Receipt storage write was aborted'));
  });
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const existing = await readRecord<CryptoKey>(KEY_STORE, 'encryption-key');
  if (existing) return existing;

  const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await writeRecord(KEY_STORE, 'encryption-key', created);
  return created;
}

async function seal(value: PassportReceiptRecord[]): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await getEncryptionKey(),
    plaintext,
  );
  return { iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)] };
}

async function unseal(record: EncryptedRecord): Promise<PassportReceiptRecord[]> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
    await getEncryptionKey(),
    new Uint8Array(record.ciphertext),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  return Array.isArray(parsed) ? (parsed as PassportReceiptRecord[]) : [];
}

function storageKey(profileKey: string): string {
  return `passport-profile:${profileKey}`;
}

export async function loadPassportReceipts(profileKey: string): Promise<PassportReceiptRecord[]> {
  if (!profileKey) return [];
  if (!canUseEncryptedStorage()) return [...(FALLBACK_RECEIPTS.get(profileKey) ?? [])];

  try {
    const record = await readRecord<EncryptedRecord>(RECEIPT_STORE, storageKey(profileKey));
    return record ? await unseal(record) : [];
  } catch {
    return [...(FALLBACK_RECEIPTS.get(profileKey) ?? [])];
  }
}

export async function savePassportReceipt(
  profileKey: string,
  receipt: PassportReceiptRecord,
): Promise<void> {
  if (!profileKey) return;
  const existing = await loadPassportReceipts(profileKey);
  const next = [receipt, ...existing.filter((item) => item.id !== receipt.id)];
  FALLBACK_RECEIPTS.set(profileKey, next);

  if (!canUseEncryptedStorage()) return;
  try {
    await writeRecord(RECEIPT_STORE, storageKey(profileKey), await seal(next));
  } catch {
    // The in-memory copy keeps the current session usable when browser storage
    // is blocked. It never stores the raw Passport account.
  }
}

export async function clearPassportReceipts(profileKey: string): Promise<void> {
  FALLBACK_RECEIPTS.delete(profileKey);
  if (!canUseEncryptedStorage() || !profileKey) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(RECEIPT_STORE, 'readwrite');
    transaction.objectStore(RECEIPT_STORE).delete(storageKey(profileKey));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not clear receipt storage'));
  });
}
