import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountChallenge } from './authority.js';

/** Server-only. Each consume/nonce claim is one atomic SQLite write across processes. */
export class PassportVerificationStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS passport_challenges (
        id TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, challenge TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS passport_challenge_expiry ON passport_challenges(expires_at);
      CREATE INDEX IF NOT EXISTS passport_challenge_browser ON passport_challenges(browser_hash);
      CREATE TABLE IF NOT EXISTS passport_nonces (
        nonce_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS passport_nonce_expiry ON passport_nonces(expires_at);
    `);
  }
  prune(now: number): void {
    this.db.prepare('DELETE FROM passport_challenges WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM passport_nonces WHERE expires_at <= ?').run(now);
  }
  put(challenge: AccountChallenge, browserHash: string, now: number): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.prune(now);
      const counts = this.db
        .prepare(
          'SELECT COUNT(*) AS total, COUNT(CASE WHEN browser_hash = ? THEN 1 END) AS own FROM passport_challenges',
        )
        .get(browserHash) as { total: number; own: number };
      if (counts.total >= 1000 || counts.own >= 5)
        throw new Error('Too many verification requests.');
      this.db
        .prepare('INSERT INTO passport_challenges VALUES (?, ?, ?, ?)')
        .run(challenge.id, browserHash, JSON.stringify(challenge), challenge.expiresAt);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  take(id: string, browserHash: string, now: number): AccountChallenge | null {
    const row = this.db
      .prepare(
        'DELETE FROM passport_challenges WHERE id = ? AND browser_hash = ? RETURNING challenge, expires_at',
      )
      .get(id, browserHash) as { challenge: string; expires_at: number } | undefined;
    if (!row || row.expires_at <= now) return null;
    return JSON.parse(row.challenge) as AccountChallenge;
  }
  claimNonce(nonceHash: string, expiresAt: number): boolean {
    return (
      this.db
        .prepare('INSERT OR IGNORE INTO passport_nonces VALUES (?, ?)')
        .run(nonceHash, expiresAt).changes === 1
    );
  }
  close(): void {
    this.db.close();
  }
}
