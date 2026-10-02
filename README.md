# midnight.vote

**Understand more. Disclose less. Participate as yourself.**

midnight.vote is a Passport-first civic participation project built on Midnight. Its vision brings together **selective disclosure**, **verified citizen participation** and **AI-assisted understanding**: prove that you meet a participation rule without handing over your whole identity, understand the proposal, then make your own choice.

**Submission status:** a working simulated product and reviewable Compact contracts and integration services. Midnight Passport is in its stagenet-beta phase; the physical NFC-to-counted-vote journey is an integration milestone, not a completed public deployment. Consultations are non-binding.

[Try midnight.vote](https://midnight.vote) · [Public Docs](https://midnight.vote/docs) · [Submission brief](docs/SUBMISSION.md) · [Run locally](docs/QUICKSTART.md) · [All documentation](docs/README.md)

## On Midnight Preview

A credential registry and two consultations are deployed on Midnight's public test network. One consultation is open now. The other was a rehearsal, taken from a sealed answer to a final tally.

| Contract | Address | Deployed |
| --- | --- | --- |
| `credential-registry-v1` | `9f8fe7c54d9907543cbcde82943c2be35ccb20f404e477ca2c29b8fc84a52132` | 2 September 2026, block 683016 |
| `referendum-v2`: "Should the result of a consultation stay hidden until it closes?" | `862387442d89fc422fc93ae44d3e77c8c7dfaaeba76bc0cf7dc4e52f823a26f4` | 2 October 2026, block 1113403 |
| `referendum-v2`: the rehearsal, finalized | `1a01b1afe280aab0c08fabe5a3699ed7b0ff0d80b8a20d0983b03948fbbe5030` | 2 October 2026, block 1114976 |

Check either one against the network's own indexer, not against this repository:

```bash
curl -s https://indexer.preview.midnight.network/api/v4/graphql -H 'content-type: application/json' -d '{"query":"{ contractAction(address: \"862387442d89fc422fc93ae44d3e77c8c7dfaaeba76bc0cf7dc4e52f823a26f4\") { __typename transaction { hash block { height } } } }"}'
```

| | State on 2 October 2026 |
| --- | --- |
| The consultation | Open until 9 October 2026, 16:00 UTC. Any adult with a passport read by its chip may answer |
| The app in Preview mode | Reads the consultation and its count of sealed answers from the chain |
| The whole life of a consultation on chain | Rehearsed once: sealed, closed, counted and finalized, with a fixture pass held by the operator. [Its five transactions](docs/evidence/preview-2026-10-02/REHEARSAL.md) |
| A sealed and counted answer by a real person | **Not yet.** It needs the relay and the credential service to be switched on, and a passport |

What was observed, and what was not, is recorded in [docs/evidence/preview-2026-10-02](docs/evidence/preview-2026-10-02/README.md). How it is operated is in the [Preview runbook](docs/PREVIEW-RUNBOOK.md).

## The four pillars

| Pillar | What we are building | What exists today |
| --- | --- | --- |
| **Midnight Passport at the core** | Privacy on your own terms: prove 18+ without a name, or citizenship without a residential address. | Session/profile integration; selective-proof experience remains in progress. |
| **Real passport → NFC → ZK attestation** | Count participation by real, eligible citizens while keeping identity evidence separate from ballots. | Rarimo evidence and issuer adapters; public participation is simulated. |
| **AI for informed deliberation** | Browse sources, simplify dense proposals and understand different perspectives. | In the app, Cleisthenes answers from the authored catalogue. A consultation shows a reviewed, sourced brief once its evidence is connected; none is connected on the public site yet. |
| **Midnight.city exploration** | Research how AI agents might participate in civic experiments. | Exploratory; separate agent and human result lanes are a design requirement. |

The registry and referendum contracts already use **Compact**. The future migration concerns passport verification now approached through Rarimo; it is a separate engineering challenge.

Read the [project vision](docs/VISION.md), [Passport and proof model](docs/PASSPORT-AND-PROOFS.md), and [AI and deliberation plan](docs/AI-AND-DELIBERATION.md).

## The participant experience

Explore a question that affects your community. Read the proposal and its sources. Ask for context, reflect on the tradeoffs, and review your response before confirming it.

```mermaid
flowchart LR
  discover[Find a consultation] --> understand[Understand the proposal]
  understand --> choose[Choose a response]
  choose --> review[Review before confirming]
  review --> receipt[Keep a simulated receipt]
```

The app has three destinations: **Consultations**, **Cleisthenes** and **You**. The demo works in English, Spanish and French. **In his chat, Cleisthenes provides authored catalogue answers**, not generated AI responses. Demo credentials and receipts are explicitly labelled as simulated.

Civic Pulse, a private reflection, is outside those three steps. No screen links to it; it is kept at `/#app/pulse`. It keeps drafts in memory by default and offers an explicit device-only save, review and delete. Saving uses browser storage readable by others using that browser profile; answers are not uploaded.

## What works today

Status baseline: **16 September 2026**, application source from merged [PR #35](https://github.com/tomasgarro/midnight-vote/pull/35). The [documentation release record](docs/releases/2026-09-16-final-documentation.md) records this release separately from historical deployment evidence.

| Capability | What you can inspect | Evidence level |
| --- | --- | --- |
| Consultations, onboarding, guidance and the pass | A complete mobile demo with multilingual copy | Working demo |
| Review and receipt | A deliberate confirmation followed by a local simulated receipt | Working demo; no chain transaction |
| Credential Registry V1 | Issuer-authorized admission of commitments to eligibility claims | Compiled and simulator-tested source |
| Referendum V2 | Eligibility checks, repeat-use prevention, ballot commitment, reveal and tally | Compiled and simulator-tested source |
| Passport session | Account consent and display-profile integration | Source plus a dated [real-session record](docs/evidence/passport-live/2026-08-31-first-real-session.md) |
| NFC verification and live participation | Provider, issuer, relay and receipt interfaces | Integration source; physical end-to-end acceptance pending |
| Sourced briefs from Cleisthenes | The assistant boundary, and the brief inside the consultation page | Integration source; not connected on the public site |

## Three things that should stay separate

| Concept | In everyday language | What it does not establish by itself |
| --- | --- | --- |
| Midnight Passport session | How you enter the application and consent to profile sharing | Permission to vote |
| Identity-document evidence | A verification process for facts from a supported document | A unique, live human or freedom from coercion |
| Eligibility credential | Evidence that the holder meets a consultation's published rule | Eligibility for every other consultation |

For example, a Swiss citizens' consultation may require citizenship and an age threshold. A local residents' consultation needs separate evidence of residence. A zero-knowledge proof can establish a defined rule without publishing all its private inputs; the rule itself can still reveal a fact about the participant.

Read the [illustrated explanation](docs/HOW-IT-WORKS.md) for the intended NFC-to-Midnight path and the [architecture](docs/ARCHITECTURE.md) for implementation responsibilities.

## The privacy boundary

The current contract uses **commit–reveal**: the choice is hidden during commit and **becomes public during reveal**, when the tally updates. This is not permanent secret-ballot confidentiality. A receipt that omits the choice does not make the underlying reveal private.

The issuer and accepted-root publisher remain trusted roles. Repeat-use prevention applies to the same bound secret in the same consultation; it does not prove one person across all documents. The [Compact review](docs/COMPACT-REVIEW-2026-09-16.md) explains the implementation, remaining risks and live-release gates.

## Run and review

Start with the [quick start](docs/QUICKSTART.md). A clean source build needs Linux or WSL, Node from [`.nvmrc`](.nvmrc), npm 10 and Compact toolchain 0.31.1 because generated contract assets are not tracked. The resulting **demo** needs no wallet, funds or physical document.

For a submission review, follow this route:

1. [Submission brief](docs/SUBMISSION.md): contribution, walkthrough and evidence.
2. [Product specification](docs/specs/PRODUCT-SPEC.md): requirements and acceptance scenarios.
3. [How it works](docs/HOW-IT-WORKS.md): participant journey and privacy boundaries.
4. [Verification record](docs/releases/2026-09-16-final-documentation.md): exactly what was checked.
5. [Roadmap and release plan](docs/SUBMISSION-PLAN.md): measurable next steps.

## Repository map

| Directory | Responsibility |
| --- | --- |
| [`ui/`](ui/) | Participant experience, local state and simulated journey |
| [`contracts/`](contracts/) | Compact credential registry and referendum rules |
| [`api/`](api/) | Domain interfaces, witnesses and network adapters |
| [`cico-service/`](cico-service/) | Verification boundary and credential issuance |
| [`relayer/`](relayer/) | Authorized transaction submission and confirmation |
| [`scripts/`](scripts/) | Build, deployment and evidence procedures |
| [`docs/`](docs/) | Specifications, decisions, reviews and dated evidence |

Changes start with a [small specification](docs/specs/CHANGE-TEMPLATE.md) and follow the [contribution guide](CONTRIBUTING.md). Historical evidence remains available with its original source revision and environment.

## License

[Apache 2.0](LICENSE).
