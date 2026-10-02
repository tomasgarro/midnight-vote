import { resolve } from 'node:path';
import { deriveRoleKey, padBytes32 } from 'midnight-referendum-api';
import { describe, expect, it } from 'vitest';
import { loadCicoServiceConfig } from './config.js';

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const ROOT_PUBLISHER_SECRET_HEX = '77'.repeat(32);

const validReferendum = {
  contractAddress: 'referendum-address',
  eventIdHex: '44'.repeat(32),
  organizerKeyHex: '55'.repeat(32),
  // The public key of the root-publisher secret below, as a deployment records it.
  rootPublisherKeyHex: hex(
    deriveRoleKey('cico:ref-v2:root-publisher:', new Uint8Array(32).fill(0x77)),
  ),
  initialRootField: '123456789',
  countryPolicy: null,
  minimumAssurance: '2',
  requireAdult: true,
  validityReference: '1700000000',
  opensAtUnix: '1700000000',
  enrollmentClosesAtUnix: '1700003600',
  closesAtUnix: '1700007200',
  revealClosesAtUnix: '1700010800',
};

const valid = {
  CICO_ALLOWED_ORIGINS: 'http://localhost:4173',
  CICO_RARIMO_BASE_URL: 'https://verificator.example',
  CICO_ISSUER_ID: 'cico-rarimo-preview',
  CICO_ISSUER_ID_HEX: hex(padBytes32('cico-rarimo-preview')),
  CICO_CREDENTIAL_EPOCH: '7',
  CICO_ISSUER_WALLET_SEED: '11'.repeat(32),
  CICO_ISSUER_ROLE_SECRET: '22'.repeat(32),
  CICO_ROOT_PUBLISHER_SECRET_HEX: ROOT_PUBLISHER_SECRET_HEX,
  CICO_ZK_CONFIG_PATH: '/tmp/credential-registry-v1',
  CICO_REGISTRY_CONTRACT_ADDRESS: 'registry-address',
  CICO_REGISTRY_ID_HEX: '33'.repeat(32),
};

