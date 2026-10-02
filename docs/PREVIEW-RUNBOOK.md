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

Measured on 2 October 2026 with the relayer on a laptop: a first start
replayed 258,821 indices in about an hour and a half; a restart from the saved
state was synchronized, with its DUST balance, 85 seconds after it started.

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
| 2 | same place → `midnight-rarimo-nfc` → environment | Add `CICO_ACTION_CAPABILITY_SECRET` (the same value as the relay's capability secret), `CICO_ACTION_ALLOWED_CONTRACTS` and `CICO_REFERENDA_JSON` as printed. Two values that are already there must be the operator's own, see below |
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

### Two secrets that are not free choices

The registry and each consultation were deployed from the operator's machine.
Each holds a public key, and only the secret behind that key may act.

| In hPanel, project `midnight-rarimo-nfc` | Must equal, in `.env.v2.preview` | If it does not |
| --- | --- | --- |
| `CICO_ISSUER_ROLE_SECRET` | `V2_ISSUER_ROLE_SECRET_HEX` | The registry refuses every pass |
| `CICO_ROOT_PUBLISHER_SECRET_HEX` | `V2_ROOT_PUBLISHER_ROLE_SECRET_HEX` | No consultation takes a new root, so nobody with a new pass can answer |

The credential service checks both when it starts, before its wallet does,
and stops with a line that names the variable:
`CICO_ISSUER_ROLE_SECRET is not the issuer of the registry …` or
`CICO_ROOT_PUBLISHER_SECRET_HEX is not the root publisher of the consultation …`.
When both are right its log says `issuer role secret matches the registry on
chain`. To copy the right value:

```bash
node -e "const m=require('fs').readFileSync('.env.v2.preview','utf8').match(/^V2_ISSUER_ROLE_SECRET_HEX=(.*)$/m);process.stdout.write(m[1].trim())" | clip
```

```bash
node -e "const m=require('fs').readFileSync('.env.v2.preview','utf8').match(/^V2_ROOT_PUBLISHER_ROLE_SECRET_HEX=(.*)$/m);process.stdout.write(m[1].trim())" | clip
```

The relayer's wallet is one wallet. Once the server's relayer holds
`RELAYER_SEED`, no relayer with the same seed may run anywhere else: two
processes on one wallet spend the same DUST.

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

One command asks everything a person depends on, and says what to change:

```bash
npm run check:preview
```

It needs no secret and changes nothing. It reads the relay's readiness, the
credential service's status, each consultation on the chain, the published app
and Cleisthenes.

| It reports | Meaning |
| --- | --- |
| `ok` | Observed, and as it should be |
| `WAIT` | Not ready yet, and it gets there by itself: a wallet still reading the chain, a root not published yet |
| `FAIL` | A person would be stopped. The line under it names the variable or the step |
| `?` | Could not be observed from this machine. Nothing is claimed |

Two of its checks cannot be made by hand:

- **Relay and credential service share one secret.** Each publishes a short
  fingerprint of its capability secret. If the two pastes differ, the
  fingerprints differ. Without this check the mistake shows only after a
  person's device has built a proof, when the relay refuses it.
- **On chain.** Whether each consultation admits every pass issued so far.

Before the hPanel sitting it reports the relay and the credential service as
not answering: the edge has no certificate for `relay.midnight.vote` and
`cico.midnight.vote` until the credential project runs the new manifest. It
also reports the app's proving files as missing until the Preview build is
published.

The same things by hand, and what the logs say:

| Check | Expect |
| --- | --- |
| `curl https://relay.midnight.vote/ready` | 200 once the relayer's wallet has replayed and holds DUST |
| `curl -H "Origin: https://midnight.vote" https://cico.midnight.vote/v1/enrollment/status` | 200 with the root publisher's counters. 503 means no consultation is configured |
| `curl https://midnight.vote/Switzerland/api/health` | 200. If not, restart `swiss-civic-pilot`: it lost the edge network |
| The relayer's log | "wallet state restored" or a replay, then "listening". Before that: "Set RELAYER_SEED…" means a secret is missing |
| The credential service's log | At start: `issuer wallet address, to fund with NIGHT: mn_addr_preview1…`. After the replay: `issuer wallet synchronized. DUST: <number above zero>`, then `root publisher: <n> consultation(s), every 60 s` |

### What the root publisher does, and what its log says

A pass is added to the registry, which gives the registry a new root. The
credential service then publishes that root to every consultation that still
admits passes, and only then can the pass answer there. It starts as soon as
the pass is issued, and looks again every minute.

| Log line | Meaning |
| --- | --- |
| `credential-root-publisher: root published {… "published": 2, "stillOwed": 0}` | Two consultations took the root. Nothing is left to do |
| `… publish to referendum failed, will retry {"contractAddress": …, "attempts": 1, "message": …}` | One consultation did not take the root. It is offered again in the next cycle, up to five times, without a second attestation |
| `… gave up publishing this root to a referendum` | Five failures. The next pass brings a new root, which is offered again. Read the message: a wrong publisher secret never heals |
| `… attestation failed, refusing to publish` | Nothing was published. Usually the wallet has no DUST. It is tried again in a minute |
| No line at all after a restart | Every consultation already holds the current root. A restart sends no transaction |

Each pass costs the wallet one transaction for the pass, one attestation, and
one more per open consultation. They run one at a time, in one queue with the
passes themselves. With several consultations open, a new pass is admitted to
them one after another, not at once; a person can answer each consultation as
soon as that one has the root. How long one such transaction takes on the
server is not measured yet.

### If the issuer wallet holds no DUST

The credential service pays for every pass and every root it publishes, from
its own wallet. Its log says `the issuer wallet holds no DUST` when that
wallet cannot pay. Nothing else is wrong; a pass simply cannot be issued yet.

| Step | What |
| --- | --- |
| 1 | Copy the address from the log line `issuer wallet address, to fund with NIGHT` |
| 2 | Send Preview NIGHT to it: from the Preview faucet (it asks for a captcha), or from a wallet that holds some |
| 3 | Register that NIGHT for DUST generation. Only the wallet that owns it can. On the operator's machine, put the issuer seed (the value of `CICO_ISSUER_WALLET_SEED` in hPanel) in a file that git ignores, as one line `DUST_REGISTER_SEED_HEX=<the seed>`, for example `.env.issuer.local`. Then run the command below, and delete the file |
| 4 | Restart nothing. DUST accrues by itself; the service's next attempt succeeds once the balance is above zero |

```bash
node --env-file=relayer/.env --env-file=.env.issuer.local relayer/dist/register-dust.js
```

NIGHT alone pays for nothing. It generates DUST only once it is registered,
and that is the step people miss.

A faster way, for a test and not for a pilot: set `CICO_ISSUER_WALLET_SEED` in
hPanel to the operator's fee seed (`V2_OPERATOR_FEE_SEED_HEX` in
`.env.v2.preview`), which is funded and registered. The credential service
then pays from the operator's wallet. Two processes on one wallet must never
spend at the same moment, so do not run the deploy command while someone is
getting a pass. Give the service its own funded wallet before real people use
it.

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
| 5 | Choose an answer, review it, seal it. If the pass is not admitted to the consultation yet, the app shows "Admitting your pass" and waits by itself, up to three minutes, while the credential service publishes the new root | Whether that screen appeared, and for how long. If the app gives up, read the credential service's log |
| 6 | The app then builds the proof. Keep the screen on | The elapsed time the app shows. The phone model |
| 7 | The receipt appears. Open the public results | The count of sealed answers went up by one |
| 8 | After the closing time, and after the operator closed the consultation: open the app on the same phone and count the answer | The elapsed time. The tally |

