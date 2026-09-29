# ADR-009: The voter's own device counts the answer

- Status: Accepted for Wave 2 (no contract change)
- Date: 2026-09-29
- Related: [ADR-003](ADR-003-proof-relayer-and-receipts.md), [ADR-008](ADR-008-civic-pulse-and-actor-lanes.md), [Compact review](../COMPACT-REVIEW-2026-09-16.md)

## Context

Referendum V2 is commit–reveal. `castVote` seals an answer as
`persistentCommit(eventId, choice, salt)`. `revealVote(choice, salt)` later opens
that commitment and adds one to the public tally. An answer that is never
revealed is never counted.

Until now nothing in the product could reveal. The browser adapter only cast.
The one caller of `revealVote` was `scripts/count-referendum.mjs`, which takes
each voter's choice and salt on the organizer's command line. That leaves two
bad options for a real participant:

1. They never return, so their answer is never counted.
2. They hand their opening to the organizer, who then holds a per-person record
   of political answers before publication. ADR-008 rules that out.

The capability issuer also treated `revealVote` as an organizer circuit and
refused it for a citizen credential.

## Decision

1. **The device that sealed an answer is the only party that counts it.** The
   opening (choice and salt) is written to a device-local vault
   (`BallotOpeningVaultPort`) before the cast is submitted and deleted once the
   indexer confirms the count. It is never sent to CICO, the relayer or the
   organizer.
2. `CivicActionPort` gains `revealVote`. The request carries the referendum id
   and the credential authorization, never a choice or a salt.
3. `revealVote` is a **citizen circuit**. It succeeds only for whoever knows an
   opening, so the capability that sponsors its fee grants no authority. The
   CICO issuer allows it when `CICO_ACTION_ALLOWED_CIRCUITS` lists it, and the
   relayer when `RELAYER_V2_ALLOWED_CIRCUITS` lists it. `closeVote` and
   `finalizeVote` stay refused for citizen credentials.
4. **A failed cast is never overwritten by a retry.** The vault keeps every
   attempt. Only the chain can say which attempt landed, and at most one can,
   because every attempt spends the same referendum nullifier. The count uses
   the opening whose commitment is in the ballot tree.
5. The organizer's scripts keep `closeVote` and `finalizeVote`, which are
   permissionless and time-gated on-chain. They no longer need any opening.

## What this does not fix

These are properties of the deployed contract. They are stated in the product
copy and scheduled for contract v3.

| Limit | Why | Planned fix |
| --- | --- | --- |
| A count can be matched to its cast on-chain | `castVote` publishes the leaf hash of the commitment and `revealVote` discloses the commitment itself | Reveal a nullifier derived from the salt instead of the commitment |
| The choice becomes public at the count | The tally key is the disclosed choice | Inherent to commit–reveal; the copy says "not a secret ballot" |
| A late reveal is accepted until someone finalizes | `revealVote` has no `blockTimeLt(revealClosesAtUnix)` | Strict cutoff (ZK-04) |
| The scheme is not receipt-free | Whoever holds an opening can prove the choice | Receipts carry no transaction id; the opening is deleted after the count |
| On a phone the proving server sees the choice and the salt | No local proof server exists on mobile | Named on the page; wallet proving on desktop ([ADR-010](ADR-010-disclosed-hosted-proving.md)) |

## Consequences

- Answers from devices that never return are not counted. Results always show
  "counted of sealed" together.
- Clearing browser storage before the count loses the opening. The receipt
  screen says when to return and that it must be the same device.
- The operator cannot count selectively and cannot learn an answer early.
- An interrupted count is safe to repeat: if the chain already shows the
  commitment as counted, the device deletes the opening and reports it as
  counted instead of submitting again.

## Evidence

- `api/src/passport-v2/midnight-civic-action-adapter.ts`: `castVote`,
  `revealVote`, `getSealedAnswerStatus`.
- `api/src/passport-v2/midnight-civic-action-reveal.test.ts`: 13 cases covering
  the vault write order, retries, refusal states, deployment isolation and the
  already-counted path.
- `cico-service/src/action-capability-issuer.test.ts`: `revealVote` is granted
  only when allowlisted; organizer circuits remain refused.
