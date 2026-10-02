# Midnight Preview: an earlier pass answers after the registry has moved on, 2 October 2026

A second rehearsal on Midnight Preview. It shows on chain that a pass which a
consultation admitted can still answer after later passes changed the
registry's root, and that a pass which came too late is refused before any
proof is built. **Both passes are fixtures held by the operator. No person
answered, and no passport was read.**

## Why it was run

The registry is shared by every consultation and keeps enrolling. Each pass
gives it a new root, and a consultation admits roots one at a time. The app
used to take the membership path from the registry as it is now. So a person
could answer only while the newest root was admitted:

- when several people get a pass one after another, each waited for the root
  of the last one;
- once a consultation stopped admitting passes, the next pass issued for any
  other consultation locked out everybody who had enrolled in time and had
  not answered yet.

The contract never asked for the newest root. It takes a proof against any
root it admitted. The app now builds the proof against the newest admitted
root that already holds the pass, and finds the registry's earlier state on
the public indexer. This rehearsal ran that on the real chain.

## What is real, and what is not

| Part | In this rehearsal |
| --- | --- |
| The network, the contracts, every transaction | Real: Midnight Preview |
| The proofs | Real: built by Midnight's proof server on the operator's machine |
| The relay | The relayer of this repository, on the operator's machine |
| The two passes | **Fixtures.** The first was issued on 2 September. The second was issued for this rehearsal. No document was read for either |
| The relay's permission to sponsor | **Signed by the operator's own secret**, not by the credential service |
| The people | **None.** The operator ran a script |

The second fixture pass is in the registry that people's passes will join.
The operator holds its secrets, as it holds the first one's. It is a second
pass that no person owns, and it is named here so that the registry's count
can be read correctly: after this rehearsal the registry holds two passes, and
both are fixtures.

## The contracts

| | Address | Deployed at block |
| --- | --- | --- |
| Registry (shared) | `9f8fe7c54d9907543cbcde82943c2be35ccb20f404e477ca2c29b8fc84a52132` | 683016 |
| Rehearsal 2: "Can a pass still answer after later passes changed the registry's root?" | `9f7ebe9d972a8d0794ee1448317ad619970713fb1f62f7c30263795299f90be8` | 1115944 |
| Rehearsal 3: deployed with the second pass | `01605dc5536d6c61497c23b6c96536bae38d205a62545469803e19d513beae80` | 1115975 |

Rehearsal 2 admitted passes until 04:30:00 UTC, took answers until 04:42:00
and counted until 04:58:00.

## What happened, in order

Every transaction is an action as the public indexer lists it
(`contract(address:) { actions }` on
`https://indexer.preview.midnight.network/api/v4/graphql`). Times are block
times, UTC.

| Time | What | Where | Block | Transaction hash |
| --- | --- | --- | --- | --- |
| 04:16:00 | Rehearsal 2 deployed. It admits one root: the registry with the first pass | rehearsal 2 | 1115944 | `9c23fc631272ea73797a3fd9f80aef0556aea2ceb7ed9742740684384a20fb10` |
| 04:18:18 | The second pass is added. The registry has a new root | registry | 1115967 | `40249fdaa32db7a60971a0adfd891e57e46c7e92cd1c287f8ba35b15240ee70c` |
| 04:19:06 | Rehearsal 3 deployed with the new root. Nothing publishes that root to rehearsal 2 | rehearsal 3 | 1115975 | `6beb3d430e835353b04470f0ab2a895f6a1489f9c58743c56efef34f6bc45d78` |
| 04:19 | The second pass tries to answer rehearsal 2. Refused on the device: `CREDENTIAL_NOT_ADMITTED`, worth retrying | none | | no transaction |
| 04:20:18 | **The first pass answers rehearsal 2.** The registry's current root is not admitted; the proof is built against the earlier one | rehearsal 2 | 1115987 | `f985af83332609728d0db277d0234c283ca46d5dc984964fbe66bd397ce9033f` |
| 04:31 | After the deadline for passes, the second pass tries again. Refused on the device in two seconds: `CREDENTIAL_ADMISSION_CLOSED` | none | | no transaction |
| 04:44:24 | The operator closes rehearsal 2 | rehearsal 2 | 1116228 | `6cc99bf65906099cf03a0870ffb5a331f8fb09adcb6fe3e5ee34e4f37b49578d` |
| 04:45:00 | The first pass's answer is counted | rehearsal 2 | 1116234 | `8ece373d33adb77a51643f0bcc5f9365352399910e99f64bd0a01a2173ef2459` |
| 04:45:42 | The operator closes rehearsal 3 | rehearsal 3 | 1116241 | `4e6aedc250866ddef87a24c0477cc0c26430d65935b4346c5fbf60520b17b535` |
| 04:59:48 | Rehearsal 2 finalized | rehearsal 2 | 1116382 | `89a654d8e95b1e190a093b25c0b35aae1470b1ab31ef9502a4bea58200d39b73` |
| 05:00:24 | Rehearsal 3 finalized | rehearsal 3 | 1116388 | `74c9778baf31516187993dd8e70e95f3a8dc44b517e82d24b14c6f2185a26497` |

Rehearsal 2 at the end: phase `FINALIZED`, one sealed answer, tally YES 0,
NO 1, undecided 0. It admitted one root throughout. Rehearsal 3 received no
answer.

## What it shows

| Observation | Value |
| --- | --- |
| A pass in an admitted root answers while the registry's current root is not admitted | Yes: block 1115987. Rehearsal 2 held one accepted root before and after |
| How the device found the earlier state | One query to the public indexer for the blocks where a pass was added, then the registry's state at those blocks, newest first |
| Sealing, from the request to the confirmed transaction, lookup included | 41 seconds |
| A pass no admitted root holds, while the consultation still admits passes | Refused before a proof: not admitted yet, try again |
| The same pass after the consultation stopped admitting passes | Refused before a proof: it came too late. Waiting will not help, and the app says so |
| Counting the answer | 31 seconds |

## The test consultation afterwards

The second fixture pass also moved the root of the registry the test
consultation uses. That consultation still admits passes, so its root
publisher owes it the new root. The credential service was started on the
operator's machine with the configuration the server will have, and published
it:

| Time | What | Block | Transaction hash |
| --- | --- | --- | --- |
| 04:49:30 | The registry's current root is attested | 1116279 | `cfd57210e0e1339722570bb4c82a159a4b14e7a1932ff16fe1c3f751b190da20` |
| 04:50:00 | The root is published to the test consultation | 1116284 | `d0e07f2ca66f6fcf93d6ad9bdc0bbead1da9456f1c0646fb40df00397fb9640f` |

The test consultation `862387442d89fc422fc93ae44d3e77c8c7dfaaeba76bc0cf7dc4e52f823a26f4`
now admits every pass issued so far. It still holds no answer.

## What this evidence does and does not support

- **Supports:** on a public Midnight network, a consultation takes an answer
  proven against an earlier root it admitted; the app finds that root by
  itself; a pass that is too new or too late is refused on the device, with
  two different reasons; the credential service's root publisher attests and
  publishes a root.
- **Does not support:** that a person has answered a consultation on Preview;
  that a passport was verified; any proving time on a phone; that the relay
  and the credential service **on the server** work, since the ones that ran
  were on the operator's machine.
