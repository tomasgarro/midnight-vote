import { describe, expect, it } from 'vitest';
import { LEDGER9_STACK, previewConfiguration, requireFreshDeployment } from './index.js';

describe('restart runtime boundary', () => {
  it('rejects historical deployments and accidental mainnet configuration', () => {
    expect(() => previewConfiguration('mainnet')).toThrow('Preview');
    expect(previewConfiguration('preview')).toEqual({ networkId: 'preview', ttlSeconds: 3600 });
    expect(LEDGER9_STACK.compiler).toBe('0.36.0');
    expect(() =>
      requireFreshDeployment({
        era: 'v8',
        sourceRevision: 'a'.repeat(40),
        networkGeneration: 'preview-2026-09',
        contractAddress: '1'.repeat(64),
      }),
    ).toThrow('fresh');
  });
});
