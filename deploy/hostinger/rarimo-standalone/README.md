# Standalone Rarimo NFC staging project

This project stages only the provider side of the passport/NFC flow. It does
not deploy Preview contracts, CICO issuance, the relayer, or the public UI.

The Hostinger project name is `midnight-rarimo-nfc`. It is intentionally safe
to start before DNS exists:

- the private verifier binds only to VPS loopback port `18080`;
- the allow-list gateway binds only to VPS loopback port `18081`;
- no service binds public ports 80 or 443;
- PostgreSQL is internal and has no host port;
- the database password is generated on the VPS and retained in a dedicated
  named volume rather than passed through the Hostinger API;
- the existing `hermes-agent-c3p7` project is not referenced.

The compose file is self-contained: its inline Dockerfile copies from a named
official Rarimo Git context with both `ref` and `checksum` fixed to commit
`f7ebbdf4d692326dd50d2c49976dd31042b2c29a`. The reviewed handler-only cleanup
patch is fetched from immutable application commit `268c217886135cd618983d445fd8c996d17eb3de`
with SHA-256 verification, checked with `git apply --check`, and covered by
targeted Go tests during every build.

`docker-compose.hostinger.yml` is the reproducible build manifest used for local
verification. Hostinger's project runner only pulls images, so
`docker-compose.hostinger.registry.yml` contains the identical runtime services
with the verified image pinned to both its published GHCR tag and immutable
registry digest `sha256:c617e38b457d488dce937741ee3ce395b1d4d9749fcc254cadbb8eefe408aa40`.

The remaining non-secret project inputs are:

- `RARIMO_CALLBACK_ORIGIN=https://rarimo.cardanoschool.org`
- `RARIMO_ALLOWED_IDENTITY_TIMESTAMP=<fixed launch timestamp>`
- `RARIMO_EVENT_ID=<stable non-zero BN254 field value>`

Run `node validate-project.mjs` before rendering or deploying the project. DNS,
TLS, public ports, and the physical NFC run are a separate, explicitly approved
morning cutover.

## The four manifests

| File | Stage | Public |
| --- | --- | --- |
| `docker-compose.hostinger.yml` | Verifier only, built from source | No |
| `docker-compose.hostinger.registry.yml` | The same services, image pulled | No |
| `docker-compose.hostinger.cutover.yml` | Adds CICO and the HTTPS edge. Issues passes; mints no vote capability | Yes |
| `docker-compose.hostinger.preview.yml` | What runs for Wave 2. See below | Yes |

## `docker-compose.hostinger.preview.yml`

The cutover manifest, plus what a person without a wallet needs to seal and
count an answer:

- the credential service from `midnight-civic-cico-service`, with the
  capability issuer and the root publisher switched on;
- every public name under `midnight.vote`: `cico.`, `rarimo.` and `relay.`.
  `cico.cardanoschool.org` is still answered, because the Cleisthenes bridge on
  the web host calls it. Remove it here once that bridge is repointed;
- the route to the Cleisthenes project, which joins this project's edge
  network (`/Switzerland/api`);
- the route to the relay project, which joins the same network under the name
  `relayer` (`deploy/hostinger/relay-standalone/docker-compose.shared-edge.yml`).

The verifier's public origin and the app's origin are written in the file, so
`RARIMO_CALLBACK_ORIGIN` and `CICO_ALLOWED_ORIGINS` are no longer read from the
project environment. Three values are new there:

| Name | Secret | Value |
| --- | --- | --- |
| `CICO_ACTION_CAPABILITY_SECRET` | **Yes** | Equal to the relay's `RELAYER_V2_CAPABILITY_SECRET` |
| `CICO_ACTION_ALLOWED_CONTRACTS` | No | Printed by `node scripts/print-consultation-values.mjs` |
| `CICO_REFERENDA_JSON` | No | Printed by the same script, on one line |

A new pass reaches every listed consultation as soon as it is issued
(`CICO_ROOT_PUBLISH_MIN_BATCH: 1`). That is one registry attestation and one
transaction per consultation for each pass, from the issuer wallet, which
therefore needs DUST. Raise the batch size before a pilot with many people.

The file is 8,189 characters; Hostinger's API refuses more than 8,192.

## Local runs

The tracked local override uses ports `28080` and `28081` so it can be tested
without stopping the earlier `rarimo-verificator` scratch stack:

```powershell
docker compose -p midnight-rarimo-nfc-local `
  -f docker-compose.hostinger.yml -f docker-compose.local.yml up -d --build
node smoke-local.mjs
```

To prove database persistence, run `node persistence-local.mjs prepare`, restart
the PostgreSQL and verifier containers, then run
`node persistence-local.mjs verify-cleanup`.
