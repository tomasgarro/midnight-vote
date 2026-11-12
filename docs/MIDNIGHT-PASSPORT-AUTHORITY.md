# Midnight Passport account verification — 9 November 2026

## What works in this repository

The server now checks a real BIP340-signed official redirect response against a
fresh request that it issued. Requests bind the application origin, account,
account network, purpose, optional poll, random nonce and expiry. Only the browser
that initiated a request can return it. SQLite consumes requests and records
signer/nonces atomically across independent connections and service restarts.

This proves **a signed response matches our request**. It does not prove that
the signing wallet key controls the account contract named in that response.
An attacker can sign a payload naming someone else's account. Our cryptographic
tests demonstrate this exact case: signature verification succeeds and account
authorization stays denied. No signed-profile result issues a session or grants
organizer/voter permissions.

The new HTTP flow is:

1. `POST /api/polls/passport/start` with the connected account, its network and
   purpose (`connect`, `organizer`, or `vote` with a poll identifier).
2. The server sets a browser-binding HttpOnly, SameSite=Strict cookie and returns
   an official Passport launch URL. HTTPS uses a Secure `__Host-` cookie.
3. The browser navigates to the official Passport application. The returned
   fragment is parsed, checked and scrubbed locally; the signed envelope is sent
   once to `POST /api/polls/passport/verify`.
4. The server independently parses and verifies the envelope. Invalid, expired,
   wrong-origin, wrong-account, wrong-network, replayed or browser-mismatched
   responses return 403. A valid signature returns a diagnostic report with
   `authorized: false` and `accountControl: unavailable`.

The service does not store returned profiles, envelopes, signatures or private
keys. Its private SQLite directory stores outstanding claimed-account requests
and hashed browser/nonce identifiers. Expired records are pruned on startup,
new requests and once per minute while listening; this is not a promise of secure
erasure from filesystem snapshots or SQLite journal history. Use a persistent
local volume to retain this directory across service restarts. Horizontal replicas must share one
transactional store; independent databases cannot provide shared replay history.
SQLite WAL storage is intended for one host, not a network filesystem.

The UI has a **Check account verification** action after profile connection. It
displays signed-response verification, account authority and Preview compatibility
separately. Unavailable services preserve the connected profile while granting no
authority. React StrictMode, cancellation and late reconnect responses are covered.

## Upstream source checked today

| Repository | Exact revision | Finding |
| --- | --- | --- |
| `midnightntwrk/passport-demo` | `d343acf6674b7258e04cad9eb5d64c054f0dfebd` | Current official connector; profile/payment/redirect, no ACC authorization response |
| `midnightntwrk/midnight-passport-sdk` | `27721ed385248e1d40d6353a8ef74a38c94951d4` | New 9 November roadmap; SDK still planning, no packages or implemented sign-in |
| `midnightntwrk/passport` | `e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3` | Current ACC and draft scoped-grant/sign-in specification |

