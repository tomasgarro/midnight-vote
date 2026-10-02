# Midnight Preview: a dress rehearsal of the whole journey, 2 October 2026

Two answers went through everything a person's answer goes through on
Midnight Preview, with one part replaced: the passport scan. **No document was
read and no person answered.** A stand-in said "verified" where the passport
verifier would have checked a proof from a real chip.

Two more runs followed the same day, each on a registry of its own, and each
has a section below: a page dropped while the pass was being issued, and one
document on two devices. What stood in is the same in all three.

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

## A second run: what a phone does to a page

On a phone the person leaves the browser to scan, and the browser may drop the
page. Two faults followed from that in the app, found by reading the code
after the first run and fixed before this one:

- a verification in progress lived only in the page's memory, so a reload
  lost the secret the scan was bound to;
- the app drew the pass's validity timestamps again on every retry, and the
  credential service refuses a retry whose claims differ from the first
  request. A request cut off once left the person with a pass on chain that
  they could not hold.

The second run played both against the real service, on a second registry
(`bccc75ad9415aaa46ad1fa5a3727ab7375562c0c1579ca651a3b6a245165cfde`) and
consultation (`ac59a5352ade50f7b4029e00a63ed696a36af5715c79ecceaa63235cdf58c5ae`).

| Time | What | Block | Transaction hash |
| --- | --- | --- | --- |
| 06:35:12 | The app asks the credential service for the pass. Six seconds later the process is ended: the page is dropped | | the request was in flight |
| 06:35:18 | A new process starts on the same device. It takes up the attempt kept in the device's vault. No new scan | | no transaction |
| 06:35:24 | **One** pass is issued: the one the first request asked for. The second request was answered with it | 1117338 | `be4ea1b43611daebf5114f06735bdadcd92936aa40b823af44b42d14309dfedc` |
| 06:35:48 | Its root is attested | 1117342 | `1651b1c3a4fae3a65ff76698f028332c70ee7792555d74a89dcf85162389fa46` |
| 06:36:12 | Its root is published to the consultation | 1117346 | `ad8da70ece642823f12c3e884c30f064ed443dc5656f69b9f4a1c6545566a9c5` |
| 06:36:42 | The answer is sealed | 1117351 | `dff9bebe8bd35c838139fa52dc6d2e5491cffa899703194456d23c9a46ecde4c` |
| 06:38 | The device is made to forget that its answer was confirmed, and tries to answer again. The app finds the answer on chain and refuses at once, with `ANSWER_ALREADY_SEALED`. The first answer stands | | no transaction |
| 06:55:12 | The operator closes the consultation | 1117536 | `749942078f4369f4b987967ebef2f806770e5b458427d2225c97cdd8077e6503` |
| 06:55:48 | The device counts its answer, 29 seconds after it asked | 1117542 | `69b5fa31d76b41b97841907b6fdbace23c4ac600b06f16bae3a2b79b2c86af2a` |
| 07:07:48 | The operator finalizes: YES 1, NO 0, undecided 0 | 1117662 | `8780c440ed005d46ec15c2b9444ee98c4f1c38f15e00c16df4156ed6cd52261d` |

The registry holds two passes: the fixture the deployment added, and the one
pass of this run. The pass the device holds is valid from 06:35:12, the moment
of the first request, not of the second.

## A third run: one document, one holder

Before this run, nothing tied a pass to a document. Each verification drew a
new holder in the browser, and the contract takes one answer per holder. A
person verified in a second browser, or again the next day when the 24-hour
pass had expired, could answer an open consultation twice.
[ADR-012](../../adr/ADR-012-one-holder-per-document.md) records the rule that
closes it. This run played the rule against the real credential service, on a
third registry (`862e3d7c5662830ae5096478ef707acf8d74d8cc138a785b896473743be7c74b`,
block 1118190) and consultation
(`4ada263de79bae15f42fb7aeb9b5afa408b0073e01843e5848de62461d8845e2`, block
1118203).

The stand-in verifier was given one more thing to imitate. A real proof shows
a nullifier that is the same whenever one document is proven under one event.
The stand-in derives such a number from a label, so that "the same document"
means something: "alma" and "bruno" below are labels, not people.

