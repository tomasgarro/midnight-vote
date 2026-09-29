import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const controlledVariables = [
  'RELAYER_SEED',
  'RELAYER_V2_ALLOWED_CIRCUITS',
  'RELAYER_V2_SUBMIT_DELAY_MAX_MS',
  'RELAYER_LEGACY_API_ENABLED',
] as const;
const originalValues = Object.fromEntries(
  controlledVariables.map((name) => [name, process.env[name]]),
) as Record<(typeof controlledVariables)[number], string | undefined>;

beforeEach(() => {
  for (const name of controlledVariables) delete process.env[name];
  process.env.RELAYER_SEED = 'ab'.repeat(32);
});

afterEach(() => {
  for (const name of controlledVariables) {
    const value = originalValues[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('relayer configuration boundaries', () => {
  it('disables the legacy transaction API by default and requires an explicit opt-in', () => {
    expect(loadConfig().legacyApiEnabled).toBe(false);
    process.env.RELAYER_LEGACY_API_ENABLED = 'true';
    expect(loadConfig().legacyApiEnabled).toBe(true);
  });

  it('rejects ambiguous legacy API flags', () => {
    process.env.RELAYER_LEGACY_API_ENABLED = 'yes';
    expect(() => loadConfig()).toThrow('RELAYER_LEGACY_API_ENABLED must be either');
  });

  it('carries sealing by default, and the count when it is allowlisted', () => {
    expect(loadConfig().v2AllowedCircuits).toEqual(['castVote']);
    process.env.RELAYER_V2_ALLOWED_CIRCUITS = 'castVote, revealVote';
    expect(loadConfig().v2AllowedCircuits).toEqual(['castVote', 'revealVote']);
  });

  it.each([
    ['castVote,closeVote'],
    ['castVote,revealVote,finalizeVote'],
    ['addCredential'],
    ['castVote,castVote'],
    [','],
  ])('fails closed when the public v2 relay is configured with "%s"', (circuits) => {
    process.env.RELAYER_V2_ALLOWED_CIRCUITS = circuits;
    expect(() => loadConfig()).toThrow(
      'public v2 relayer may allow only the citizen circuits castVote and revealVote',
    );
  });

  it('submits at once by default and accepts a bounded random wait', () => {
    expect(loadConfig().v2SubmitDelayMaxMs).toBe(0);
    process.env.RELAYER_V2_SUBMIT_DELAY_MAX_MS = '20000';
    expect(loadConfig().v2SubmitDelayMaxMs).toBe(20_000);
  });

  it.each([['-1'], ['1.5'], ['60001'], ['soon'], ['1e3']])(
    'rejects a submit delay of "%s"',
    (value) => {
      process.env.RELAYER_V2_SUBMIT_DELAY_MAX_MS = value;
      expect(() => loadConfig()).toThrow('RELAYER_V2_SUBMIT_DELAY_MAX_MS must be a whole number');
    },
  );
});
