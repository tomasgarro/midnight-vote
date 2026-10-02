import { describe, expect, it } from 'vitest';
import { parsePassportV2RuntimeConfig } from '../integration/passport-v2-runtime-config';

const issuerId = 'cico-rarimo-preview';
const issuerHex = Array.from(new TextEncoder().encode(issuerId.padEnd(32, '\0')), (byte) =>
  byte.toString(16).padStart(2, '0'),
).join('');
const env = {
  VITE_PASSPORT_V2_API_URL: 'https://cico-api.example',
  VITE_MIDNIGHT_NETWORK: 'preview',
  VITE_CICO_ISSUER_ID: issuerId,
  VITE_CICO_CREDENTIAL_EPOCH: '7',
  VITE_CICO_CREDENTIAL_TTL_MS: '86400000',
  VITE_RARIMO_UNIQUENESS_TIMESTAMP_UPPER_BOUND: '1800000000',
  VITE_CICO_REGISTRY_ADDRESS: `0x${'04'.repeat(32)}`,
  VITE_CICO_REGISTRY_ID_HEX: '01'.repeat(32),
  VITE_CICO_ISSUER_ID_HEX: issuerHex,
  VITE_CICO_FROZEN_ROOT_FIELD: '42',
  VITE_CICO_REFERENDA_JSON: JSON.stringify([
    {
      referendumId: 'tierras-rurales:world',
      contractAddress: 'referendum-address',
      title: 'Tierras rurales',
      question: '¿Aprobás esta consulta?',
      eventIdHex: '02'.repeat(32),
      organizerKeyHex: '03'.repeat(32),
      rootPublisherKeyHex: '04'.repeat(32),
      opensAtUnix: '1000',
      enrollmentClosesAtUnix: '2000',
      closesAtUnix: '3000',
      revealClosesAtUnix: '4000',
      countryPolicy: null,
      minimumAssurance: 2,
      requireAdult: true,
      validityReference: '1787659200',
    },
  ]),
};

