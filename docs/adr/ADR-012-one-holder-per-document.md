# ADR-012: A document has one holder

- Status: Accepted for Wave 2 (no contract change)
- Date: 2026-10-02
- Related: [ADR-005](ADR-005-rarimo-evidence-boundary.md), [ADR-007](ADR-007-open-enrollment-and-evidence-roles.md), [ADR-009](ADR-009-voter-owned-reveal.md)

## Context

The product says a consultation takes one answer per verified person. The
contract enforces one answer per **holder**: an answer's nullifier is drawn from
the holder's secret and the consultation's event. Nothing tied a holder to a
document, so the sentence was not true.

Two things made it false in ordinary use, without any ill intent:

| Fact | Consequence |
| --- | --- |
| Each verification drew a new holder secret in the browser | A person verified in two browsers held two passes, and could answer twice |
| A pass lasts 24 hours, and a consultation runs for days | A person who came back the next day was verified again, got a second holder, and could answer the same open consultation again |

A third was open to anyone who changed the app's code. The browser chooses the
bounds of the verification it asks Rarimo for, and the credential service took
them on trust. A Rarimo query proof proves only the constraints its selector
switches on. So a changed client could obtain a sound proof that proved less
than the pass then said: an `18-plus` pass with the age constraint off, or a
pass for a passport registered a second time.

What Rarimo's proof gives us, from the circuit's own documentation
(`rarimo/passport-zk-circuits`, `queryIdentity.circom` and README):

- The proof can reveal a nullifier, `Poseidon(sk, Poseidon(sk), eventID)`. It
  is the same whenever one RariMe identity is proven under one event, and
  reveals nothing else.
- The nullifier follows the identity key, not the passport. Rarimo states that
  it "can be bypassed by reissuing the identity", and offers the identity
  counter and the registration timestamp as the constraints against that.
  Rarimo's own verifier service counts an identity as unique when the counter
  bound is at most 1, or when the identity was created before a fixed date
  (`CheckUniqueness` in `rarimo/verificator-svc`).

## Decision

1. **One event per registry.** Every verification is asked under an event
   derived from the registry's address and epoch (`deriveRarimoEventId`). The
   app derives it; the credential service derives it too and refuses a
   verification asked under any other.
2. **The service gives a document one holder.** Before it issues a pass, it
   looks up the proof's nullifier. Unknown: it records the holder. The same
   holder: it issues, which is a renewal. Another holder: it refuses with
   `DOCUMENT_ALREADY_ENROLLED`, before the evidence is spent and before any
   transaction. A proof that shows no nullifier is refused.
3. **A browser keeps one holder secret.** It is kept in the encrypted vault,
   apart from the pass, and outlives it. Every pass the browser is issued in
   one registry epoch has the same holder, so a renewal is recognised and the
   contract's nullifier lets that holder answer once.
4. **The service accepts one shape of verification.** The shape is written
   once (`api/src/passport-v2/rarimo-query.ts`); the app builds its request from
   it and the service checks the request against it, with its own clock:

   | Checked | So that |
   | --- | --- |
   | The selector is exactly one of two: with or without the proof of age | Every constraint below is proven, and nothing more is revealed |
   | The identity counter bound is at most 1 | A passport registered again cannot come back with a new nullifier |
   | The expiry bound is today, give or take two days | No pass for an expired passport |
   | With the proof of age, the birth-date bound is today 18 years ago | `18-plus` means 18 |
   | Without it, no birth-date bound is named | The age class of a pass follows from the bound alone |

5. **A switch.** `CICO_DOCUMENT_UNIQUENESS` is `enforce` by default. `observe`
   records and logs and refuses nothing; `off` drops points 1 and 2. Point 4 is
   not switchable.

The contract is unchanged. The rule rests on a property it already has: the
answer's nullifier follows the holder's secret, whichever pass the holder
proves with. Two simulator tests state it for a renewed pass.

## What the service keeps, and what it learns

`document-bindings.json` in the service's state directory: a SHA-256 of the
nullifier tag beside a SHA-256 of the holder's public binding. No name,
document number or country. A line cannot be traced back to a person, and an
operator cannot find one person's line.

The service already saw every holder binding it issued a pass for. What is new
is that it can tell that two passes belong to one document. It still cannot
link a pass to an answer: an answer shows a nullifier drawn from the holder's
secret, which the service never sees.

## What this does not fix

| Limit | Why |
| --- | --- |
| A pass cannot move to another browser or device | The holder secret lives in one browser's vault. A person who clears the site's data, uses private browsing, or starts in a messaging app's own browser is refused elsewhere until the registry's epoch changes |
| The operator cannot release one document | The file holds digests only. It can be kept or removed as a whole |
| The rule is the service's, not the chain's | The issuer could still issue any pass. The rule binds the people who ask, not the issuer |
| Losing `document-bindings.json` reopens the rule | Every document would be unknown again. The state directory must be kept with the wallet state |
| One registry, one epoch | A second registry knows nothing of the first |
| A person with two passports is two documents | The proof says nothing that ties them |
| A passport whose RariMe identity was registered again gets no pass | The identity counter bound excludes it. The alternative Rarimo documents, an identity created before a fixed date, is not used yet |
| Not yet observed with a real document | The rule has run against a stand-in verifier. That a real proof shows a non-zero nullifier, stable across two scans, is read from Rarimo's circuit, not yet from a run of ours. The first phone run shows it: the service logs `document holder: bound` |
| Rarimo's verifier service is read, not tested, on a repeated nullifier | `verificator-svc` refuses a second user with a known nullifier only for requests that carry its own `uniqueness` flag. The advanced request this product makes does not set it, as read from the service's source on its main branch. A renewal with a real document confirms it |

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Check a Rarimo nullifier on chain, per consultation | A contract change, and an on-chain verifier for Rarimo's proof |
| Derive the holder secret from the document | The browser never sees the document. Only RariMe does |
| Let a pass move by revoking the old one | The registry has no revocation. A contract change, for Wave 3 |
| Keep the holder secret with the Midnight Passport account | It would make a pass portable across a person's browsers. Passport does not offer key storage to an app today; this is the natural home for the secret once it does |
| Leave it to the pilot's size | The claim is on the first screen of the pitch |

## Consequences

- "One answer per verified person" is now enforced for one document in one
  registry, with the limits above. The pitch should say "per verified
  document" where precision matters.
- A person must keep to the browser they were first verified in. The app says
  so when it refuses, in three languages.
- The app and the service must agree on the registry. `npm run check:preview`
  compares the two derived events and reports a mismatch as a failure.
- An app build from before this decision asks under random events, and a
  service that enforces refuses it. The app and the service are deployed
  together.

## Evidence

- `api/src/passport-v2/rarimo-query.ts` and its tests: the one shape of
  verification, and each way around it that is refused.
- `api/src/passport-v2/crypto.ts`: `deriveRarimoEventId`.
- `api/src/passport-v2/rarimo-credential-adapter.ts`: the holder key vault, the
  event, the refusal. Tests under "one holder for every pass a device is
  issued".
- `cico-service/src/credential-issuer-service.ts`, `durable-stores.ts`,
  `rarimo-http-gateway.ts`: the binding, its store, the document tag, the
  request check. Tests in `document-holder.test.ts`,
  `rarimo-http-gateway.test.ts`, `http.test.ts`.
- `contracts/passport-v2-contracts.test.ts`: a renewed pass of the same holder
  cannot answer twice.
- `docs/evidence/preview-2026-10-02/DRESS-REHEARSAL.md`: the rule on Midnight
  Preview with a stand-in verifier.
