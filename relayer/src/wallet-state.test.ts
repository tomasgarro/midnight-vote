import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readWalletSnapshot,
  WALLET_SNAPSHOT_VERSION,
  type WalletSnapshot,
  walletSnapshotOwner,
  writeWalletSnapshot,
} from './wallet-state.js';

let directory: string;
let path: string;

const owner = walletSnapshotOwner('preview', ['coin-key', 'encryption-key', 'night-key']);
const snapshot = (overrides: Partial<WalletSnapshot> = {}): WalletSnapshot => ({
  version: WALLET_SNAPSHOT_VERSION,
  networkId: 'preview',
  owner,
  savedAt: '2026-10-02T01:00:00.000Z',
  shielded: 'shielded-state',
  unshielded: 'unshielded-state',
  dust: 'dust-state',
  ...overrides,
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wallet-state-'));
  path = join(directory, 'nested', 'wallet-state.json');
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the saved state of a wallet', () => {
  it('comes back as it was written, for the wallet and network that wrote it', () => {
    writeWalletSnapshot(path, snapshot());

    expect(readWalletSnapshot(path, { networkId: 'preview', owner })).toEqual(snapshot());
  });

  it('is not used by another wallet', () => {
    writeWalletSnapshot(path, snapshot());
    const other = walletSnapshotOwner('preview', ['other-coin-key', 'encryption-key', 'night-key']);

    expect(other).not.toBe(owner);
    expect(readWalletSnapshot(path, { networkId: 'preview', owner: other })).toBeNull();
  });

  it('is not used on another network, even by the same keys', () => {
    writeWalletSnapshot(path, snapshot());

    expect(readWalletSnapshot(path, { networkId: 'undeployed', owner })).toBeNull();
    expect(walletSnapshotOwner('undeployed', ['coin-key', 'encryption-key', 'night-key'])).not.toBe(
      owner,
    );
  });

  it('reads as nothing when the file is missing, damaged, incomplete or of another version', () => {
    const expected = { networkId: 'preview', owner };
    expect(readWalletSnapshot(path, expected)).toBeNull();

    writeWalletSnapshot(path, snapshot());
    writeFileSync(path, '{"version":1,"networkId":"prev', 'utf8');
    expect(readWalletSnapshot(path, expected)).toBeNull();

    writeFileSync(path, JSON.stringify({ ...snapshot(), dust: '' }), 'utf8');
    expect(readWalletSnapshot(path, expected)).toBeNull();

    writeFileSync(path, JSON.stringify({ ...snapshot(), version: 2 }), 'utf8');
    expect(readWalletSnapshot(path, expected)).toBeNull();

    writeFileSync(path, 'null', 'utf8');
    expect(readWalletSnapshot(path, expected)).toBeNull();
  });

  it('replaces the previous save and leaves no temporary file behind', () => {
    writeWalletSnapshot(path, snapshot());
    writeWalletSnapshot(path, snapshot({ savedAt: '2026-10-02T02:00:00.000Z', dust: 'later' }));

    expect(readWalletSnapshot(path, { networkId: 'preview', owner })?.dust).toBe('later');
    expect(readdirSync(join(directory, 'nested'))).toEqual(['wallet-state.json']);
  });

  it('holds no key: only what the caller passed, and the public name of the wallet', () => {
    writeWalletSnapshot(path, snapshot());

    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8'))).sort()).toEqual([
      'dust',
      'networkId',
      'owner',
      'savedAt',
      'shielded',
      'unshielded',
      'version',
    ]);
    // The name is a digest. The public values it was made from are not in the file.
    expect(readFileSync(path, 'utf8')).not.toContain('coin-key');
    expect(owner).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is written for its owner only where the system has file modes', () => {
    writeWalletSnapshot(path, snapshot());

    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o077).toBe(0);
    }
  });
});
