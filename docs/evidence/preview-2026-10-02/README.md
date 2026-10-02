# Midnight Preview: the Wave 2 test consultation, 2 October 2026

A second consultation on Midnight Preview, deployed against the credential
registry of 2 September. Every value below was observed, and every gap is
named.

## Status

**Deployed and open. No answer sealed yet.** The consultation accepts answers
until 9 October 2026, 16:00 UTC. No person has sealed or counted an answer on
Preview, and none may be claimed.

## Contracts

| Contract | Address | Block | Indexer type | Block time (UTC) |
| --- | --- | --- | --- | --- |
| `credential-registry-v1` (reused) | `9f8fe7c54d9907543cbcde82943c2be35ccb20f404e477ca2c29b8fc84a52132` | 1113399 | ContractCall | 2026-10-02T00:01:18Z |
| `referendum-v2` (new) | `862387442d89fc422fc93ae44d3e77c8c7dfaaeba76bc0cf7dc4e52f823a26f4` | 1113403 | ContractDeploy | 2026-10-02T00:01:42Z |

Confirmed by querying `contractAction(address:)` on
`https://indexer.preview.midnight.network/api/v4/graphql`, the canonical
indexer, not our own manifest. The registry row is the latest action on the
registry: the attestation of its current root, made for this consultation.

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
  receipt or a tally on Preview; any claim about proving time on a phone. No
  passport has been read for this consultation.
