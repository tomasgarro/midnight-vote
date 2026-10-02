# Midnight Preview: a rehearsal from sealing to the final tally, 2 October 2026

One consultation was taken through its whole life on Midnight Preview: deployed,
answered once, closed, counted and finalized. It was a rehearsal. **The one
answer was sealed by the operator with a fixture pass. No person answered, and
no passport was read.**

## Why it was run

To find what breaks before a person stands there with a passport. The answer
was sealed and counted through `MidnightCivicActionAdapter`, the adapter the
app runs in the browser: the check of the consultation against the chain, the
membership path, the proof, the relay, the opening kept on the device, and the
count by the device that sealed it. It found one fault, described below.

## What is real, and what is not

| Part | In this rehearsal |
| --- | --- |
| The network, the two contracts, every transaction | Real: Midnight Preview |
| The proofs | Real: built by Midnight's proof server on the operator's machine |
| The relay that paid the fees | The relayer of this repository, run on the operator's machine, not the one on the server |
| The pass | **A fixture.** Issued by the operator when the registry was deployed on 2 September. No document was read for it |
| The relay's permission to sponsor the answer | **Signed by the operator's own secret.** In production the credential service signs it, and only for a pass it issued |
| The person | **None.** The operator ran a script |

For those reasons the script runs only on a consultation whose slug starts
with `rehearsal`, and such a consultation is left out of the values that reach
the app and the servers. A consultation that people answer never receives a
fixture answer.

## The consultation

| | |
| --- | --- |
| Contract | `1a01b1afe280aab0c08fabe5a3699ed7b0ff0d80b8a20d0983b03948fbbe5030` |
| Registry | `9f8fe7c54d9907543cbcde82943c2be35ccb20f404e477ca2c29b8fc84a52132` (the same as the test consultation) |
| Title | Rehearsal with a fixture pass |
| Question | Does the journey run from sealing an answer to counting it? |
| A pass could be added until | 2026-10-02T02:58:00Z |
| Answers closed | 2026-10-02T03:02:00Z |
| An answer could be counted until | 2026-10-02T03:32:00Z |

## Its life on chain

Every row is an action of the contract as the public indexer lists it
(`contract(address:) { actions }` on
`https://indexer.preview.midnight.network/api/v4/graphql`).

| Step | Circuit | Block | Block time (UTC) | Transaction hash |
| --- | --- | --- | --- | --- |
| Deployed | deploy | 1114976 | 02:39:00 | `164c495fc4d8d3c6cdf0f2f608bf198ad6e47b7079c5455ee9469ee80e118fa6` |
| Answer sealed | `castVote` | 1115037 | 02:45:06 | `75664768a7b6aa27f0bb7a1296bb8e7da3468440e05fb3ef7b78a91683a34ee9` |
| Closed by the operator | `closeVote` | 1115232 | 03:04:36 | `a14942ad409e14dc42c3d5a7c47571e9f14e7512301643cdf9a8cdad2bdb39b4` |
| Answer counted | `revealVote` | 1115242 | 03:05:36 | `690a0c201cf4b08280766aac667c93a738ac5e73d4d6559515e21cef09db3cb5` |
| Finalized by the operator | `finalizeVote` | 1115536 | 03:35:00 | `062830dc80abcaf334d1395dabd8384a490ceae53f8933984813dd559137700d` |

Before the deployment, the registry's current root was attested for this
consultation: block 1114972, transaction
`ed5748b086c8360106dd3b1f6fb93a9dd2eb31ff756070e82159f9e83ade219a`.

The contract's state after the last step: phase `FINALIZED`, closed, one
sealed answer, tally YES 1, NO 0, undecided 0.

## What was observed

| Observation | Value |
| --- | --- |
| Sealing, from the request to the confirmed transaction | 34 seconds |
| Counting, the same way | 34 seconds |
| Counting before the close | Refused with `REVEAL_NOT_OPEN`, as designed |
| The operator command before a deadline | Printed the deadline and ended; it changed nothing |
| The operator command after the closing time | Closed the consultation |
| The operator command after the counting deadline | Finalized it |
| The app, built against this consultation | Showed "1 sealed answer" while it was open, and "1 counted of 1 sealed" after the count, in English, Spanish and French |

The 34 seconds are a laptop with Midnight's proof server. They say nothing
about a phone building the proof in the browser.

## The fault it found

The first attempt to seal brought the relayer down. A file rename failed on
Windows while the relayer recorded the action, the error was not handled, and
the process exited. The answer was not sealed and nothing was spent.

Fixed in the same branch: one failed action is now recorded as needing
recovery and the relayer keeps serving; the rename is retried; a test covers
it. The second attempt sealed the answer in the table above. The relayer image
on the server was rebuilt with the fix (`0.2.2`).

## What this evidence does and does not support

- **Supports:** the contracts, the relay and the app's own action code carry
  an answer from sealing to a final tally on a public Midnight network; the
  schedule is enforced on chain; the operator's command closes and finalizes.
- **Does not support:** that a person has answered a consultation on Preview;
  that a passport was verified; any proving time on a phone; that the relay
  and the credential service on the server work, since neither took part.
