import { deriveRoleKey } from 'midnight-referendum-api';
import { describe, expect, it, vi } from 'vitest';
import { checkIssuerRole } from './issuer-role-check.js';

const registry = 'ab'.repeat(32);
const secretHex = '22'.repeat(32);
const issuerKey = deriveRoleKey('cico:registry:issuer:', new Uint8Array(32).fill(0x22));

describe('checking the issuer secret against the registry on chain', () => {
  it('passes when the secret derives the key the registry holds', async () => {
    const readIssuerKey = vi.fn(async () => issuerKey);
    await expect(
      checkIssuerRole({
        issuerRoleSecretHex: secretHex,
        registryContractAddress: registry,
        readIssuerKey,
      }),
    ).resolves.toBe('matches');
    expect(readIssuerKey).toHaveBeenCalledWith(registry);
  });

  it('stops the service when the registry was deployed for another issuer', async () => {
    const attempt = checkIssuerRole({
      issuerRoleSecretHex: '23'.repeat(32),
      registryContractAddress: registry,
      readIssuerKey: async () => issuerKey,
    });
    await expect(attempt).rejects.toThrow(
      `CICO_ISSUER_ROLE_SECRET is not the issuer of the registry ${registry}`,
    );
    // The refusal names the variable, never its value.
    await expect(attempt).rejects.not.toThrow('23'.repeat(32));
  });

  it('stops the service when the indexer knows no such registry', async () => {
    await expect(
      checkIssuerRole({
        issuerRoleSecretHex: secretHex,
        registryContractAddress: registry,
        readIssuerKey: async () => null,
      }),
    ).rejects.toThrow('check CICO_REGISTRY_CONTRACT_ADDRESS');
  });

  it('lets the service start, and says so, when the indexer cannot be reached', async () => {
    const warnings: string[] = [];
    await expect(
      checkIssuerRole({
        issuerRoleSecretHex: secretHex,
        registryContractAddress: registry,
        readIssuerKey: async () => {
          throw new Error('fetch failed');
        },
        warn: (message) => warnings.push(message),
      }),
    ).resolves.toBe('not-checked');
    expect(warnings).toEqual([
      "the registry's issuer key could not be read, so CICO_ISSUER_ROLE_SECRET was not checked: fetch failed",
    ]);
  });
});
