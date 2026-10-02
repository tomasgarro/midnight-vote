# Midnight Preview: the Wave 2 test consultation, 2 October 2026

A second consultation on Midnight Preview, deployed against the credential
registry of 2 September. Every value below was observed, and every gap is
named.

## Status

**Deployed and open. No answer sealed yet.** The consultation accepts answers
until 9 October 2026, 16:00 UTC. No person has sealed or counted an answer on
Preview, and none may be claimed.

Rehearsals were run the same night, on other consultations. None of their
answers is a person's, and none is in this consultation.

| Document | What it rehearsed |
| --- | --- |
| [REHEARSAL.md](REHEARSAL.md) | One consultation from a sealed answer to a final tally, with a fixture pass |
| [REHEARSAL-2.md](REHEARSAL-2.md) | A pass answering after later passes changed the registry's root; a pass that is too new, and one that is too late, refused before a proof. It also records the root this consultation was given afterwards |
| [DRESS-REHEARSAL.md](DRESS-REHEARSAL.md) | The credential service and the relay end to end, on a registry of its own, with a stand-in for the passport scan. Three runs: the whole journey; a page dropped while the pass was being issued; one document on two devices, and a renewed pass |

## Rehearsal contracts

Each was deployed, used and finalized by the operator on 2 October 2026. None
holds a person's answer.

| Rehearsal | Contract | Address | Block |
| --- | --- | --- | --- |
| 1 | `referendum-v2` | `1a01b1afe280aab0c08fabe5a3699ed7b0ff0d80b8a20d0983b03948fbbe5030` | 1114976 |
| 2 | `referendum-v2` | `9f7ebe9d972a8d0794ee1448317ad619970713fb1f62f7c30263795299f90be8` | 1115944 |
| 3, no answer | `referendum-v2` | `01605dc5536d6c61497c23b6c96536bae38d205a62545469803e19d513beae80` | 1115975 |
| Dress, run 1 | `credential-registry-v1` | `bbc0b63a6b44b3c617effc95272d0ae651d3854c3dca6f985aa62de46c33b387` | 1116397 |
| Dress, run 1 | `referendum-v2` | `8321bb113995bcb5921a3b1f7fdc59509c682497efbbfd11b0b4c38154afca17` | 1116410 |
| Dress, run 2 | `credential-registry-v1` | `bccc75ad9415aaa46ad1fa5a3727ab7375562c0c1579ca651a3b6a245165cfde` | 1117309 |
| Dress, run 2 | `referendum-v2` | `ac59a5352ade50f7b4029e00a63ed696a36af5715c79ecceaa63235cdf58c5ae` | 1117327 |
| Dress, run 3 | `credential-registry-v1` | `862e3d7c5662830ae5096478ef707acf8d74d8cc138a785b896473743be7c74b` | 1118190 |
| Dress, run 3 | `referendum-v2` | `4ada263de79bae15f42fb7aeb9b5afa408b0073e01843e5848de62461d8845e2` | 1118203 |

Rehearsals 1 to 3 use the shared registry. Each dress run has a registry of
its own.

After the second rehearsal the registry this consultation uses holds two
passes. Both are fixtures held by the operator. This consultation admits the
root that holds both.

## Contracts

| Contract | Address | Block | Indexer type | Block time (UTC) |
| --- | --- | --- | --- | --- |
| `credential-registry-v1` (reused) | `9f8fe7c54d9907543cbcde82943c2be35ccb20f404e477ca2c29b8fc84a52132` | 1113399 | ContractCall | 2026-10-02T00:01:18Z |
| `referendum-v2` (new) | `862387442d89fc422fc93ae44d3e77c8c7dfaaeba76bc0cf7dc4e52f823a26f4` | 1113403 | ContractDeploy | 2026-10-02T00:01:42Z |

Confirmed by querying `contractAction(address:)` on
`https://indexer.preview.midnight.network/api/v4/graphql`, the canonical
indexer, not our own manifest. The registry row is the attestation of the
registry's current root, made for this consultation. The registry itself was
deployed on 2 September 2026, at block 683016.

| Transaction | Hash as the indexer reports it |
| --- | --- |
| Root attestation on the registry | `0f552c90f7413ca4c425a6e2cfe49d17dea86fc93e90dff2ae3c3593e00e0c64` |
| Deployment of the consultation | `84a31fbc5b6ccbe979f93a740a5a870ce61ba76002dd6375b2c342141591e7fb` |

## The consultation

| | |
| --- | --- |
| Question | Should the result of a consultation stay hidden until it closes? |
| Who can answer | Adults, with a document read by its chip. No country rule |
| Opens | 2026-10-01T21:51:38Z |
| A pass can be added until | 2026-10-09T15:00:00Z |
| Answers close | 2026-10-09T16:00:00Z |
| An answer can be counted until | 2026-10-12T16:00:00Z |
| Enrolment | Open: the registry keeps admitting passes while the consultation runs |

## Transcript

| Step | Status | What it means here |
| --- | --- | --- |
| `registry.deploy` | reconciled | The existing registry was joined, not deployed again |
| `registry.issue` | reconciled | The fixture pass of 2 September is still the only credential (count 1) |
| `registry.attest` | confirmed | The registry's current root was attested |
| `referendum.deploy` | confirmed | The consultation was deployed with that root |

Source commit `30392fe828a8807d5f68eb8b2d8a8f558d268025` plus the working
changes of that night to `scripts/deploy-passport-v2.mjs`, which were
committed afterwards on the same branch. The compiled contracts are byte for
byte those of 2 September: their artifact hashes equal the ones recorded in
that manifest.

The manifest's status is `in-progress` on purpose. It was written by the
deploy command in its `prepare` mode, which deploys and stops: it casts no
fixture answer, so the lifecycle steps that an evidence run records (cast,
close, count, finalize) are absent.

## Read back by the app

The app, built in Preview mode against this manifest, lists the consultation
as open, shows its three deadlines and "0 sealed answers", and states that the
public state is read from Midnight. The count comes from the contract through
the public indexer.

## What this evidence does and does not support

- **Supports:** a second consultation deployed on a public Midnight network
  against an existing registry; the app reading its state from the chain.
- **Does not support:** any claim of a sealed answer, a counted answer, a
  receipt or a tally in this consultation; any claim about proving time on a
  phone. No passport has been read for this consultation.
