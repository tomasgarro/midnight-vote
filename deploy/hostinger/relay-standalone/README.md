# Standalone relay project

The Hostinger project `midnight-civic-relay`. It runs what a person without a
wallet needs to seal and count an answer on Preview:

| Service | Role | Sees an answer |
| --- | --- | --- |
| `relayer` | Pays the fee for a transaction that is already proven, and submits it | No |
| `relayer-postgres` | The relayer's journal of accepted actions | No |
| `relayer-proof` | Proves the relayer's own fee transactions | No |
| `voter-proof` | Optional. Builds proofs for people who chose it (ADR-010) | Yes, while proving |
| `edge` | Caddy. The only service that publishes a port | No |

The project is separate from `midnight-rarimo-nfc` on purpose. It has its own
edge, so it can run on a second server and leave the live credential stack
untouched.

## Capacity: decide this first

Measured on the current VPS on 29 September 2026 (8.3 GB, 2 cores):

| Item | Memory |
| --- | --- |
| In use at idle, before any relayer | 4.15 GB |
| The credential service alone | 3.0 GB |
| A relayer, expected (it is a second wallet) | about 3 GB |
| One proof while it is built | up to about 1 GB |

**The current VPS does not hold this project beside what it already runs.**
Choose one before deploying:

1. A second VPS for this project. Nothing changes on the live one.
2. A larger plan for the current VPS. Ports 80 and 443 are taken there, so the
   two projects must then share one edge. That is a change to the live project
   and needs its own review.

## Inputs

Set these as the project's environment in hPanel. Do not send them through the
API: it returns environment values in plain text.

| Name | Secret | Value |
| --- | --- | --- |
| `RELAYER_SEED` | **Yes** | 64 hex characters. A new wallet, used for nothing else |
| `RELAYER_V2_CAPABILITY_SECRET` | **Yes** | Equal to `CICO_ACTION_CAPABILITY_SECRET` |
| `RELAYER_IMAGE` | No | The reference printed by the `Publish service images` workflow, with its digest |
| `RELAYER_V2_ALLOWED_CONTRACTS` | No | Every referendum address, separated by commas |
| `APP_ORIGIN` | No | `https://midnight.vote` |
| `RELAY_DOMAIN` | No | For example `relay.cardanoschool.org` |
| `PROVE_DOMAIN` | No | Only with hosted proving. For example `prove.cardanoschool.org` |

## Steps

| Step | Who |
| --- | --- |
| 1. Run the `Publish service images` workflow and copy both references | Tomas |
| 2. Point `RELAY_DOMAIN` (and `PROVE_DOMAIN`) at the server | Tomas |
| 3. `node validate-project.mjs` | Anyone |
| 4. Create the project from `docker-compose.hostinger.yml` with the inputs above | Tomas |
| 5. Read the relayer's address from its log and fund it from the Preview faucet | Tomas |
| 6. Wait for `/ready`. A new wallet needs about 27 minutes to sync | |
| 7. Set `VITE_RELAYER_URL=https://RELAY_DOMAIN` and rebuild the app | Anyone |

To offer hosted proving as well, start the project with the `hosted-proving`
profile and set `VITE_HOSTED_PROOF_SERVER_URL=https://PROVE_DOMAIN`. Without
it, the app offers proving on the device only (ADR-011), and no server ever
sees an answer before the count.

## What the validator enforces

`validate-project.mjs` reads the manifest and refuses it when any of these
fails. Each rule was tested against a manifest that breaks it.

- Every image is pinned by digest, and nothing is built on the server.
- The relayer's secrets are injected. No 64-hex value is written in its block.
- The relay carries `castVote` and `revealVote` and nothing else.
- Only the edge publishes a port.
- The edge does not log requests. A proving request is a witness.
- The voter proving server is opt-in, not verbose, has no volume, and shares
  no network with the relayer.
- The proving route answers the app's origin only.
- The manifest stays under Hostinger's 8,192-character limit.

## Known limits

- The relayer holds one DUST coin. It serves one action at a time and waits
  for each to confirm. Do not restart it during a demonstration.
- A person who chooses hosted proving trusts the operator while the proof is
  built. The rules above limit what an honest operator keeps. They do not make
  a dishonest operator safe. ADR-010 says so, and so does the app.
- Caddy has no rate limit without a plugin. Until one is added, the proving
  route is protected by its origin check and by the 2-core ceiling of the
  server.