describe('CICO service configuration', () => {
  it('loads a Preview-only configuration without exposing secret values', () => {
    const config = loadCicoServiceConfig(valid);
    expect(config.issuerRuntime.networkId).toBe('preview');
    expect(config.allowedOrigins).toEqual(['http://localhost:4173']);
    expect(config.rarimoProofParamsAllowedOrigins).toEqual(['https://verificator.example']);
    expect(config.issuerRuntime.issuerSeedHex).toBe(valid.CICO_ISSUER_WALLET_SEED);
    expect(config.rootPublisherSecretHex).toBe(valid.CICO_ROOT_PUBLISHER_SECRET_HEX.toLowerCase());
    expect(config.referenda).toEqual([]);
  });

  it('rejects mainnet, mismatched public issuer IDs, and reused secrets', () => {
    expect(() => loadCicoServiceConfig({ ...valid, CICO_NETWORK: 'mainnet' })).toThrow(
      'Preview-only',
    );
    expect(() => loadCicoServiceConfig({ ...valid, CICO_ISSUER_ID: 'attacker' })).toThrow(
      'does not match',
    );
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_ISSUER_ROLE_SECRET: valid.CICO_ISSUER_WALLET_SEED,
      }),
    ).toThrow('must be independent');
  });

  it('rejects a root-publisher secret equal to the issuer role secret or wallet seed', () => {
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_ROOT_PUBLISHER_SECRET_HEX: valid.CICO_ISSUER_ROLE_SECRET,
      }),
    ).toThrow('must be independent');
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_ROOT_PUBLISHER_SECRET_HEX: valid.CICO_ISSUER_WALLET_SEED,
      }),
    ).toThrow('must be independent');
  });

  it('requires the referendum zk config path only when referenda are configured', () => {
    // The issuer runtime's zk config is rooted at the credential registry's
    // artifacts, so proving a referendum circuit through it would fail at
    // runtime while compiling cleanly. Missing keys must fail at startup:
    // otherwise enrolled voters are silently never admitted.
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_REFERENDA_JSON: JSON.stringify([validReferendum]),
      }),
    ).toThrow('CICO_REFERENDUM_ZK_CONFIG_PATH is required');
    expect(loadCicoServiceConfig({ ...valid }).referendumZkConfigPath).toBeNull();
  });

  it('resolves the referendum zk config path separately from the registry one', () => {
    // referendum-v2 circuits are compiled into their own managed directory;
    // resolving both to the same place would mean publishCredentialRoot keys
    // are looked for under the registry's artifacts.
    const config = loadCicoServiceConfig({
      ...valid,
      CICO_REFERENDA_JSON: JSON.stringify([validReferendum]),
      CICO_REFERENDUM_ZK_CONFIG_PATH: 'contracts/referendum-v2/managed/referendum-v2',
    });
    expect(config.referendumZkConfigPath).toBe(
      resolve('contracts/referendum-v2/managed/referendum-v2'),
    );
    expect(config.referendumZkConfigPath).not.toBe(config.issuerRuntime.zkConfigBasePath);
  });

  it('yields an empty referenda list when CICO_REFERENDA_JSON is absent or empty', () => {
    expect(loadCicoServiceConfig(valid).referenda).toEqual([]);
    expect(loadCicoServiceConfig({ ...valid, CICO_REFERENDA_JSON: '' }).referenda).toEqual([]);
    expect(loadCicoServiceConfig({ ...valid, CICO_REFERENDA_JSON: '[]' }).referenda).toEqual([]);
  });

  it('parses a valid referenda entry, including every schedule field', () => {
    const config = loadCicoServiceConfig({
      ...valid,
      CICO_REFERENDA_JSON: JSON.stringify([validReferendum]),
      CICO_REFERENDUM_ZK_CONFIG_PATH: 'contracts/referendum-v2/managed/referendum-v2',
    });
    expect(config.referenda).toHaveLength(1);
    const referendum = config.referenda[0];
    if (!referendum) throw new Error('expected one parsed referendum');
    expect(referendum.contractAddress).toBe('referendum-address');
    expect(hex(referendum.eventId)).toBe(validReferendum.eventIdHex);
    expect(hex(referendum.organizerKey)).toBe(validReferendum.organizerKeyHex);
    expect(hex(referendum.rootPublisherKey)).toBe(validReferendum.rootPublisherKeyHex);
    expect(referendum.initialRootField).toBe(123456789n);
    expect(referendum.countryPolicy).toBeNull();
    expect(referendum.minimumAssurance).toBe(2n);
    expect(referendum.requireAdult).toBe(true);
    expect(referendum.validityReference).toBe(1700000000n);
    expect(referendum.opensAtUnix).toBe(1700000000n);
    expect(referendum.enrollmentClosesAtUnix).toBe(1700003600n);
    expect(referendum.closesAtUnix).toBe(1700007200n);
    expect(referendum.revealClosesAtUnix).toBe(1700010800n);
  });

  it('parses a non-null countryPolicy entry', () => {
    const config = loadCicoServiceConfig({
      ...valid,
      CICO_REFERENDA_JSON: JSON.stringify([{ ...validReferendum, countryPolicy: '840' }]),
      CICO_REFERENDUM_ZK_CONFIG_PATH: 'contracts/referendum-v2/managed/referendum-v2',
    });
    expect(config.referenda[0]?.countryPolicy).toBe('840');
  });

  it('rejects a referenda entry missing a required field', () => {
    const { eventIdHex: _eventIdHex, ...withoutEventId } = validReferendum;
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_REFERENDA_JSON: JSON.stringify([withoutEventId]),
      }),
    ).toThrow('eventIdHex');
  });

  it('rejects a referenda entry with a badly formed hex field', () => {
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_REFERENDA_JSON: JSON.stringify([{ ...validReferendum, organizerKeyHex: 'not-hex' }]),
      }),
    ).toThrow('32-byte hexadecimal');
  });

  it('rejects a referenda entry with a non-numeric schedule field', () => {
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_REFERENDA_JSON: JSON.stringify([{ ...validReferendum, opensAtUnix: 'not-a-number' }]),
      }),
    ).toThrow('unsigned decimal string');
  });

  it('rejects a referenda entry whose schedule is out of order', () => {
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_REFERENDA_JSON: JSON.stringify([
          { ...validReferendum, enrollmentClosesAtUnix: '1600000000' },
        ]),
      }),
    ).toThrow('schedule must satisfy');
  });

  it('rejects a referenda entry whose rootPublisherKeyHex equals organizerKeyHex', () => {
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_REFERENDA_JSON: JSON.stringify([
          { ...validReferendum, rootPublisherKeyHex: validReferendum.organizerKeyHex },
        ]),
      }),
    ).toThrow('must not equal organizerKeyHex');
  });

  it('refuses to start with a root-publisher secret a consultation would not accept', () => {
    // The consultation was deployed for another publisher. Every root this
    // service offered it would be refused, and no new pass could answer.
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_REFERENDUM_ZK_CONFIG_PATH: 'contracts/referendum-v2/managed/referendum-v2',
        CICO_REFERENDA_JSON: JSON.stringify([
          validReferendum,
          {
            ...validReferendum,
            contractAddress: 'other-consultation',
            rootPublisherKeyHex: '66'.repeat(32),
          },
        ]),
      }),
    ).toThrow(
      'CICO_ROOT_PUBLISHER_SECRET_HEX is not the root publisher of the consultation other-consultation',
    );
    expect(() =>
      loadCicoServiceConfig({
        ...valid,
        CICO_ROOT_PUBLISHER_SECRET_HEX: '78'.repeat(32),
        CICO_REFERENDUM_ZK_CONFIG_PATH: 'contracts/referendum-v2/managed/referendum-v2',
        CICO_REFERENDA_JSON: JSON.stringify([validReferendum]),
      }),
    ).toThrow('is not the root publisher of the consultation referendum-address');
  });

  it('never repeats a secret in the refusal', () => {
    try {
      loadCicoServiceConfig({
        ...valid,
        CICO_ROOT_PUBLISHER_SECRET_HEX: '78'.repeat(32),
        CICO_REFERENDA_JSON: JSON.stringify([validReferendum]),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(String(error)).not.toContain('78'.repeat(32));
    }
  });

  it('rejects malformed CICO_REFERENDA_JSON', () => {
    expect(() => loadCicoServiceConfig({ ...valid, CICO_REFERENDA_JSON: '{not json' })).toThrow(
      'valid JSON',
    );
    expect(() => loadCicoServiceConfig({ ...valid, CICO_REFERENDA_JSON: '{}' })).toThrow(
      'JSON array',
    );
  });
});
