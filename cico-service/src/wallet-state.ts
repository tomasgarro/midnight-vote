/**
 * Keeps what a wallet has learned from the chain between two starts.
 *
 * A wallet that starts with nothing replays the whole history of the network
 * before it can pay for anything. On Preview that took about 85 minutes in
 * October 2026, and it grows with the chain. Every restart of the service paid
 * that again, including a restart that only changed one setting.
 *
 * The snapshot holds the wallet's coins and its place in the history, as the
 * wallet SDK serializes them. It holds no key. The keys are derived from the
 * seed at every start, and a restored wallet cannot spend without them. It is
 * still private: it shows what the wallet owns. So the file is written for its
 * owner only, and it is tied to one network and one wallet.
 *
 * A snapshot that cannot be used is never an error. The wallet starts with
 * nothing instead, exactly as it did before this existed.
 *
 * This file is a copy of relayer/src/wallet-state.ts. The two services share
 * no package, and the module depends on nothing. Change both together.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const WALLET_SNAPSHOT_VERSION = 1;

export interface WalletSnapshot {
  readonly version: typeof WALLET_SNAPSHOT_VERSION;
  readonly networkId: string;
  /** Says which wallet this belongs to, without being one of its keys. */
  readonly owner: string;
  readonly savedAt: string;
  readonly shielded: string;
  readonly unshielded: string;
  readonly dust: string;
}

export interface WalletSnapshotIdentity {
  readonly networkId: string;
  readonly owner: string;
}

/**
 * A stable name for a wallet on a network, from public values only. It lets a
 * start refuse a snapshot that was written by another seed.
 */
export function walletSnapshotOwner(networkId: string, publicParts: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update('midnight.vote:wallet-snapshot:v1\n');
  hash.update(`${networkId}\n`);
  for (const part of publicParts) hash.update(`${part}\n`);
  return hash.digest('hex');
}

/** The snapshot at `path` if it belongs to this wallet on this network, or null. */
export function readWalletSnapshot(
  path: string,
  expected: WalletSnapshotIdentity,
): WalletSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const snapshot = parsed as Partial<WalletSnapshot>;
  if (
    snapshot.version !== WALLET_SNAPSHOT_VERSION ||
    snapshot.networkId !== expected.networkId ||
    snapshot.owner !== expected.owner ||
    typeof snapshot.savedAt !== 'string' ||
    typeof snapshot.shielded !== 'string' ||
    typeof snapshot.unshielded !== 'string' ||
    typeof snapshot.dust !== 'string' ||
    !snapshot.shielded ||
    !snapshot.unshielded ||
    !snapshot.dust
  ) {
    return null;
  }
  return snapshot as WalletSnapshot;
}

/**
 * Writes the snapshot so that a reader sees the old file or the new one, never
 * half of either: a crash while saving must not cost the next start its state.
 */
export function writeWalletSnapshot(path: string, snapshot: WalletSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
