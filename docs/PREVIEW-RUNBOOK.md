# Preview runbook

How midnight.vote runs on Midnight Preview during Wave 2: what runs where, how
a consultation goes on chain, what an operator pastes and where, and how a
consultation is closed and counted. Written 2 October 2026.

The addresses of a deployment are not repeated here. The deploy command writes
a manifest under `deploy/passport-v2/`, which stays on the operator's machine,
and `node scripts/print-consultation-values.mjs` prints every value derived
from it. A reviewed copy of each manifest, with what it does and does not
show, is under `docs/evidence/`: the current one is
[preview-2026-10-02](evidence/preview-2026-10-02/README.md).

## What runs where

| Place | What | Holds a secret |
| --- | --- | --- |
| Web host (`midnight.vote`) | The app, as static files. The Cleisthenes page and its bridge under `/Switzerland` | No |
| VPS project `midnight-rarimo-nfc` | Passport verifier, credential service (CICO) with its proof server, and the HTTPS edge for every `*.midnight.vote` service name | Issuer wallet seed, two role secrets, the capability secret |
| VPS project `midnight-civic-relay` | Relayer, its database and its proof server. No port of its own: it joins the edge network of the project above | Relayer wallet seed, the capability secret |
| VPS project `swiss-civic-pilot` | Cleisthenes API. Joins the same edge network | Model keys |
| Operator's machine | The deploy script and the operator wallet. Used to deploy, close and finalize | Operator fee seed, organizer and issuer role secrets |
| Midnight Preview | `credential-registry-v1` (one) and `referendum-v2` (one per consultation) | No |

Public names, all served by the one edge:

| Name | Routes | Goes to |
| --- | --- | --- |
| `cico.midnight.vote` | `/v1/*` | Credential service |
| `rarimo.midnight.vote` | proof parameters and callback only | Passport verifier |
| `relay.midnight.vote` | `/keys`, `/ready`, `/v2/*` | Relayer |
| `cico.cardanoschool.org` | `/Switzerland/api/*` | Cleisthenes. Kept only until the bridge on the web host is repointed |

Nothing on a developer machine serves the live site. Local Docker holds one
container with a function, `referendum-proof-server`, which the deploy script
uses.

## Three things that cost time

| Fact | Consequence |
| --- | --- |
| A wallet that starts with nothing replays the whole chain. On 1 October 2026 that took about 85 minutes on a laptop, longer on a busy one | The first start of the relayer, of the credential service's new image, and of the operator wallet each cost that once. After it, each keeps its state (see below) and a restart takes minutes |
| The relayer holds one DUST coin | It serves one action at a time. Do not restart it during a demonstration |
| A consultation's contract stays in its first phase until someone closes it | After the closing time, run the deploy command again, or nobody can count their answer |

## Wallet state

The relayer, the credential service and the deploy script save what their
wallet has learned from the chain, and start from it the next time.

| Wallet | Where its state is kept |
| --- | --- |
| Relayer | `/var/lib/relayer/state/wallet-state.json`, in the volume `midnight-civic-relay-state` |
| Credential service (issuer) | `issuer-wallet-state.json` in its state directory, in the volume `midnight-rarimo-nfc-cico-state` |
| Operator (deploy script) | `.state/operator-wallet.preview.json` on the operator's machine, not in the repository |

The file holds no key: keys are derived from the seed at every start. It does
show what the wallet owns, so treat it as private. It is saved every five
minutes, once when the wallet is synchronized, and at shutdown. A file that is
damaged, or that belongs to another wallet or network, is ignored and the
wallet replays the chain as before. To force a replay, delete the file.

## Put a consultation on chain

A consultation is written down once, in
`deploy/passport-v2/consultations.json`: its question in each language, the
country of the document if it has a country rule, and its three deadlines.
Each has a short slug. The test consultation's slug is `test`.

