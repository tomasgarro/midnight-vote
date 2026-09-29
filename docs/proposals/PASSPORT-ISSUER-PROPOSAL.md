# An external issuer for Midnight Passport, built from a working registry

- Status: **Draft. Not posted.** Tomas approves the text before it goes to
  `midnightntwrk/passport`.
- Date: 2026-09-29
- From: midnight.vote (Midnight Buildathon, Wave 2)
- For: the Midnight Passport team

## Summary

Passport's roadmap lists credential issuance (C19) as open and names external
issuers as the way to fill it. We run an issuer today. It turns a passport
chip proof into an anonymous credential on Midnight, and a contract checks
that credential without learning who holds it.

We offer what we built and measured as input to C18 to C21. We ask three
questions at the end.

## What runs today

All of it is open source under Apache-2.0 and compiles with Compact 0.31.1
(language 0.23, ledger 8), the version Preview runs.

| Part | What it does | Where |
| --- | --- | --- |
| Credential registry | An append-only Merkle tree of depth 16. One leaf per credential. The issuer can add leaves until it freezes the tree | `contracts/credential-registry-v1` |
| Credential leaf | `persistentCommit` over eight fields, with a blind: a domain tag, a holder binding, the issuer, country, age class, assurance level, epoch and expiry | `credentialLeaf()` |
| Holder binding | `persistentCommit([tag, holderSecret], holderBlind)`. The issuer receives the binding. It never receives the holder's secret or blind | `api/src/passport-v2/crypto.ts` |
| Issuer | Verifies a Rarimo passport chip proof (Groth16), then adds the leaf | `cico-service` |
| Verifier contract | Checks membership against a set of accepted roots, checks the policy, and spends a nullifier | `contracts/referendum-v2`, `castVote` |
| Nullifier | `persistentHash([tag, holderSecret, eventId])`. One per person per consultation | `castVote` |

The verifier checks these predicates inside the circuit. None of the values is
disclosed.

| Predicate | Form |
| --- | --- |
| The holder owns the credential | The holder binding opens with the holder's secret |
| The credential is in the registry | Its Merkle root is in the accepted set |
| Country | Equals the policy value, when the policy is on |
| Adult | Age class equals the adult class, when required |
| Assurance | At least the policy minimum |
| Not expired | Expiry is at or after the policy's reference time |

28 simulator tests cover the two contracts.

## How it maps to the roadmap

| Component | Our counterpart | Difference |
| --- | --- | --- |
| C18 Attestation tree | `credentials: MerkleTree<16, Bytes<32>>` in the registry | Our leaf commits to claims and a holder binding. C18 sketches a leaf over the user's secret key alone |
| C19 Credential issuance | The issuer service and `addCredential` | One issuer, one tree. Evidence comes from a passport chip |
| C20 Selective-disclosure proof | The policy checks in `castVote` | Compact circuits over Merkle membership (alternative A). Equality and range predicates |
| C21 Nullifier | The vote nullifier | Per-context (alternative A). The context is the consultation's event id |
| C23 dApp connection | Not built. We use the profile protocol for sign-in only | We would adopt the grant ceremony once it reaches a public network |

## What we can answer from evidence

| Open question | What we found |
| --- | --- |
| C18: tree depth | Depth 16 holds 65,536 credentials. The membership proof is 16 hashes and is a small part of the circuit |
| C18: update model | One issuer wallet adds leaves in sequence. It holds one DUST coin, so it sends one transaction at a time and waits for each to confirm |
| C18: proof staleness | Real. A root changes with every new leaf. Our verifier keeps a *set* of accepted roots. That is safe because the tree is append-only: an older root never admits someone the newest root would reject |
| C18: one tree or shared | One tree per issuer was simple to attribute and to freeze. We have not tried a shared tree |
| C19: issuance privacy | The issuance transaction shows that a leaf was added, and when. It shows no claim and no identity. The issuer itself learns the claims and a pseudonymous identifier from the chip proof |
| C19: issuer revocation | The verifier can revoke an accepted root for good. It cannot revoke one leaf. Per-leaf revocation needs a second structure |
| C20: predicates | Set membership, equality and range all worked in Compact without special support |
| C20: proof cost | See the table below |
| C21: nullifier shape | Per-context. The same person is unlinkable across two consultations |
| C21: nullifier storage | On-chain, in a `Set<Bytes<32>>` in the verifier. Simple, and anyone can audit it |

### Measured cost of one credential proof

The `castVote` circuit holds the membership proof, all six predicates, the
nullifier and a ballot commitment.

| Measure | Value |
| --- | --- |
| Circuit size | k = 15 |
| Prover key | 10.0 MB |
| Proof | 4,501 bytes |
| Proving time, native proof server | not yet measured on our server |
| Proving time, in a browser (WASM, one thread, Chromium 152, Ryzen 7 7735HS) | 1 min 55 s |
| Memory while proving in WASM | about 400 MB above baseline |

The browser figure uses `@midnight-ntwrk/zkir-v2` 2.1.0 in a worker, as your
browser-proving note describes. It confirms that the user can be the prover
for a credential proof of this size, on a laptop. We have not measured a phone.

## Limits we hit

These may matter for Passport's design.

1. **No cross-contract call.** The verifier cannot ask the registry whether a
   root is genuine. We attest the root on the registry and pair the two
   transactions by reference. An auditor can detect a forged root. The chain
   does not prevent one.
2. **The issuer can link.** The issuer sees a pseudonymous identifier from the
   chip proof and, in our sponsored-fee flow, the request that leads to the
   transaction. A blind capability would remove the second link. We have not
   built it.
3. **A credential expires before its use ends.** Our credentials last days.
   Some uses, such as a count weeks after an answer, outlive them.
4. **Evidence is only as good as its source.** A passport chip proves a
   document, not residence and not the right to vote.

## What we ask

1. **Is a Passport on Preview planned, and when?** Passport runs on stagenet
   and ledger 9. Our contracts run on Preview and ledger 8. Today Passport
   gives us a session and a display name, and cannot hold our credential.
2. **Would Passport hold the holder secret?** Our credential binds to a secret
   that lives in the browser. If a Passport account supplied that secret, or a
   key derived for our origin, the credential would follow the account across
   devices. Which component would own this: C16, or the grant in C10?
3. **What should an external issuer conform to?** A leaf schema, a domain
   separator registry (we saw ADR-0001), an attestation format. We would
   rather match yours than keep our own.

## What we can contribute

- Test vectors for the leaf, the holder binding and the nullifier, with a
  TypeScript implementation that matches the Compact circuits bit for bit.
- The issuer service as a reference for C19, with its threat notes.
- The measurements above, repeated on phones and on your benchmark corpus.
- A working end-to-end case on Preview for any issuer interface you draft.
