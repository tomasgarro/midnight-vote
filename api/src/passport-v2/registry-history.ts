/**
 * Where the credential registry gained each pass, read from the public indexer.
 *
 * A consultation admits registry roots one at a time, and the registry moves
 * on with every pass. To prove a pass against the last root a consultation
 * admitted, the device needs the registry as it was then. The indexer keeps
 * every state; this port tells the device which blocks to ask for.
 *
 * The request names the registry contract, which is public and the same for
 * everyone. It carries nothing about the person or their pass. The device
 * then asks the indexer for some of those blocks, and stops at the root it
 * will prove against. That root becomes public with the sealed answer, so the
 * indexer learns nothing the chain does not show, except which network address
 * asked.
 */
export interface CredentialRegistryHistoryPort {
  /** Block heights at which the registry gained a pass, newest first. */
  credentialBlockHeights(
    registryContractAddress: string,
    limit: number,
  ): Promise<readonly number[]>;
}

export interface IndexerRegistryHistoryOptions {
  /** The indexer's GraphQL endpoint over HTTP. */
  readonly indexerUri: string;
  readonly fetchImpl?: typeof fetch;
}

const ACTIONS_QUERY = `query RegistryActions($address: HexEncoded!, $limit: Int!) {
  contract(address: $address) {
    actions(limit: $limit) {
      __typename
      ... on ContractCall { entryPoint }
      transaction { block { height } }
    }
  }
}`;

/** The registry circuit that adds a leaf. Every other one leaves the root as it was. */
const ADD_CREDENTIAL = 'addCredential';

/** How many registry actions one lookup reads. Each pass costs about two. */
const MAX_ACTIONS = 200;

export function createIndexerRegistryHistory(
  options: IndexerRegistryHistoryOptions,
): CredentialRegistryHistoryPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async credentialBlockHeights(registryContractAddress, limit) {
      if (!/^[0-9a-f]{64}$/iu.test(registryContractAddress)) {
        throw new TypeError('The registry contract address must be 32 bytes of hexadecimal');
      }
      if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be positive');
      const response = await fetchImpl(options.indexerUri, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: ACTIONS_QUERY,
          variables: {
            address: registryContractAddress.toLowerCase(),
            // Attestations sit between the passes, so read more actions than passes wanted.
            limit: Math.min(MAX_ACTIONS, limit * 4),
          },
        }),
      });
      if (!response.ok) throw new Error(`The indexer answered ${response.status}`);
      const body = (await response.json()) as {
        readonly errors?: readonly unknown[];
        readonly data?: { readonly contract?: { readonly actions?: readonly unknown[] } | null };
      };
      if (body.errors?.length) throw new Error('The indexer refused the registry history query');
      const heights: number[] = [];
      for (const action of body.data?.contract?.actions ?? []) {
        const { entryPoint, transaction } = action as {
          readonly entryPoint?: unknown;
          readonly transaction?: { readonly block?: { readonly height?: unknown } };
        };
        const height = transaction?.block?.height;
        if (entryPoint !== ADD_CREDENTIAL) continue;
        if (typeof height !== 'number' || !Number.isSafeInteger(height) || height < 0) {
          throw new Error('The indexer returned a registry action without a block height');
        }
        if (!heights.includes(height)) heights.push(height);
      }
      // Newest first, whatever order the indexer used.
      return heights.sort((left, right) => right - left).slice(0, limit);
    },
  };
}
