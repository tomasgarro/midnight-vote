import type {
  BallotOpening,
  BallotRecord,
  PollDraft,
  PublishedPoll,
  VoteReceipt,
} from './model.js';
import { validateDraft } from './model.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: unknown): Promise<string> {
  return hex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value)))),
  );
}

export async function publishPoll(
  draft: PollDraft,
  environment: PublishedPoll['environment'],
  now = Date.now(),
): Promise<PublishedPoll> {
  validateDraft(draft);
  if (draft.closesAt <= now) throw new Error('A new poll must close in the future.');
  if (environment !== 'simulation')
    throw new Error(
      'Live publication is blocked until Midnight Passport authority, Ledger 9 deployment, and all tally modes are verified.',
    );
  const rules = {
    id: draft.id,
    question: draft.question.trim(),
    description: draft.description.trim(),
    options: draft.options.map((s) => s.trim()),
    visibility: draft.visibility,
    eligibility: { ...draft.eligibility },
    opensAt: draft.opensAt,
    closesAt: draft.closesAt,
  };
  Object.freeze(rules.options);
  Object.freeze(rules.eligibility);
  return Object.freeze({
    ...rules,
    rulesHash: await digest(['midnight.vote/rules/v1', rules]),
    publishedAt: now,
    environment,
  });
}

export function createOpening(poll: PublishedPoll, choice: number): BallotOpening {
  if (!Number.isInteger(choice) || choice < 0 || choice >= poll.options.length)
    throw new Error('Choose a valid option.');
  return { pollId: poll.id, rulesHash: poll.rulesHash, choice, salt: randomToken() };
}

export async function ballotCommitment(opening: BallotOpening): Promise<string> {
  return digest([
    'midnight.vote/ballot/v1',
    opening.pollId,
    opening.rulesHash,
    opening.choice,
    opening.salt,
  ]);
}

/** Ordered full-set commitment: omission, duplication, or reordering changes the digest. */
export async function ballotSetHash(
  poll: PublishedPoll,
  records: readonly BallotRecord[],
): Promise<string> {
  const nullifiers = new Set<string>();
  for (const record of records) {
    if (record.pollId !== poll.id || record.rulesHash !== poll.rulesHash)
      throw new Error('Ballot belongs to different poll rules.');
    if (nullifiers.has(record.nullifier)) throw new Error('Duplicate ballot nullifier.');
    if (poll.visibility !== 'public' && record.account !== undefined)
      throw new Error('This mode cannot publish account identifiers.');
    if (poll.visibility === 'public' && !record.account)
      throw new Error('Public votes require explicit account disclosure.');
    nullifiers.add(record.nullifier);
  }
  return digest(['midnight.vote/ballot-set/v1', poll.rulesHash, records]);
}

const encode64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
function decode64(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || text.length > 2_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new Error('Invalid receipt encoding.');
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function recoveryKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  if (passphrase.length < 12 || passphrase.length > 1024)
    throw new Error('Use a recovery passphrase of at least 12 characters.');
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

export async function exportReceipt(receipt: VoteReceipt, passphrase: string): Promise<string> {
  if (!(await verifyReceiptOpening(receipt)))
    throw new Error('Receipt opening does not match its commitment.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recoveryKey(passphrase, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode('midnight.vote/recovery/v1') },
    key,
    encoder.encode(JSON.stringify(receipt)),
  );
  return JSON.stringify({
    kind: 'midnight.vote/recovery/v1',
    kdf: 'PBKDF2-SHA256-600000',
    salt: encode64(salt),
    iv: encode64(iv),
    ciphertext: encode64(new Uint8Array(ciphertext)),
  });
}

export async function importReceipt(file: string, passphrase: string): Promise<VoteReceipt> {
  if (file.length > 2_000_000) throw new Error('Receipt file is too large.');
  const envelope = JSON.parse(file);
  if (envelope?.kind !== 'midnight.vote/recovery/v1' || envelope.kdf !== 'PBKDF2-SHA256-600000')
    throw new Error('Unsupported recovery file.');
  const salt = decode64(envelope.salt);
  const iv = decode64(envelope.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid recovery parameters.');
  const key = await recoveryKey(passphrase, salt, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(envelope.kind) },
    key,
    decode64(envelope.ciphertext),
  );
  const receipt: VoteReceipt = JSON.parse(decoder.decode(plaintext));
  if (!(await verifyReceiptOpening(receipt))) throw new Error('The restored receipt is invalid.');
  return receipt;
}

export async function verifyReceiptOpening(receipt: VoteReceipt): Promise<boolean> {
  const opening = receipt?.opening;
  return Boolean(
    receipt?.kind === 'midnight.vote/receipt/v1' &&
      ['simulation', 'preview'].includes(receipt.environment) &&
      opening &&
      typeof opening.pollId === 'string' &&
      typeof opening.rulesHash === 'string' &&
      Number.isInteger(opening.choice) &&
      opening.choice >= 0 &&
      /^[a-f0-9]{64}$/.test(opening.salt) &&
      (await ballotCommitment(opening)) === receipt.commitment,
  );
}
