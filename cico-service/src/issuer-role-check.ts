import { deriveRoleKey } from 'midnight-referendum-api';

export interface IssuerRoleCheckOptions {
  /** The service's registry authority secret, 32 bytes of hexadecimal. */
  readonly issuerRoleSecretHex: string;
  readonly registryContractAddress: string;
  /**
   * The issuer key the registry holds on chain, or null when the indexer knows
   * no such contract. Throws when the indexer cannot be reached.
   */
  readonly readIssuerKey: (registryContractAddress: string) => Promise<Uint8Array | null>;
  readonly warn?: (message: string) => void;
}

/**
 * Checks, before the wallet starts, that this service is the issuer of the
 * registry it is configured for.
 *
 * The registry adds a pass only for the holder of its issuer secret. With
 * another secret every issuance would be refused inside the circuit, after a
 * person had scanned their passport. The key the secret derives is compared
 * with the one the registry published, so a wrong secret stops the service at
 * start, with a line that names the variable.
 *
 * An indexer that cannot be reached proves nothing either way. The service
 * then starts and says that the check did not run.
 */
export async function checkIssuerRole(
  options: IssuerRoleCheckOptions,
): Promise<'matches' | 'not-checked'> {
  const secret = Uint8Array.from(options.issuerRoleSecretHex.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  const expected = deriveRoleKey('cico:registry:issuer:', secret);
  let onChain: Uint8Array | null;
  try {
    onChain = await options.readIssuerKey(options.registryContractAddress);
  } catch (error) {
    options.warn?.(
      `the registry's issuer key could not be read, so CICO_ISSUER_ROLE_SECRET was not checked: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return 'not-checked';
  }
  if (!onChain) {
    throw new Error(
      `The registry ${options.registryContractAddress} has no state on the indexer: check CICO_REGISTRY_CONTRACT_ADDRESS`,
    );
  }
  if (!equalBytes(onChain, expected)) {
    throw new Error(
      `CICO_ISSUER_ROLE_SECRET is not the issuer of the registry ${options.registryContractAddress}: ` +
        'the key it derives is not the issuer key the registry holds. No pass could be issued',
    );
  }
  return 'matches';
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
