# ADR-010: Disclosed hosted proving for browsers without a wallet

- Status: Accepted for Wave 2 (no contract change). Amended the same day by
  [ADR-011](ADR-011-on-device-proving.md): hosted proving is a choice, and the
  device is the default
- Date: 2026-09-29
- Related: [ADR-003](ADR-003-proof-relayer-and-receipts.md), [ADR-009](ADR-009-voter-owned-reveal.md)

## Context

A Midnight transaction needs a zero-knowledge proof, and building it needs the
private inputs. Until now the app had exactly two places to build one:

1. **Inside Lace**, through `getProvingProvider`. This is the browser path.
2. **A proof server next to a Node script**, for operators and tests.

A phone has neither. Lace is a desktop browser extension, and a phone cannot run
a local proof server. The relay provider refused to compose in a browser without
a wallet, so a person on a phone could read a consultation and hold a pass but
could never seal an answer. The app is mobile-first, so this blocked the main
journey.

**Correction.** This record first said that no browser prover existed. One
does: Midnight's WASM prover. ADR-011 adds it and makes it the default. Hosted
proving remains for a person who prefers a fast proof, or whose device cannot
finish one, and who accepts the disclosure below.

## Decision

1. Add a third execution mode, `sponsored-hosted-proving`, beside
   `direct-wallet` and `sponsored-wallet`. It needs no wallet. The proof is
   built by a proving server that the operator runs.
2. The mode is **opt-in per person and cannot be reached by configuration
   alone**. Its options carry `hostedProving: { proofServerUri,
   disclosureAccepted: true }`. The provider checks the flag at run time as well
   as in the type, so a config file or a cast cannot switch it on.
3. The interface sets the flag only after it has shown the disclosure below and
   the person has accepted it. The runtime exposes `provingParty`
   (`wallet`, `hosted-server` or `operator`) so screens and receipts name who
   built the proof instead of inferring it.
4. A wallet always wins. Hosted proving cannot be combined with a Lace API or
   with a second proof server. On desktop with Lace the proof stays in the
   wallet.
5. The proving server address must be HTTPS. Plain HTTP is accepted for
   localhost only.

## What the proving server sees

This is the cost of the mode. It is stated to the person before they accept.

| Action | Private inputs sent to the proving server |
| --- | --- |
| Seal an answer (`castVote`) | The pass secret and its opening, the membership path, the answer, the salt |
| Count an answer (`revealVote`) | The answer and the salt |

With those inputs the operator of the proving server can, while the request is
in memory:

- **learn the answer** before publication and tie it to a network address;
- **link the person's answers** across consultations, because the pass secret
  derives every referendum nullifier;
- **answer in the person's place** in a consultation they have not answered yet.
  The contract cannot tell a proof built for the person from a proof built by
  someone who holds their secret.

So in this mode the operator is trusted for privacy **and** for integrity. The
mode does not weaken what the public chain shows: the ledger still records only
a nullifier and a commitment.

## Disclosure text

The interface uses this wording, or a translation of it, and nothing softer:

> Your phone cannot build the proof on its own. If you continue, our proving
> server builds it. While it works, that server can see your answer and your
> pass secret. We do not store or log them. On a computer with the Lace wallet,
> the proof is built on your device instead.

The app never says that an answer "never leaves your phone".

## Operating rules for the proving server

| Rule | Reason |
| --- | --- |
| Its own container, separate from the relayer and from the relayer's proof server | The relayer sees addresses and transactions; it must not also see witnesses |
| Read-only file system, `tmpfs` for `/tmp`, no volume | Nothing can be written to disk |
| No verbose flag; the reverse proxy logs no request bodies | The witness is the request body |
| CORS allows the app's origin only; no cookies or credentials | The endpoint is public and unauthenticated |
| Rate limit per address at the proxy | Proving is CPU-heavy and the host has 2 cores |

These rules reduce what an honest operator retains. They do not make a
dishonest operator safe, and the disclosure does not claim that they do.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Proving in the browser (WASM) | Adopted in ADR-011 as the default. It takes minutes, so hosted proving stays as the fast, disclosed choice |
| A mobile wallet | No Lace build for phones that exposes the dApp connector |
| Midnight Passport as the prover | Passport runs on stagenet and ledger 9; its dApp connection is unfinished |
| Desktop only | Removes the mobile journey that the product is built around |
| Split the witness across two non-colluding provers | Needs MPC proving support that Midnight does not ship |

## Consequences

- A phone can seal and count an answer on Preview.
- The privacy claim now has two tiers, and the product says which one applies:
  wallet proving (the operator learns nothing) and hosted proving (the operator
  is trusted while proving).
- Results can report how many answers were built in each tier, because the
  runtime records the proving party locally. The tier is not written on-chain.
- The mode is a choice beside on-device proving (ADR-011). It is removed once
  the device prover is fast enough on phones that nobody needs the server.

## Evidence

- `api/src/passport-v2/midnight-v2-relayer-providers.ts`: `HostedProvingOptions`,
  `ProvingParty`, the checks in `createReferendumV2WalletlessProviders`.
- `api/src/passport-v2/midnight-v2-provider-runtime.ts`:
  `sponsored-hosted-proving` in `REFERENDUM_V2_EXECUTION_MODES`.
- `api/src/passport-v2/midnight-v2-relayer-providers.test.ts`: the mode composes
  only with the literal flag, refuses plain HTTP, and refuses a wallet or a
  second proof server.
- `api/src/passport-v2/midnight-v2-provider-runtime.test.ts`: the mode composes
  without a wallet and reports `hosted-server`.
