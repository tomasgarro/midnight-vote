import { describe, expect, it } from 'vitest';
import type { CicoLocale } from '../integration/locale';
import {
  getPreviewReadiness,
  getPublicReadiness,
  type PreviewReadinessInput,
  resolvePassportV2ActionRoute,
} from '../integration/preview';
import { RUNTIME_COPY, sealRefusalMessage } from '../integration/runtime-copy';

const LOCALES: readonly CicoLocale[] = ['es', 'en', 'fr'];

const ready: PreviewReadinessInput = {
  appMode: 'preview',
  contractAddress: '0'.repeat(64),
  walletConnected: true,
  providersReady: true,
  v2RuntimeConfigured: true,
  credentialVerified: true,
};

/** Every state the readiness of an action can be in, by the input that reaches it. */
const STATES: readonly (readonly [string, PreviewReadinessInput])[] = [
  ['demo', { ...ready, appMode: 'demo' }],
  ['no contract', { ...ready, contractAddress: null }],
  ['providers failed', { ...ready, providersError: 'indexer unavailable' }],
  ['no credential', { ...ready, credentialVerified: false }],
  [
    'server not accepted',
    { ...ready, walletConnected: false, relayerMode: true, walletlessProving: 'needs-consent' },
  ],
  [
    'proof failed',
    { ...ready, walletConnected: false, relayerMode: true, walletlessProving: 'failed' },
  ],
  [
    'proof preparing',
    { ...ready, walletConnected: false, relayerMode: true, walletlessProving: 'preparing' },
  ],
  ['no wallet', { ...ready, walletConnected: false }],
  ['providers preparing', { ...ready, providersReady: false }],
  ['ready', ready],
  ['local network', { ...ready, appMode: 'undeployed' }],
];

describe('what the app says when an action cannot start', () => {
  it.each(STATES)('says "%s" in each of the three languages', (_name, input) => {
    const said = LOCALES.map((locale) => getPreviewReadiness(input, locale));

    // The state is a fact. Only the words change with the language.
    expect(new Set(said.map((entry) => entry.state)).size).toBe(1);
    expect(new Set(said.map((entry) => entry.message)).size).toBe(LOCALES.length);
    for (const entry of said) {
      expect(entry.label.trim()).not.toBe('');
      expect(entry.message.trim()).not.toBe('');
      expect(`${entry.label} ${entry.message}`).not.toMatch(/undefined|\[object/u);
    }
  });

  it('keeps Spanish as the language of a caller that names none', () => {
    for (const [, input] of STATES) {
      expect(getPreviewReadiness(input)).toEqual(getPreviewReadiness(input, 'es'));
    }
  });

  it('passes on what a service said, unchanged, inside its own words', () => {
    for (const locale of LOCALES) {
      const failed = getPreviewReadiness({ ...ready, providersError: 'indexer 503' }, locale);
      expect(failed.message).toContain('indexer 503');
      const unread = getPublicReadiness(
        {
          appMode: 'preview',
          contractAddress: '0'.repeat(64),
          publicProviderReady: false,
          publicProviderError: 'socket closed',
        },
        locale,
      );
      expect(unread.message).toContain('socket closed');
      expect(unread.message).toContain('Preview');
    }
  });

  it('words a blocked answer in the language of the reader', () => {
    const blocked = (locale: CicoLocale) =>
      resolvePassportV2ActionRoute(
        {
          runtimeConfigured: true,
          credentialVerified: false,
          actionPortAvailable: true,
          referendumId: 'poll',
        },
        locale,
      );
    const messages = LOCALES.map((locale) => {
      const route = blocked(locale);
      if (route.mode !== 'blocked') throw new Error('The answer was not blocked');
      return route.message;
    });

    expect(new Set(messages).size).toBe(LOCALES.length);
    expect(messages[1]).toMatch(/verified Passport credential/u);
    expect(messages[2]).toMatch(/justificatif Passport vérifié/u);
  });

  it('reads the public state in the language of the reader', () => {
    const input = {
      appMode: 'preview' as const,
      contractAddress: '0'.repeat(64),
      publicProviderReady: true,
    };
    expect(getPublicReadiness(input, 'en').label).toBe('Preview can be read');
    expect(getPublicReadiness(input, 'fr').label).toBe('Preview peut être lu');
    expect(getPublicReadiness(input).label).toBe('Lectura Preview lista');
  });
});

describe("the runtime's own words", () => {
  it('exist in every language, under the same names', () => {
    const names = Object.keys(RUNTIME_COPY.es).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(RUNTIME_COPY[locale]).sort(), locale).toEqual(names);
    }
  });

  it('differ from one language to the next, and hold what they are given', () => {
    for (const name of Object.keys(RUNTIME_COPY.es) as (keyof typeof RUNTIME_COPY.es)[]) {
      const said = LOCALES.map((locale) => {
        const entry = RUNTIME_COPY[locale][name];
        return typeof entry === 'function' ? entry('Preview') : entry;
      });
      for (const line of said) expect(line.trim(), name).not.toBe('');
      // `Feedback` style loan words aside, a line is written once per language.
      expect(new Set(said).size, name).toBe(LOCALES.length);
      if (typeof RUNTIME_COPY.es[name] === 'function') {
        for (const line of said) expect(line, name).toContain('Preview');
      }
    }
  });
});

describe('what the app says when sealing an answer is refused', () => {
  const refusal = (code: string, message: string) => Object.assign(new Error(message), { code });

  it.each([
    ['CREDENTIAL_NOT_ADMITTED', 'passNotAdmitted'],
    ['CREDENTIAL_ADMISSION_CLOSED', 'passTooLate'],
    ['ANSWER_ALREADY_SEALED', 'answerAlreadySealed'],
    ['HOLDER_ALREADY_ANSWERED', 'holderAlreadyAnswered'],
  ] as const)('says %s in each of the three languages', (code, key) => {
    const said = LOCALES.map((locale) =>
      sealRefusalMessage(refusal(code, 'English from the adapter'), locale, 'Preview'),
    );
    expect(said).toEqual(LOCALES.map((locale) => RUNTIME_COPY[locale][key]));
    expect(new Set(said).size).toBe(LOCALES.length);
    for (const message of said) expect(message).not.toContain('English from the adapter');
  });

  it('tells a pass that will be admitted from one that came too late', () => {
    for (const locale of LOCALES) {
      // Only the first invites the person to try again.
      expect(RUNTIME_COPY[locale].passNotAdmitted).toMatch(/again|de nuevo|Réessayez/u);
      expect(RUNTIME_COPY[locale].passTooLate).not.toMatch(/again|de nuevo|Réessayez/u);
    }
  });

  it('shows any other refusal as it arrived, and names the network when there is none', () => {
    expect(sealRefusalMessage(new Error('The relay is unavailable'), 'fr', 'Preview')).toBe(
      'The relay is unavailable',
    );
    expect(sealRefusalMessage(refusal('CONFLICT', 'Already sealed'), 'es', 'Preview')).toBe(
      'Already sealed',
    );
    expect(sealRefusalMessage('not an error', 'en', 'Preview')).toBe(
      RUNTIME_COPY.en.transactionFailed('Preview'),
    );
  });
});
