import { describe, expect, it, vi } from 'vitest';
import { createIndexerRegistryHistory } from './registry-history.js';

const registry = 'ab'.repeat(32);
const indexerUri = 'https://indexer.test/api/v4/graphql';

function action(entryPoint: string | null, height: number) {
  return entryPoint === null
    ? { __typename: 'ContractDeploy', transaction: { block: { height } } }
    : { __typename: 'ContractCall', entryPoint, transaction: { block: { height } } };
}

function indexer(actions: readonly unknown[]) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({ data: { contract: { actions } } }),
  );
}

describe('registry history from the public indexer', () => {
  it('returns the blocks where a pass was added, newest first', async () => {
    const fetchImpl = indexer([
      action('attestCurrentRoot', 50),
      action('addCredential', 40),
      action('attestCurrentRoot', 31),
      action('addCredential', 30),
      action('addCredential', 20),
      action(null, 10),
    ]);
    const history = createIndexerRegistryHistory({ indexerUri, fetchImpl });
    await expect(history.credentialBlockHeights(registry, 10)).resolves.toEqual([40, 30, 20]);
  });

  it('orders the blocks itself and honours the limit', async () => {
    const fetchImpl = indexer([
      action('addCredential', 20),
      action('addCredential', 40),
      action('addCredential', 30),
    ]);
    const history = createIndexerRegistryHistory({ indexerUri, fetchImpl });
    await expect(history.credentialBlockHeights(registry, 2)).resolves.toEqual([40, 30]);
  });

  it('lists a block once when two passes landed in it', async () => {
    const fetchImpl = indexer([action('addCredential', 40), action('addCredential', 40)]);
    const history = createIndexerRegistryHistory({ indexerUri, fetchImpl });
    await expect(history.credentialBlockHeights(registry, 5)).resolves.toEqual([40]);
  });

  it('sends the registry address and nothing about a person', async () => {
    const fetchImpl = indexer([]);
    const history = createIndexerRegistryHistory({ indexerUri, fetchImpl });
    await history.credentialBlockHeights(registry.toUpperCase(), 3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(indexerUri);
    const sent = JSON.parse(String(init?.body)) as { variables: Record<string, unknown> };
    expect(sent.variables).toEqual({ address: registry, limit: 12 });
    expect(Object.keys(init?.headers ?? {})).toEqual(['content-type']);
  });

  it('answers with no blocks for a registry the indexer does not know', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { contract: null } }));
    const history = createIndexerRegistryHistory({ indexerUri, fetchImpl });
    await expect(history.credentialBlockHeights(registry, 5)).resolves.toEqual([]);
  });

  it('fails loudly on an indexer error instead of guessing', async () => {
    const down = createIndexerRegistryHistory({
      indexerUri,
      fetchImpl: vi.fn(async () => new Response('', { status: 502 })),
    });
    await expect(down.credentialBlockHeights(registry, 5)).rejects.toThrow('502');
    const refused = createIndexerRegistryHistory({
      indexerUri,
      fetchImpl: vi.fn(async () => Response.json({ errors: [{ message: 'no' }] })),
    });
    await expect(refused.credentialBlockHeights(registry, 5)).rejects.toThrow('refused');
    const malformed = createIndexerRegistryHistory({
      indexerUri,
      fetchImpl: indexer([{ entryPoint: 'addCredential', transaction: { block: {} } }]),
    });
    await expect(malformed.credentialBlockHeights(registry, 5)).rejects.toThrow('block height');
  });

  it('refuses a malformed address or limit before any request', async () => {
    const fetchImpl = indexer([]);
    const history = createIndexerRegistryHistory({ indexerUri, fetchImpl });
    await expect(history.credentialBlockHeights('not-an-address', 5)).rejects.toThrow('32 bytes');
    await expect(history.credentialBlockHeights(registry, 0)).rejects.toThrow('positive');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