describe('Passport v2 runtime config', () => {
  it('stays disabled when no backend is configured', () => {
    expect(parsePassportV2RuntimeConfig({})).toBeNull();
  });

  it('parses the frozen registry and referendum catalog without private keys', () => {
    const parsed = parsePassportV2RuntimeConfig(env);
    expect(parsed).toMatchObject({
      network: 'preview',
      apiUrl: 'https://cico-api.example',
      issuerId,
      credentialEpoch: 7,
      registry: { registryContractAddress: `0x${'04'.repeat(32)}`, credentialEpoch: 7n },
    });
    expect(parsed?.referenda[0]).toMatchObject({
      referendumId: 'tierras-rurales:world',
      config: { countryPolicyEnabled: false, minimumAssurance: 2n, network: 'preview' },
    });
  });

  describe('a registry that keeps enrolling', () => {
    const [frozenEntry] = JSON.parse(env.VITE_CICO_REFERENDA_JSON);
    const openEnv = (entries: readonly object[]) => ({
      ...env,
      VITE_CICO_ENROLLMENT_MODEL: 'open',
      // The deploy writes this empty for an open registry.
      VITE_CICO_FROZEN_ROOT_FIELD: '',
      VITE_CICO_REFERENDA_JSON: JSON.stringify(entries),
    });

    it('pins each consultation to the root it was deployed against', () => {
      const parsed = parsePassportV2RuntimeConfig(
        openEnv([
          { ...frozenEntry, initialRootField: '1001' },
          {
            ...frozenEntry,
            referendumId: 'second',
            contractAddress: 'second-address',
            initialRootField: '2002',
          },
        ]),
      );
      expect(parsed?.referenda.map((entry) => entry.config.registry.frozenRoot.field)).toEqual([
        1001n,
        2002n,
      ]);
      // Both name the same registry.
      expect(parsed?.referenda[1]?.config.registry.registryContractAddress).toBe(
        `0x${'04'.repeat(32)}`,
      );
    });

    it('refuses a consultation that does not say which root it started from', () => {
      expect(() => parsePassportV2RuntimeConfig(openEnv([frozenEntry]))).toThrow(
        'needs initialRootField',
      );
    });

    it('refuses a frozen root beside the open model, and an unknown model', () => {
      expect(() =>
        parsePassportV2RuntimeConfig({
          ...openEnv([{ ...frozenEntry, initialRootField: '1001' }]),
          VITE_CICO_FROZEN_ROOT_FIELD: '42',
        }),
      ).toThrow('has no frozen root');
      expect(() =>
        parsePassportV2RuntimeConfig({ ...env, VITE_CICO_ENROLLMENT_MODEL: 'rolling' }),
      ).toThrow('frozen or open');
    });

    it('reads a consultation in other languages, and takes nothing but text from them', () => {
      const parsed = parsePassportV2RuntimeConfig(
        openEnv([
          {
            ...frozenEntry,
            initialRootField: '1001',
            translations: {
              fr: {
                title: ' Terres rurales ',
                question: 'Approuvez-vous cette consultation ?',
                // A translation cannot move a consultation to another contract.
                contractAddress: 'another-address',
                closesAtUnix: '9999',
              },
              en: { description: '' },
              de: { title: 'Ländlicher Boden' },
            },
          },
        ]),
      );
      const [entry] = parsed?.referenda ?? [];
      expect(entry?.translations).toEqual({
        fr: { title: 'Terres rurales', question: 'Approuvez-vous cette consultation ?' },
      });
      expect(entry?.contractAddress).toBe('referendum-address');
      expect(entry?.config.closesAtUnix).toBe(3000n);
    });

    it('refuses translations that are not text by language', () => {
      for (const translations of ['fr', ['fr'], { fr: 'Terres rurales' }]) {
        expect(() =>
          parsePassportV2RuntimeConfig(
            openEnv([{ ...frozenEntry, initialRootField: '1001', translations }]),
          ),
        ).toThrow(/translation/);
      }
    });

    it('still requires the frozen root when the model is frozen', () => {
      expect(() =>
        parsePassportV2RuntimeConfig({ ...env, VITE_CICO_FROZEN_ROOT_FIELD: '' }),
      ).toThrow('VITE_CICO_FROZEN_ROOT_FIELD');
      expect(
        parsePassportV2RuntimeConfig(env)?.referenda[0]?.config.registry.frozenRoot.field,
      ).toBe(42n);
    });
  });

  it('uses the same v2 catalog on the local Undeployed network', () => {
    const parsed = parsePassportV2RuntimeConfig({
      ...env,
      VITE_MIDNIGHT_NETWORK: 'undeployed',
      VITE_PASSPORT_V2_API_URL: 'http://localhost:8791',
    });
    expect(parsed).toMatchObject({
      network: 'undeployed',
      referenda: [{ config: { network: 'undeployed' } }],
    });
  });

  it('accepts optional catalog lifecycle metadata and rejects a partial interval', () => {
    const parsed = parsePassportV2RuntimeConfig({
      ...env,
      VITE_CICO_REFERENDA_JSON: JSON.stringify([
        {
          ...JSON.parse(env.VITE_CICO_REFERENDA_JSON)[0],
          opened: '8 de agosto de 2026',
          deadline: '30 de agosto de 2026',
          opensAt: '2026-08-08T00:00:00Z',
          closesAt: '2026-08-30T23:59:59Z',
          eligible: '12.345',
          participation: 'Estado publicado',
        },
      ]),
    });
    expect(parsed?.referenda[0]).toMatchObject({
      opened: '8 de agosto de 2026',
      deadline: '30 de agosto de 2026',
      opensAt: '2026-08-08T00:00:00Z',
      closesAt: '2026-08-30T23:59:59Z',
      eligible: '12.345',
      participation: 'Estado publicado',
    });
    expect(() =>
      parsePassportV2RuntimeConfig({
        ...env,
        VITE_CICO_REFERENDA_JSON: JSON.stringify([
          { ...JSON.parse(env.VITE_CICO_REFERENDA_JSON)[0], opensAt: '2026-08-08T00:00:00Z' },
        ]),
      }),
    ).toThrow('both opensAt and closesAt');
  });

  it('fails closed for partial config, mainnet, or an issuer mismatch', () => {
    expect(() =>
      parsePassportV2RuntimeConfig({ VITE_PASSPORT_V2_API_URL: 'https://api.example' }),
    ).toThrow('VITE_CICO_ISSUER_ID');
    expect(() =>
      parsePassportV2RuntimeConfig({ ...env, VITE_MIDNIGHT_NETWORK: 'mainnet' }),
    ).toThrow('Preview or Undeployed');
    expect(() =>
      parsePassportV2RuntimeConfig({ ...env, VITE_CICO_ISSUER_ID_HEX: 'ff'.repeat(32) }),
    ).toThrow('does not match');
    expect(() =>
      parsePassportV2RuntimeConfig({
        ...env,
        VITE_CICO_REFERENDA_JSON: JSON.stringify([
          {
            referendumId: 'missing-copy',
            contractAddress: 'referendum-address',
            eventIdHex: '02'.repeat(32),
            organizerKeyHex: '03'.repeat(32),
            rootPublisherKeyHex: '04'.repeat(32),
            opensAtUnix: '1000',
            enrollmentClosesAtUnix: '2000',
            closesAtUnix: '3000',
            revealClosesAtUnix: '4000',
            countryPolicy: null,
            minimumAssurance: 2,
            requireAdult: true,
            validityReference: '1787659200',
          },
        ]),
      }),
    ).toThrow('title');
  });
});
