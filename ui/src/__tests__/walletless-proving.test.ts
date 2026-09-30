import { describe, expect, it } from 'vitest';
import {
  type ChoiceStorage,
  formatElapsed,
  needsHostedConsent,
  readProverChoice,
  rememberProverChoice,
  resolveDeviceParamsUrl,
  resolveProver,
  WALLETLESS_PROVING_COPY,
} from '../integration/walletless-proving';

function memoryStorage(initial: Record<string, string> = {}): ChoiceStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('choosing a prover', () => {
  it('starts on the device wherever the device can prove', () => {
    expect(resolveProver({ deviceAvailable: true, hostedAvailable: true, choice: null })).toBe(
      'device',
    );
    expect(resolveProver({ deviceAvailable: true, hostedAvailable: false, choice: null })).toBe(
      'device',
    );
  });

  it('keeps a remembered choice while that prover is available', () => {
    expect(
      resolveProver({ deviceAvailable: true, hostedAvailable: true, choice: 'hosted-server' }),
    ).toBe('hosted-server');
    expect(resolveProver({ deviceAvailable: true, hostedAvailable: true, choice: 'device' })).toBe(
      'device',
    );
  });

  it('never falls back to the proving server behind the person’s back', () => {
    // The server was chosen once and is gone: the device takes over.
    expect(
      resolveProver({ deviceAvailable: true, hostedAvailable: false, choice: 'hosted-server' }),
    ).toBe('device');
    // The device was chosen and cannot prove here: the server becomes the
    // selection, and it still needs its disclosure accepted before any use.
    const fallback = resolveProver({
      deviceAvailable: false,
      hostedAvailable: true,
      choice: 'device',
    });
    expect(fallback).toBe('hosted-server');
    expect(needsHostedConsent({ offered: true, selected: fallback, hostedAccepted: false })).toBe(
      true,
    );
  });

  it('offers nothing when neither prover is available', () => {
    expect(resolveProver({ deviceAvailable: false, hostedAvailable: false, choice: null })).toBe(
      null,
    );
  });

  it('remembers the choice on the device and ignores anything else stored there', () => {
    const storage = memoryStorage();
    expect(readProverChoice(storage)).toBeNull();

    rememberProverChoice('hosted-server', storage);
    expect(readProverChoice(storage)).toBe('hosted-server');
    rememberProverChoice('device', storage);
    expect(readProverChoice(storage)).toBe('device');

    expect(readProverChoice(memoryStorage({ 'midnight-vote:walletless-prover': 'wallet' }))).toBe(
      null,
    );
    expect(readProverChoice(null)).toBeNull();
    expect(
      readProverChoice({
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      }),
    ).toBeNull();
  });
});

describe('asking for the disclosure', () => {
  it('asks only when the proving server is the chosen prover and not yet accepted', () => {
    expect(
      needsHostedConsent({ offered: true, selected: 'hosted-server', hostedAccepted: false }),
    ).toBe(true);
    expect(
      needsHostedConsent({ offered: true, selected: 'hosted-server', hostedAccepted: true }),
    ).toBe(false);
    expect(needsHostedConsent({ offered: true, selected: 'device', hostedAccepted: false })).toBe(
      false,
    );
    expect(
      needsHostedConsent({ offered: false, selected: 'hosted-server', hostedAccepted: false }),
    ).toBe(false);
    expect(needsHostedConsent(undefined)).toBe(false);
  });
});

describe('where the public parameters come from', () => {
  const origin = 'https://midnight.vote';

  it('serves them from the app’s own origin by default', () => {
    expect(resolveDeviceParamsUrl(undefined, origin)).toBe('https://midnight.vote/zk-params');
    expect(resolveDeviceParamsUrl('  ', origin)).toBe('https://midnight.vote/zk-params');
    expect(resolveDeviceParamsUrl('/assets/params/', origin)).toBe(
      'https://midnight.vote/assets/params',
    );
  });

  it('accepts another HTTPS host and a local development host', () => {
    expect(resolveDeviceParamsUrl('https://cdn.midnight.vote/zk', origin)).toBe(
      'https://cdn.midnight.vote/zk',
    );
    expect(resolveDeviceParamsUrl(undefined, 'http://localhost:5173')).toBe(
      'http://localhost:5173/zk-params',
    );
  });

  it.each([
    ['plain HTTP to a remote host', 'http://cdn.midnight.vote/zk'],
    ['embedded credentials', 'https://user:secret@cdn.midnight.vote/zk'],
    ['another scheme', 'ftp://cdn.midnight.vote/zk'],
  ])('refuses %s', (_label, raw) => {
    expect(resolveDeviceParamsUrl(raw, origin)).toBeNull();
  });

  it('refuses a remote page served over plain HTTP', () => {
    expect(resolveDeviceParamsUrl(undefined, 'http://midnight.vote')).toBeNull();
  });
});

describe('elapsed time', () => {
  it('reads as minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_999)).toBe('0:09');
    expect(formatElapsed(125_000)).toBe('2:05');
    expect(formatElapsed(3_600_000)).toBe('60:00');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('prover copy', () => {
  it('says in every language that the device keeps the answer and the server sees it', () => {
    expect(WALLETLESS_PROVING_COPY.en.deviceBody).toMatch(
      /not sent to any server until it is counted/u,
    );
    expect(WALLETLESS_PROVING_COPY.es.deviceBody).toMatch(
      /no se envía a ningún servidor hasta que se cuenta/u,
    );
    expect(WALLETLESS_PROVING_COPY.fr.deviceBody).toMatch(
      /n'est envoyée à aucun serveur avant d'être comptée/u,
    );
    expect(WALLETLESS_PROVING_COPY.en.hostedBody).toMatch(/can see your answer/u);
    expect(WALLETLESS_PROVING_COPY.es.hostedBody).toMatch(/puede ver tu respuesta/u);
    expect(WALLETLESS_PROVING_COPY.fr.hostedBody).toMatch(/peut voir votre réponse/u);
  });

  it('never promises that the answer stays private for ever', () => {
    for (const copy of Object.values(WALLETLESS_PROVING_COPY)) {
      for (const text of Object.values(copy)) {
        expect(text).not.toMatch(/never leaves|nunca sale|ne quitte jamais/iu);
      }
    }
  });
});
