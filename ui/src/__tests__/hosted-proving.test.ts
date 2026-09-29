import { describe, expect, it } from 'vitest';
import {
  acceptHostedProving,
  type ConsentStorage,
  HOSTED_PROVING_COPY,
  HOSTED_PROVING_DISCLOSURE_VERSION,
  readHostedProvingConsent,
  resolveHostedProofServerUrl,
  withdrawHostedProving,
} from '../integration/hosted-proving';

function memoryStorage(initial: Record<string, string> = {}): ConsentStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const blockedStorage: ConsentStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('hosted proving consent', () => {
  it('is absent until the person accepts, and gone once they withdraw', () => {
    const storage = memoryStorage();
    expect(readHostedProvingConsent(storage)).toBeNull();

    const accepted = acceptHostedProving(new Date('2026-10-02T09:30:00.000Z'), storage);
    expect(accepted).toEqual({
      version: HOSTED_PROVING_DISCLOSURE_VERSION,
      acceptedAt: '2026-10-02T09:30:00.000Z',
    });
    expect(readHostedProvingConsent(storage)).toEqual(accepted);

    withdrawHostedProving(storage);
    expect(readHostedProvingConsent(storage)).toBeNull();
  });

  it('asks again when the stored acceptance is for another disclosure text', () => {
    const storage = memoryStorage({
      'midnight-vote:hosted-proving-consent': JSON.stringify({
        version: HOSTED_PROVING_DISCLOSURE_VERSION + 1,
        acceptedAt: '2026-10-02T09:30:00.000Z',
      }),
    });
    expect(readHostedProvingConsent(storage)).toBeNull();
  });

  it.each([
    ['not json', 'yes'],
    ['a bare true', 'true'],
    ['no date', JSON.stringify({ version: HOSTED_PROVING_DISCLOSURE_VERSION })],
    [
      'an unreadable date',
      JSON.stringify({ version: HOSTED_PROVING_DISCLOSURE_VERSION, acceptedAt: 'soon' }),
    ],
  ])('treats %s as no acceptance', (_label, stored) => {
    const storage = memoryStorage({ 'midnight-vote:hosted-proving-consent': stored });
    expect(readHostedProvingConsent(storage)).toBeNull();
  });

  it('still works for the visit when storage is blocked', () => {
    expect(readHostedProvingConsent(blockedStorage)).toBeNull();
    expect(acceptHostedProving(new Date('2026-10-02T09:30:00.000Z'), blockedStorage)).toMatchObject(
      { version: HOSTED_PROVING_DISCLOSURE_VERSION },
    );
    expect(() => withdrawHostedProving(blockedStorage)).not.toThrow();
    expect(readHostedProvingConsent(null)).toBeNull();
  });
});

describe('hosted proof server address', () => {
  it('accepts HTTPS and a local development host', () => {
    expect(resolveHostedProofServerUrl(' https://prove.midnight.vote/ ')).toBe(
      'https://prove.midnight.vote',
    );
    expect(resolveHostedProofServerUrl('http://localhost:6300')).toBe('http://localhost:6300');
    expect(resolveHostedProofServerUrl('http://127.0.0.1:6300')).toBe('http://127.0.0.1:6300');
  });

  it.each([
    ['unset', undefined],
    ['empty', '   '],
    ['plain HTTP to a remote host', 'http://prove.midnight.vote'],
    ['a host that only starts like localhost', 'http://localhost.example.com'],
    ['embedded credentials', 'https://user:secret@prove.midnight.vote'],
    ['another scheme', 'ws://prove.midnight.vote'],
    ['not a URL', 'prove.midnight.vote'],
  ])('reads %s as not configured', (_label, raw) => {
    expect(resolveHostedProofServerUrl(raw)).toBeNull();
  });
});

describe('hosted proving disclosure', () => {
  it('says in every language that the server sees the answer and the pass secret', () => {
    expect(HOSTED_PROVING_COPY.en.body).toMatch(/can see your answer and your pass secret/u);
    expect(HOSTED_PROVING_COPY.es.body).toMatch(/puede ver tu respuesta y el secreto de tu pase/u);
    expect(HOSTED_PROVING_COPY.fr.body).toMatch(
      /peut voir votre réponse et le secret de votre pass/u,
    );
  });

  it('never claims the answer stays on the device', () => {
    for (const copy of Object.values(HOSTED_PROVING_COPY)) {
      for (const text of Object.values(copy)) {
        expect(text).not.toMatch(/never leaves|nunca sale|ne quitte jamais/iu);
      }
    }
  });
});
