import { ballotCommitment, ballotSetHash } from './crypto.js';
import type { BallotOpening, BallotRecord, PublishedPoll } from './model.js';

const encoder = new TextEncoder();
const encode64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const decode64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Research only. This processor key can decrypt individual choices, including before closing. */
export const PROTOTYPE_TRUST =
  'A single experimental tally processor can read individual choices. Encryption is not an aggregate proof. No live poll may use this prototype.';

export async function createPrototypeProcessor(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export async function encryptOpening(opening: BallotOpening, key: CryptoKey): Promise<string> {
  const ballotKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(opening.rulesHash) },
    ballotKey,
    encoder.encode(JSON.stringify(opening)),
  );
  const wrapped = await crypto.subtle.wrapKey('raw', ballotKey, key, 'RSA-OAEP');
  return JSON.stringify({
    kind: 'midnight.vote/encrypted-opening/prototype-v1',
    iv: encode64(iv),
    ciphertext: encode64(new Uint8Array(ciphertext)),
    wrappedKey: encode64(new Uint8Array(wrapped)),
  });
}

export async function decryptOpening(
  envelope: string,
  rulesHash: string,
  key: CryptoKey,
): Promise<BallotOpening> {
  if (envelope.length > 16_384) throw new Error('Encrypted opening exceeds prototype size limit.');
  const value = JSON.parse(envelope);
  if (value?.kind !== 'midnight.vote/encrypted-opening/prototype-v1')
    throw new Error('Unknown encrypted opening.');
  const ballotKey = await crypto.subtle.unwrapKey(
    'raw',
    decode64(value.wrappedKey),
    key,
    'RSA-OAEP',
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode64(value.iv), additionalData: encoder.encode(rulesHash) },
    ballotKey,
    decode64(value.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/** Checks the complete set locally. Deliberately produces no claim of a ZK proof. */
export async function tallyPrototype(
  poll: PublishedPoll,
  records: readonly BallotRecord[],
  processorKey: CryptoKey,
  now = Date.now(),
) {
  if (now < poll.closesAt) throw new Error('The poll has not closed.');
  const setHash = await ballotSetHash(poll, records);
  const totals = poll.options.map(() => 0);
  for (const record of records) {
    const opening = await decryptOpening(record.encryptedOpening, poll.rulesHash, processorKey);
    if (
      opening.pollId !== poll.id ||
      opening.rulesHash !== poll.rulesHash ||
      !Number.isInteger(opening.choice) ||
      opening.choice < 0 ||
      opening.choice >= totals.length ||
      (await ballotCommitment(opening)) !== record.commitment
    )
      throw new Error('Encrypted opening does not match the accepted ballot. Tally blocked.');
    totals[opening.choice] += 1;
  }
  return {
    kind: 'experimental-local-tally' as const,
    ballotSetHash: setHash,
    ballotCount: records.length,
    totals,
    proofVerified: false as const,
    trust: PROTOTYPE_TRUST,
  };
}
