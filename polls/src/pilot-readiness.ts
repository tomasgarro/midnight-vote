/** Ownership describes the work, never evidence that a release gate has passed. */
export const PILOT_GATES = [
  {
    id: 'passport-account-authority',
    owner: 'upstream' as const,
    status: 'blocked' as const,
    detail:
      'Midnight Passport must expose a fresh account-authorized response or grant verifiable against enrolled account authority. The current redirect signs with a separate wallet key.',
    evidence:
      'https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/packages/connect/src/redirect/verify.ts',
  },
  {
    id: 'passport-signin-protocol',
    owner: 'upstream' as const,
    status: 'blocked' as const,
    detail:
      'Resolve the new SDK stories promising grant-free sign-in versus the scoped-grants MIP requiring a grant; publish the authoritative wire format and test vectors.',
    evidence:
      'https://github.com/midnightntwrk/midnight-passport-sdk/blob/27721ed385248e1d40d6353a8ef74a38c94951d4/docs/roadmap/stories/M6-E19-S10-E19.02-connect-sign-in-verification.md',
  },
  {
    id: 'passport-preview-accounts',
    owner: 'upstream' as const,
    status: 'blocked' as const,
    detail:
      'The current demo uses Stagenet accounts. A Preview pilot needs supported Preview account authority, or an explicitly reviewed cross-network identity scheme.',
    evidence:
      'https://github.com/midnightntwrk/passport-demo/tree/d343acf6674b7258e04cad9eb5d64c054f0dfebd',
  },
  {
    id: 'account-verifier-integration',
    owner: 'midnight.vote' as const,
    status: 'waiting-on-upstream' as const,
    detail:
      'Integrate the actual account proof, canonical code/state checks, revocation and scoped sessions when a supported account-authority response exists.',
  },
  {
    id: 'preview-contract-lifecycle',
    owner: 'midnight.vote' as const,
    status: 'unfinished' as const,
    detail:
      'Finish Ledger 9 providers, browser proving, funded fresh deployment, admission enforcement, canonical confirmation and restart-safe submission.',
  },
  {
    id: 'private-tally',
    owner: 'midnight.vote' as const,
    status: 'unfinished' as const,
    detail:
      'Prove ciphertext validity and complete-set aggregate results; document and validate decryption, privacy and liveness assumptions. This is our cryptographic design work, not an SDK blocker.',
  },
  {
    id: 'organizer-service',
    owner: 'midnight.vote' as const,
    status: 'unfinished' as const,
    detail:
      'Finish durable canonical polls and ballots, authenticated organizer roles, immutable publication and deadline enforcement.',
  },
  {
    id: 'independent-verification-operations',
    owner: 'midnight.vote' as const,
    status: 'unfinished' as const,
    detail:
      'Finish the chain/proof verifier, downloadable final records, phone proving measurements, operational monitoring and invited pilot evidence.',
  },
] as const;

export interface PassportVerificationReport {
  kind: 'midnight.vote/passport-verification/v1';
  responseSignature: 'verified';
  requestBinding: 'verified';
  accountClaim: 'matches-request';
  accountControl: 'unavailable';
  accountNetwork: 'stagenet' | 'preview';
  votingNetwork: 'preview';
  networkCompatibility: 'matches' | 'mismatch';
  authorized: false;
  blockers: readonly string[];
}
