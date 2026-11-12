import { randomToken } from './crypto.js';

export interface AccountChallenge {
  id: string;
  nonce: string;
  account: string;
  network: string;
  origin: string;
  purpose: 'connect' | 'organizer' | 'vote';
  pollId?: string;
  expiresAt: number;
}
export interface AccountControlProofVerifier {
  /** Verify actual enrolled account authority, not a signature by a self-selected key. */
  verify(challenge: AccountChallenge, proof: unknown): Promise<boolean>;
}
export class UnsupportedAccountControl implements AccountControlProofVerifier {
  async verify(): Promise<boolean> {
    return false;
  }
}

/** Challenges stay server-side. Consuming before verification also prevents concurrent replay. */
export class AccountAuthorization {
  private readonly challenges = new Map<string, AccountChallenge>();
  constructor(
    private readonly verifier: AccountControlProofVerifier,
    private readonly origin: string,
    private readonly now: () => number = Date.now,
  ) {}
  challenge(
    input: Pick<AccountChallenge, 'account' | 'network' | 'purpose' | 'pollId'>,
  ): AccountChallenge {
    for (const [id, existing] of this.challenges)
      if (existing.expiresAt <= this.now()) this.challenges.delete(id);
    if (this.challenges.size >= 1000) throw new Error('Too many outstanding challenges.');
    if (
      !input.account ||
      input.account.length > 512 ||
      !['stagenet', 'preview'].includes(input.network) ||
      !['organizer', 'vote'].includes(input.purpose)
    )
      throw new Error('Invalid account challenge.');
    if (input.purpose === 'vote' && !/^[a-zA-Z0-9_-]{1,80}$/.test(input.pollId ?? ''))
      throw new Error('Voting authority must name a poll.');
    const challenge: AccountChallenge = Object.freeze({
      account: input.account,
      network: input.network,
      purpose: input.purpose,
      ...(input.pollId ? { pollId: input.pollId } : {}),
      id: randomToken(),
      nonce: randomToken(),
      origin: this.origin,
      expiresAt: this.now() + 300_000,
    });
    this.challenges.set(challenge.id, challenge);
    return { ...challenge };
  }
  async authorize(id: string, proof: unknown): Promise<AccountChallenge> {
    const challenge = this.challenges.get(id);
    this.challenges.delete(id);
    if (!challenge || challenge.expiresAt <= this.now())
      throw new Error('Account challenge expired or already used.');
    if (!(await this.verifier.verify({ ...challenge }, proof)))
      throw new Error('Midnight Passport account control could not be verified.');
    return { ...challenge };
  }
}
