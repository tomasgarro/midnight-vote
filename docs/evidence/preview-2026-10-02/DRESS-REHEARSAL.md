# Midnight Preview: a dress rehearsal of the whole journey, 2 October 2026

Two answers went through everything a person's answer goes through on
Midnight Preview, with one part replaced: the passport scan. **No document was
read and no person answered.** A stand-in said "verified" where the passport
verifier would have checked a proof from a real chip.

## Why it was run

The two earlier rehearsals used a fixture pass and signed the relay's
permission with the operator's own secret. They left out the credential
service: the part that issues a pass on chain after a verification, publishes
its root to the consultations, and signs the permission the relay asks for. No
evidence in this repository showed that service doing any of it on Preview.

This rehearsal runs the service itself, and the relayer, as they are built for
the server.

## What ran for real, and what stood in

| Part | In this rehearsal |
| --- | --- |
| The network, the contracts, every transaction | Real: Midnight Preview |
| The credential service and the relayer | Real code of this repository, started on the operator's machine with the configuration the server gets: the same variables, the same allowlists, the app's origin |
| The client | The app's own code, run in Node: its HTTP ports to the credential service, its country catalogue, its credential adapter, its action adapter, its wait for admission |
| The permission the relay checks | Signed by the credential service, for a pass it had issued itself |
| The proofs | Real: built by Midnight's proof server on the operator's machine, not by a phone |
| **The passport verifier and the scan** | **A stand-in on loopback.** It answers the four routes the credential service calls and says "verified". It checked nothing |
| **Midnight Passport sign-in** | **A session object.** The sign-in was not exercised |
| **The people** | **None.** The operator ran a script twice, as two devices |

## A registry of its own

A pass that follows from the stand-in proves nothing about anybody, so it must
not sit beside people's passes. The rehearsal deployed its own registry and one
consultation on it. The registry people use was not touched, and the script
refuses to run against it.

| | Address | Deployed at block |
| --- | --- | --- |
| Rehearsal registry | `bbc0b63a6b44b3c617effc95272d0ae651d3854c3dca6f985aa62de46c33b387` | 1116397 |
| Rehearsal consultation: "Does the whole journey run, from a pass to a counted answer?" | `8321bb113995bcb5921a3b1f7fdc59509c682497efbbfd11b0b4c38154afca17` | 1116410 |

The consultation admitted passes until 05:25:59 UTC, took answers until
05:35:59 and counted until 05:55:59.

## What happened, in order

Every row is an action as the public indexer lists it
(`contract(address:) { actions }` on
`https://indexer.preview.midnight.network/api/v4/graphql`). Times are block
times, UTC.

| Time | What | Who sent it | Block | Transaction hash |
| --- | --- | --- | --- | --- |
| 05:01:18 | Registry deployed | operator | 1116397 | `978197894310f934981c95e0c0b76d477e059df968ac319f0f9d7ca0affaf68c` |
| 05:01:48 | A fixture pass is added, so the consultation has a first root | operator | 1116402 | `fdaf8fc7f972ae01178743d2e7ccf29eeda36af3ac003ed8e66689d5475835c7` |
| 05:02:12 | That root is attested | operator | 1116406 | `d9dcaa0107396ee2212cd47798c0c142001e27d2f75de950c9a0306d41af4935` |
| 05:02:36 | Consultation deployed | operator | 1116410 | `d82323b2a1fc4ec909d0324264aaa0ace911f457a0fb7bb7b7c851e15393167f` |
| 05:03:36 | **First pass issued**, after a stand-in scan of a Swiss document | credential service | 1116420 | `e3fa974d21d042fdd1401dfef02c50bee1b27147f0c2989a05a0891dbc25628e` |
| 05:04:00 | Its root is attested | credential service | 1116424 | `09dab3842a0c98b0314637b2e60aa3a26527b1d53854c808a98f2751becaba19` |
| 05:04:24 | Its root is published to the consultation | credential service | 1116428 | `2496223ebc803d86fcd5fc96b24fc08fa77ed4a903614a11d6b81cd96464e001` |
| 05:05:00 | **First answer sealed** | relayer | 1116434 | `9f0699eccb4aaf114a659283a0a255571a25b7742bddd01047316f21a7a11ad1` |
| 05:10:36 | **Second pass issued**, after a stand-in scan of a French document, from a second device | credential service | 1116490 | `c6028cd5347a4e9355e5587d84ac580a33cb41f5fdbc697bd30293b4022eb49e` |
| 05:11:00 | Its root is attested | credential service | 1116494 | `fa37bde929bb9fc195ffeb0ac4a4c5403f18b17f9c3bd090055423347dbd0b20` |
| 05:11:24 | Its root is published to the consultation | credential service | 1116498 | `047cdef904693e2cb667e7e549428c75a6b6a8b73a80375c48b6a2a083beb5e0` |
| 05:11:54 | **Second answer sealed** | relayer | 1116503 | `02d149449d3b871d69f87169b481ca626dc2a36e56a585f12ebffe6048e24138` |
| 05:38:00 | Consultation closed | operator | 1116764 | `a85bcf051c732711384bd154af8e0cf6dd74353802ced3aafddff2306250b2b2` |
| 05:38:36 | First answer counted | relayer | 1116770 | `1ab6ba113d009c1b6c0bda8ec20d6117c6f140e81b7144e7edeed82fe114c116` |
| 05:39:12 | Second answer counted | relayer | 1116776 | `4e81c35c651cf25d31cc98c0e24c2ce3c4d1b5bf6cb51b84322a7f84d5a065e3` |
| 06:00:06 | Consultation finalized | operator | 1116985 | `81f204be8cc2a935fe59eabdc643ba7ec13369968c36ded7241f091721a77529` |

The contract's state at the end: phase `FINALIZED`, closed, two sealed answers,
tally YES 1, NO 1, undecided 0, three accepted roots.

## What was observed

| Observation | Value |
| --- | --- |
| The credential service's check of its own role secrets at start | Passed: `issuer role secret matches the registry on chain` |
| From the scan to a pass on chain | 30 and 29 seconds |
| From a pass on chain to its root published to the consultation | 48 seconds both times: an attestation, then a publication |
| The publisher started by itself when the pass was issued | Yes. It did not wait for its one-minute tick |
| The app's wait for admission | It asked, was told "pending", waited, and sealed when told "admitted". Measured the second time: 52 seconds |
| Sealing once admitted, with the credential service's permission | 27 seconds |
| Counting, from a device that holds no pass any more | 30 seconds each. The permission is asked for with the authorization kept beside the sealed answer |
| Two passes of different countries | The registry and the consultation hold three roots; each answer was proven against a root that held its pass |

The times are a laptop's. On the server the same transactions run on two
shared cores, and each one is paid from one wallet, one at a time.

## What it found

One fault, in the app. The wait for admission ended only when the answer was
sealed, so the screen that says "Admitting your pass" would have stayed up
through the proof. The first run's log showed it: the wait it reported was the
wait plus the sealing. The app now asks where the pass stands without building
a proof, ends the wait when it is admitted, and shows the proof screen from
then on. The second run was made with that fix.

## What this evidence does and does not support

- **Supports:** the credential service issues a pass on chain, publishes its
  root and signs the relay's permission; the relayer accepts that permission;
  the app's own client code completes the journey against both; an answer is
  counted later without a pass. All on a public Midnight network, with the
  configuration the server gets.
- **Does not support:** that a document was verified, or that RariMe and the
  passport verifier work with this service; that a person has answered; any
  proving time on a phone or in a browser; that the two services work **on
  the server**, where memory and processor are much tighter than on the
  machine that ran them.