Needs Docker Desktop running (for `referendum-proof-server`) and the files
`.env.v2.preview` and `relayer/.env`, which hold the operator's secrets and
are not in the repository.

```bash
npm run deploy:preview:consultation -- test
```

The first run draws the consultation's event id, fixes its opening time and
writes its inputs to `.env.v2.preview.<slug>`. It then deploys against the
registry that already exists and publishes the current credential root to the
new consultation. It casts no answer. A deployed consultation cannot change
its id or its schedule: the command refuses a file that no longer matches.

It can be run again at any time. It reads its manifest and does what is due:
it admits a newer credential root while the consultation still enrols, closes
the consultation once answers are over, and finalizes it once counting is
over. Before a deadline it prints when to come back.

```bash
node scripts/print-consultation-values.mjs --write-app-env
```

This prints the values for the two VPS projects and writes
`ui/.env.preview.local` for the app build.

## The hPanel sitting

All changes go in together, because each restart costs a wallet replay.

| Step | Where | What |
| --- | --- | --- |
| 1 | hPanel → VPS → Docker Manager → `midnight-civic-relay` → Manage → environment | Replace the two placeholders: `RELAYER_SEED` and `RELAYER_V2_CAPABILITY_SECRET`, from `relayer/.env`. `RELAYER_V2_ALLOWED_CONTRACTS` already holds the test consultation's address; change it only when a consultation is added. Save and restart |
| 2 | same place → `midnight-rarimo-nfc` → environment | Add `CICO_ACTION_CAPABILITY_SECRET` (the same value as the relay's capability secret), `CICO_ACTION_ALLOWED_CONTRACTS` and `CICO_REFERENDA_JSON` as printed |
| 3 | `midnight-rarimo-nfc` → compose editor | Replace the content with `deploy/hostinger/rarimo-standalone/docker-compose.hostinger.preview.yml`. Save and deploy |
| 4 | Wait | Both wallets replay, this first time. Expect two to three hours on the two-core server. Later restarts take minutes |
| 5 | Web host | Publish the `preview` build of the app, as described below |

Copy a secret to the clipboard without printing it:

```bash
node -e "const m=require('fs').readFileSync('relayer/.env','utf8').match(/^RELAYER_SEED=(.*)$/m);process.stdout.write(m[1].trim())" | clip
```

```bash
node -e "const m=require('fs').readFileSync('relayer/.env','utf8').match(/^RELAYER_V2_CAPABILITY_SECRET=(.*)$/m);process.stdout.write(m[1].trim())" | clip
```

Never send these values through the Hostinger API or a connector. The API
returns a project's environment in plain text.

## Publish the app

The app on the web host is a folder of static files. Build it against the
consultations that are deployed, and pack it:

```bash
node scripts/print-consultation-values.mjs --write-app-env
npm run build:preview --workspace midnight-referendum-ui
python scripts/package-app.py ui/dist outputs/midnight-vote-preview.zip
```

Pack it with that script, not with PowerShell's `Compress-Archive`: that one
writes Windows path separators, and the host then unpacks every file into one
flat folder with backslashes in its names.

In hPanel's file manager, upload the archive to `public_html` and extract it
there, over the existing files. **Do not delete the `Switzerland` folder**: it
holds the Cleisthenes page and its bridge, and it is not part of this build.

Publish only after the three checks below answer as expected. A Preview build
in front of servers that are not ready shows a consultation nobody can answer.

## Check it from outside

| Check | Expect |
| --- | --- |
| `curl https://relay.midnight.vote/ready` | 200 once the relayer's wallet has replayed and holds DUST |
| `curl -H "Origin: https://midnight.vote" https://cico.midnight.vote/v1/enrollment/status` | 200 with the root publisher's counters. 503 means no consultation is configured |
| `curl https://midnight.vote/Switzerland/api/health` | 200. If not, restart `swiss-civic-pilot`: it lost the edge network |
| The relayer's log | Its wallet address, then "listening". Before that: "Set RELAYER_SEED…" means a secret is missing |
| The credential service's log | Its issuer wallet and a DUST balance above zero. It pays for every pass and every root it publishes |

## The first phone run

Do this only after the three outside checks above answer as expected. It needs
the passport and its holder, an Android or iOS phone with NFC and the RariMe
app, and mobile data or Wi-Fi.

| Step | On the phone | Write down |
| --- | --- | --- |
| 1 | Open `https://midnight.vote/#app`. The chip at the top says PREVIEW | The time |
| 2 | Open the consultation. Check the three deadlines and "who can answer" | A screenshot |
| 3 | Add eligibility. The app opens RariMe. Scan the passport's chip | How long the scan took. Any refusal, word for word |
| 4 | Back in the app, the pass appears under You | A screenshot. The pass shows a country and an age class, never a name |
| 5 | Wait until the app says the pass is admitted. The credential service publishes the new root to the consultation | How long it took. If it takes more than five minutes, read the credential service's log |
| 6 | Choose an answer, review it, seal it. Keep the screen on while the proof is built | The elapsed time the app shows. The phone model |
| 7 | The receipt appears. Open the public results | The count of sealed answers went up by one |
| 8 | After the closing time, and after the operator closed the consultation: open the app on the same phone and count the answer | The elapsed time. The tally |

What can go wrong, and what it means:

| The app says | Meaning | Do |
| --- | --- | --- |
| "This consultation has not admitted the latest passes yet" | The pass is in the registry, and its root is not yet published to the consultation | Wait a minute and try again. If it persists, the root publisher is not running: check `CICO_REFERENDA_JSON` and the issuer wallet's DUST |
| "Origin is not allowed" in the browser console | The credential service or the relayer does not know `https://midnight.vote` | The new credential manifest is not deployed |
| The relayer is unavailable | `relay.midnight.vote/ready` is not 200 | Its wallet is still replaying, or it holds no DUST |
| RariMe refuses the document | The passport is not supported or was registered before | Record the exact message. Try the second passport |
| The proof stops or the tab reloads | The phone ran out of memory | Close other apps and try again. Record the model. This is a result worth reporting |

A sealed answer is kept on the device that sealed it. Private browsing, or
clearing the site's data, loses it, and it can then never be counted.

## Close, count, finalize

The schedule is enforced on chain. The contract changes phase only when asked.

| When | Who | What |
| --- | --- | --- |
| After the closing time | Operator | `npm run deploy:preview:consultation -- <slug>` again. It closes the consultation: answers can now be counted |
| Until the counting deadline | Each person | Opens the app on the device that sealed the answer, and counts it. The app does this through the relayer |
| After the counting deadline | Operator | The same command once more. It finalizes: the tally is fixed |

Before a deadline the command prints the date and ends normally.

## Known limits

- A pass is valid for 24 hours. A person seals their answer in the same sitting
  as the passport scan. Counting later needs no pass.
- The registry is shared by every consultation and keeps enrolling. A person's
  proof is built against the registry's current state, so a consultation has
  to have admitted the latest root. The credential service admits each new
  root within about a minute. Once a consultation's own enrolment has closed,
  later passes move the registry on, and people who have not yet sealed their
  answer in that consultation can no longer do so. Close enrolment late.
- The app builds the proof on the person's device. On a laptop the seal took
  about two minutes. A phone is not measured yet.
- English is stored with the deployment. The other languages of a
  consultation reach the app from `deploy/passport-v2/consultations.json`,
  through `print-consultation-values.mjs --write-app-env`.
- Adding a consultation changes three values on the server
  (`RELAYER_V2_ALLOWED_CONTRACTS`, `CICO_ACTION_ALLOWED_CONTRACTS`,
  `CICO_REFERENDA_JSON`) and needs a new app build. Both services restart;
  with their wallet state saved that takes minutes.