| Time | What | Block | Transaction hash |
| --- | --- | --- | --- |
| 08:03:30 | Device A scans "alma". The service has not seen this document: it records the holder and issues the pass. Log: `document holder: bound` | 1118215 | `1da867454d535d71f2ef91d517b85e2e4951b4b4569cbd471d8a0af2612fb8da` |
| 08:04:18 | Its root is published to the consultation | 1118223 | `9ba2e2729a0254cde2f8ff04a00bac4c001546319d546916d8b447d8e7d35bf2` |
| 08:04:54 | Device A seals YES | 1118229 | `15d39ccbfac25a308c1e1f6afa182b007150b606705c3783c244b23de9dc8a33` |
| 08:05:21 | Device B scans "alma" too: one person, a second device. The service refuses, five seconds after the device asked, with `DOCUMENT_ALREADY_ENROLLED`. Log: `document holder: refused`. Device B holds no pass | | no transaction |
| 08:05:42 | Device A asks for a new pass although it holds one, as on the day after. Same document, same holder: the service issues it. Log: `document holder: renewed` | 1118237 | `aa3187c74657505dfbaffacdfa91c05da472761e8da00c5240d837ae8474a68c` |
| 08:06:30 | The renewed pass's root is published | 1118245 | `a03379f3bb4ebece7d9301117b8d9558a7b33dd3d1ed8693faca76d6714c918d` |
| 08:06:48 | Device A tries to answer NO with the renewed pass. The app refuses by its own record, with `ANSWER_ALREADY_SEALED` | | no transaction |
| 08:06:57 | Device A is made to lose its record of the answer, and tries again with the renewed pass. Now only the contract stands in the way. It refuses while the circuit runs on the device, before any proof: "This voter has already voted in this referendum" | | no transaction |
| 08:08:00 | Device C scans "bruno", another document. Log: `document holder: bound` | 1118260 | `d9e9967d444975030b92f69d6a14ef0c829eb2548478839536864c8866b6e463` |
| 08:08:48 | Its root is published | 1118268 | `5bcf68419994b5dc857e63651b942f6da8223e426107de7f7e8bfaac36323967` |
| 08:09:18 | Device C seals NO | 1118273 | `6a0c079201b40419e59f40c4cf7f65b80b9ff26960f2a9d7ef2f45d922ec34e7` |
| 08:51:36 | The operator closes the consultation | 1118696 | `9d7c623778e50fa08ea0bb0ec4a57ecd589af567f844c57140d32afcddaa438b` |
| 08:52:06 | Device A counts its answer, with the record that was put back | 1118701 | `47b181e216477265c166e3de8c48709460ea817365183af1ad6f9a586e7df335` |
| 08:52:36 | Device C counts its answer | 1118706 | `1f416225932c9622431f0d9870cea3cf233a38d88e843cc656640a72fd584f9b` |
| 09:06:48 | The operator finalizes: YES 1, NO 1, undecided 0 | 1118848 | `3c7ec871a2e0b68c1ba0c5f1777e82abedad9753518a640671e778ebe5a07e37` |

The registry holds four passes: the fixture the deployment added, two for
"alma" (the first and its renewal, one holder), one for "bruno". The
consultation holds two sealed answers, one per document.

The service's record of the two documents is two lines of digests. It holds
no label, no country and no holder binding in the clear.

## What it found

One fault, in the app. The wait for admission ended only when the answer was
sealed, so the screen that says "Admitting your pass" would have stayed up
through the proof. The first run's log showed it: the wait it reported was the
wait plus the sealing. The app now asks where the pass stands without building
a proof, ends the wait when it is admitted, and shows the proof screen from
then on. The second run was made with that fix.

The third run found a second one, also in the app. When the contract refused
the renewed pass, the refusal reached the journey as an unhandled error from
the runtime, a stack trace. A person would have read "the transaction
failed". The app now recognises that refusal and says what is true: the pass
has already answered, and this browser holds no record of that answer. Played
again at 08:09:53, the journey ended with `HOLDER_ALREADY_ANSWERED` after one
second, and no transaction.

## What this evidence does and does not support

- **Supports:** the credential service issues a pass on chain, publishes its
  root and signs the relay's permission; the relayer accepts that permission;
  the app's own client code completes the journey against both; an answer is
  counted later without a pass. All on a public Midnight network, with the
  configuration the server gets.
- **Supports, from the third run:** the credential service refuses a second
  holder for a document it has issued a pass for, and renews the pass of the
  first; a renewed pass cannot answer a consultation its holder has answered,
  by the app's record and, without it, by the contract.
- **Does not support:** that a real proof shows a nullifier, or the same one
  on a second scan. The stand-in was written to behave as Rarimo's circuit is
  documented to. The first two scans of a real passport show it.
- **Does not support:** that a document was verified, or that RariMe and the
  passport verifier work with this service; that a person has answered; any
  proving time on a phone or in a browser; that the two services work **on
  the server**, where memory and processor are much tighter than on the
  machine that ran them.