The [demo supplies an unshielded wallet keystore](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/App.tsx#L10771)
to redirect signing. The [connector's optional key-binding check](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/packages/connect/src/redirect/verify.ts#L167)
checks that key against an unshielded address, not against the account contract.
The [ACC validates enrolled device entries](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/contract/contracts/account.compact#L847)
using a separate authorization mechanism. The demo's unshielded BIP340 key is
not interchangeable with an enrolled ACC device or scoped grantee key.

There is also a specific protocol contradiction to resolve. Today's
[SDK connect story E19.02](https://github.com/midnightntwrk/midnight-passport-sdk/blob/27721ed385248e1d40d6353a8ef74a38c94951d4/docs/roadmap/stories/M6-E19-S10-E19.02-connect-sign-in-verification.md)
and message story E09.03 promise sign-in without a grant. The
[scoped-grants MIP section 10](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/docs/mps-mip/mips/mip-xxxx-scoped-grants.md#10-sign-in)
requires a registered grant key, grant ID and incarnation, plus canonical checks
of active state, device epoch, grant generation and expiry. Both the implementation
and an authoritative compatible wire format are missing. We have not invented
a new sign-in protocol or called a draft protocol production-ready.

The demo's [account network is Stagenet](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/skills/midnight-passport/references/stagenet.md).
A Stagenet account remains explicitly different from a Preview account.

## What is blocked upstream

- An actual account-authorized response or grant, produced by Passport and
  independently verifiable against the deployed account's current authority.
- A settled sign-in protocol resolving grant-backed versus grant-free sign-in,
  with authoritative message encoding, signature schemes and positive/negative
  test vectors.
- Supported account deployment/authorization on Preview, or an explicit reviewed
  cross-network identity design. A profile field is not proof of deployment.

We do **not** need the complete SDK. A stable, evidenced sign-in capability is
enough to integrate independently. No upstream issue, comment or message was sent.

## Work we can finish ourselves

| Work | Current state | Evidence needed before enabling |
| --- | --- | --- |
| Fresh request, browser binding, signature checks, durable single use | Implemented and locally tested | Genuine upstream account-authority response for integration |
| ACC authority verifier and scoped sessions | Unfinished; protocol-dependent | Known account code/version, canonical fresh state, actual enrolled key/grant checks, revocation, expiry, incarnation and server-issued session scope |
| One-account admission and privacy | Unfinished | Poll-bound uniqueness tied to verified authority; no public account links in anonymous/private records |
| Ledger 9 deployment and submission | Unfinished; research contracts only | Full proving/provider lifecycle, fresh funded Preview deployment, canonical confirmation, retry/restart evidence |
| Private tally and delayed disclosure | Unfinished; our cryptographic design work | Valid encrypted openings, complete-set aggregate proof, documented decryption trust and liveness, no voter return |
| Organizer service | Unfinished; UI demonstration only | Durable canonical storage, verified roles, immutable publication, fixed deadlines |
| Independent verifier and pilot operations | Unfinished | Chain/proof checking, final downloads, phone measurements, monitoring and invited pilot evidence |

The machine-readable version is `GET /api/polls/readiness`; `npm run check:restart`
prints the same ownership distinction and continues to exit unsuccessfully.
Our unfinished tally, service and deployment work is not classified as an SDK blocker.

## Concrete upstream integration contract

The next upstream capability must provide evidence answering all of these:

- Which account and network authorized this relying party, and which deployed
  code/version defines that authority?
- Which exact bytes bind our origin, fresh nonce, purpose, issue time and expiry?
- Which enrolled device or grantee key signed, and how is enrollment, rotation
  or revocation checked from canonical account state?
- If grant-backed: which grant, generation, epoch and incarnation are current,
  and which scopes are actually allowed? Readiness must not imply organizer roles.
- Can a verifier distinguish a missing account, rejected/revoked authority,
  unsupported account version and unavailable/stale indexer?

Acceptance fixtures must include a genuine successful account response and
negative cases for a self-selected key claiming a victim account, changed
origin/network/nonce/purpose, stale/reissued grants, device rotation/revocation,
expired responses, concurrent replay and unavailable chain state. A trust-on-first-use
wallet pin, possession of profile data, or a custom midnight.vote account cannot
substitute for the genuine Midnight Passport account requirement.

## Running the local account checks

From the restart worktree, with Node 22.23.4 and dependencies installed:

```sh
npm run preview:restart
```

This builds and starts the UI at `http://localhost:4184/#connect` and the loopback
API at port 5183. The UI proxies account-verification requests to the API. Stop
both with Ctrl+C. `RESTART_PORT`, `POLL_PORT` and `POLL_AUTH_DB` can override the
local ports and persistent state file. HTTPS hosting must reverse-proxy
`/api/polls` to the service and set `POLL_APP_ORIGIN` to the exact public origin;
the current static Vercel configuration does not deploy this Node service.

`npm run test --workspace midnight-vote-polls` runs actual signature, HTTP and
SQLite restart/replay tests. `npm run test:e2e:restart` starts an isolated API and
checks desktop/mobile callbacks with explicitly attacker-generated fixtures.
These fixtures are not evidence of a genuine authenticated Passport session.