What can go wrong, and what it means:

| The app says | Meaning | Do |
| --- | --- | --- |
| "Your pass has not been admitted to this consultation yet" | The app waited three minutes, and no root that holds the pass was published to the consultation | Try again. If it persists, the root publisher is not running or cannot pay: read its log lines above, and check `CICO_REFERENDA_JSON` and the issuer wallet's DUST |
| "Your pass was added after this consultation stopped admitting passes" | The consultation's enrolment deadline passed before this pass existed | Nothing to fix. The person can answer the other open consultations |
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

## Rehearse without a passport

Three tools find what breaks before a person stands there with a passport.
None of them makes a claim about a person: what each leaves on chain is named
as a rehearsal in `docs/evidence/`.

| Tool | What runs for real | What stands in | Where it runs |
| --- | --- | --- | --- |
| `npm run check:preview` | Nothing is run: it reads the services, the chain and the app | Nothing | Against the live services |
| `node --env-file-if-exists=relayer/.env --env-file-if-exists=.env.v2.preview scripts/rehearse-citizen-journey.mjs <slug> seal\|count` | The app's action adapter, the proofs, a relayer on this machine, the transactions | A fixture pass, and a relay permission signed by the operator's secret | On a consultation whose slug starts with `rehearsal`, on the shared registry |
| `npm run rehearse:dress -- prepare\|journey\|operate\|count` | The credential service and the relayer of this repository, configured as on the server; the app's HTTP ports, credential adapter and action adapter; the proofs; the transactions | A verifier on loopback that answers "verified" in place of the passport scan | On a registry of its own, which `prepare` deploys |

The dress rehearsal is the one to run after a change to the credential
service or the relay. It goes through what a person goes through: a
verification is requested, the pass is issued on chain by the credential
service, its root is published, the app waits for the admission, and the
answer is sealed with a permission the credential service signed. Only the
scan is missing. `prepare` writes the service's configuration and prints the
two commands that start the services.

Run on 2 October 2026 on a laptop: a pass was issued 30 seconds after the
stand-in scan, admitted to the consultation 48 seconds later, and the answer
was sealed 27 to 36 seconds after that.

## Known limits

- A pass is valid for 24 hours. A person seals their answer in the same sitting
  as the passport scan. Counting later needs no pass.
- The registry is shared by every consultation and keeps enrolling. The
  credential service publishes each new root to every open consultation, one
  transaction per consultation. A person's proof is built against the newest root the
  consultation admitted that already holds their pass, so passes issued after
  theirs do not hold them up, and a consultation that has stopped admitting
  passes still takes answers from everyone who enrolled in time. The app finds
  that root by reading the registry's earlier states from the public indexer;
  it goes back 48 passes at most. A pass added after a consultation's
  enrolment closed cannot answer that consultation, and the app says so.
- The app builds the proof on the person's device. On a laptop the seal took
  about two minutes. A phone is not measured yet.
- English is stored with the deployment. The other languages of a
  consultation reach the app from `deploy/passport-v2/consultations.json`,
  through `print-consultation-values.mjs --write-app-env`.
- Adding a consultation changes three values on the server
  (`RELAYER_V2_ALLOWED_CONTRACTS`, `CICO_ACTION_ALLOWED_CONTRACTS`,
  `CICO_REFERENDA_JSON`) and needs a new app build. Both services restart;
  with their wallet state saved that takes minutes.
