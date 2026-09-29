# ADR-011: The browser builds its own proofs

- Status: Accepted for Wave 2 (no contract change)
- Date: 2026-09-29
- Related: [ADR-009](ADR-009-voter-owned-reveal.md), [ADR-010](ADR-010-disclosed-hosted-proving.md)
- Corrects: ADR-010, which said no browser prover existed

## Context

ADR-010 let a browser without a wallet prove on the operator's server, behind a
disclosure, because we believed nothing else could build a proof there. That
belief was wrong.

Midnight publishes its prover as WebAssembly in `@midnight-ntwrk/zkir-v2`. The
wallet SDK uses it (`makeWasmProvingService`), and the Midnight Passport team
proved contract circuits with it in a browser tab. It exposes the same
`ProvingProvider` interface that Lace returns, so midnight-js can prove through
it unchanged. The package was already installed here as a dependency of the
wallet SDK.

With hosted proving alone, every answer sealed from a phone passed through a
server that could read it. That is a weak position for a product whose claim is
private participation.

## Decision

1. Add the execution mode `sponsored-device-proving`. The proof is built in the
   person's browser, in a worker, by the WASM prover. The relay still pays the
   fee and submits the proven transaction.
2. **The device is the default prover for a browser without a wallet.** Hosted
   proving (ADR-010) stays as a choice the person can make, with its disclosure
   unchanged. It is never selected for them.
3. One prover per runtime. Device proving cannot be combined with a wallet, a
   proving server, or hosted proving.
4. The device proves two circuits only: `castVote` and `revealVote`. A request
   for any other key is refused.
5. The public parameter files are served from the app's own origin and checked
   against a pinned SHA-256 before use. `npm run zk:params` downloads and
   verifies them at build time.
6. Each proof runs in its own worker, which is terminated afterwards, so the
   memory is returned. The page holds a screen wake lock while a proof runs and
   shows the time elapsed.

## Measurements

One laptop (AMD Ryzen 7 7735HS, 16 GB), single-threaded WASM, real proofs from
inputs produced by the contract simulator. Reproduce the Node rows with
`npm run measure:device-proving`.

| Circuit | Size | Chromium 152, bundled worker | Node 24, idle machine | Node 24, busy machine | Peak memory (Node) |
| --- | --- | --- | --- | --- | --- |
| `revealVote` | k=13 | 32 s | 32 s | 43 to 69 s | about 215 MB |
| `castVote` | k=15 | 1 min 55 s | 1 min 52 s | 2 min 6 s to 3 min 37 s | about 650 MB |

The busy rows were taken while a test suite ran on the same machine. They show
how much a loaded device slows the proof.

What the browser downloads once, then caches:

| File | Size |
| --- | --- |
| Prover (WASM) | 2.1 MB (0.7 MB compressed) |
| `castVote` prover key | 10.0 MB |
| `revealVote` prover key | 2.9 MB |
| Public parameters, k=15 and k=13 | 6.3 MB and 1.6 MB |

**Not measured yet:** a phone. We expect several minutes for `castVote` there,
and a low-memory phone may fail. The proofs were also not yet submitted to
Preview. Both are part of the first device run, and this table is updated with
the results.

## What each prover can see

| Prover | Sees the answer and the pass secret | Time to seal |
| --- | --- | --- |
| Lace, on a computer | Lace | under a minute |
| This device (default without a wallet) | nobody but the device | minutes |
| Operator's proving server (chosen, disclosed) | the operator, while proving | about a minute |

The interface shows this trade to the person in plain words. For the device it
says: "Your answer is not sent to any server until it is counted." That sentence
is limited on purpose. The count publishes the answer, as ADR-009 explains.

## What this does not fix

| Limit | Why |
| --- | --- |
| The relay learns the network address that submitted a transaction | It forwards the proven transaction. It sees no answer |
| A count can be matched to its cast on-chain | A property of the deployed contract (ADR-009). Contract v3 |
| Proving is slow | The published prover is single-threaded. Upstream has a multithreaded demo that is not released |
| A closed or suspended page loses the proof in progress | The opening is already in the vault, so the person can start again without risk of a second answer |

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Hosted proving only | The operator sees every answer from a phone |
| Device proving only | A phone that cannot finish a proof would have no way to take part |
| The wallet SDK's `WasmProver` as is | It depends on Effect and on a worker path inside the package. A 70-line worker of our own gives the same prover with timing and clear failures |
| Parameters fetched from Midnight's bucket at run time | A third party would learn who is building a proof, and when |

## Consequences

- A person without a wallet can seal and count an answer that no server has
  seen before the count.
- The privacy claim has three tiers, and the interface names the one in use.
- The static site grows by about 8 MB of parameter files, which are not
  committed. The build must run `npm run zk:params`.
- The hosted proving server becomes optional. A deployment may leave
  `VITE_HOSTED_PROOF_SERVER_URL` empty and offer device proving alone.

## Evidence

- `api/src/passport-v2/device-proving.ts`: key material for the two circuits,
  with pinned parameter digests. 10 tests.
- `api/src/passport-v2/midnight-v2-relayer-providers.ts`: `deviceProving`, and
  the one-prover rule.
- `ui/src/workers/device-prover.worker.ts` and
  `ui/src/integration/device-prover.ts`: the worker and its page side. 10 tests
  with a stand-in worker.
- `ui/src/integration/walletless-proving.ts`: the choice, its default, and the
  copy. 15 tests.
- `scripts/measure-device-proving.mjs`: the measurement above.
