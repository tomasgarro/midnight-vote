/** The restart runtime is separate from the retained Ledger 8 consultation demo. */
export * from './transaction-boundary.js';
export const LEDGER9_STACK = Object.freeze({
  era: 'v9',
  compiler: '0.36.0',
  language: '0.28.0',
  compactRuntime: '0.21.0',
  compactJs: '3.0.0',
  platformJs: '3.0.0',
  midnightJs: '5.0.0',
  walletSdk: '2.0.0',
  connector: '4.1.0',
  ledgerPackage: '1.0.0',
  onchainRuntime: '4.0.0',
  zkir: '2.2.0',
  node: '2.1.101',
  indexer: '4.4.101',
  proofServer: '9.0.0',
});

export function previewConfiguration(networkId: string) {
  if (networkId !== 'preview')
    throw new Error('The restart runtime targets Midnight Preview only.');
  return Object.freeze({ networkId, ttlSeconds: 3600 });
}

/** Previously deployed Preview manifests must not be reused following the reset. */
export function requireFreshDeployment(deployment: {
  era: string;
  sourceRevision: string;
  networkGeneration: string;
  contractAddress: string;
}) {
  if (
    deployment.era !== 'v9' ||
    deployment.networkGeneration !== 'preview-ledger9-2026-11' ||
    !/^[a-f0-9]{40}$/.test(deployment.sourceRevision) ||
    !/^[a-f0-9]{64}$/.test(deployment.contractAddress)
  )
    throw new Error('A fresh, source-bound Ledger 9 Preview deployment is required.');
  return Object.freeze({ ...deployment });
}
