#!/usr/bin/env node
// Builds real castVote and revealVote proofs with the WASM prover a browser
// uses (ADR-011), and reports time and memory. It needs no network: the
// contract simulator supplies the inputs, and the keys and public parameters
// are read from disk.
//
//   npm run build --workspace midnight-referendum-api
//   npm run zk:params
//   node scripts/measure-device-proving.mjs
//
// Every value below is a fixture. No real credential or answer is involved.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  encodeContractAddress,
  persistentCommit,
  persistentHash,
  proofDataIntoSerializedPreimage,
} from '@midnight-ntwrk/compact-runtime';
import { sampleCoinPublicKey } from '@midnight-ntwrk/ledger-v8';
import { check, prove } from '@midnight-ntwrk/zkir-v2';
import { MIDNIGHT_PARAMS_SHA256, paramsFileName } from './fetch-zk-params.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paramsDirectory = path.resolve(process.argv[2] ?? path.join(root, 'ui/public/zk-params'));
const managed = (contract) => path.join(root, 'contracts', contract, 'managed', contract);
const load = (file) => import(pathToFileURL(file).href);

const crypto = await load(path.join(root, 'api/dist/passport-v2/crypto.js'));
const Registry = await load(path.join(managed('credential-registry-v1'), 'contract/index.js'));
const Referendum = await load(path.join(managed('referendum-v2'), 'contract/index.js'));

const bytes32 = new CompactTypeBytes(32);
const vector2 = new CompactTypeVector(2, bytes32);
const vector8 = new CompactTypeVector(8, bytes32);
const bytes = (value) => new Uint8Array(32).fill(value);
const pad32 = (value) => {
  const result = new Uint8Array(32);
  result.set(new TextEncoder().encode(value));
  return result;
};
const uintBytes = (value) => convertFieldToBytes(32, value, 'measure');
const roleKey = (domain, secret) => persistentHash(vector2, [pad32(domain), secret]);

const OPENS_AT = 1_000_000_000n;
const ENROLLMENT_CLOSES_AT = 1_000_000_500n;
const CLOSES_AT = 1_000_001_000n;
const REVEAL_CLOSES_AT = 1_000_002_000n;

function atTime(context, time) {
  return createCircuitContext(
    dummyContractAddress(),
    context.currentZswapLocalState,
    context.currentQueryContext.state,
    context.currentPrivateState,
    undefined,
    undefined,
    Number(time),
  );
}

// --- a registry holding one credential --------------------------------------
const voterSecret = bytes(2);
const holderBlind = bytes(3);
const claims = {
  holderBinding: persistentCommit(
    vector2,
    [pad32('cico:holder-bind:v1'), voterSecret],
    holderBlind,
  ),
  issuerId: bytes(4),
  country: pad32('250'),
  ageClass: 2n,
  assurance: 2n,
  epoch: 7n,
  validUntil: 2_000_000_000n,
  blind: bytes(5),
};
const issuerSecret = bytes(1);
const claim = (key) => (context) => [context.privateState, context.privateState.claims[key]];
const registry = new Registry.Contract({
  issuerSecret: (context) => [context.privateState, context.privateState.issuerSecret],
  holderBinding: claim('holderBinding'),
  credentialBlind: claim('blind'),
  credentialCountry: claim('country'),
  credentialAgeClass: claim('ageClass'),
  credentialAssurance: claim('assurance'),
  credentialValidUntil: claim('validUntil'),
});
const registryInitial = registry.initialState(
  createConstructorContext({ issuerSecret, claims }, sampleCoinPublicKey()),
  bytes(6),
  claims.issuerId,
  claims.epoch,
  roleKey('cico:registry:issuer:', issuerSecret),
);
const issued = registry.impureCircuits.addCredential(
  createCircuitContext(
    dummyContractAddress(),
    registryInitial.currentZswapLocalState,
    registryInitial.currentContractState,
    registryInitial.currentPrivateState,
  ),
);
const credentials = Registry.ledger(issued.context.currentQueryContext.state).credentials;
const leaf = persistentCommit(
  vector8,
  [
    pad32('cico:credential:v1'),
    claims.holderBinding,
    claims.issuerId,
    claims.country,
    uintBytes(claims.ageClass),
    uintBytes(claims.assurance),
    uintBytes(claims.epoch),
    uintBytes(claims.validUntil),
  ],
  claims.blind,
);
const voterPath = credentials.findPathForLeaf(leaf);
if (!voterPath) throw new Error('The credential leaf was not inserted');

// --- a referendum, one sealed answer, and its count -------------------------
const eventId = bytes(21);
const voteSalt = bytes(22);
const organizerSecret = bytes(20);
const rootPublisherSecret = bytes(23);
const privateState = {
  organizerSecret,
  rootPublisherSecret,
  voterSecret,
  holderBinding: claims.holderBinding,
  holderBlind,
  credentialBlind: claims.blind,
  credentialCountry: claims.country,
  credentialAgeClass: claims.ageClass,
  credentialAssurance: claims.assurance,
  credentialClaimEpoch: claims.epoch,
  credentialValidUntil: claims.validUntil,
  voterPath,
  voterChoice: Referendum.Choice.YES,
  voteSalt,
};
const witness = (key) => (context) => [context.privateState, context.privateState[key]];
const referendum = new Referendum.Contract({
  ...Object.fromEntries(Object.keys(privateState).map((key) => [key, witness(key)])),
  revealPath: (context) => {
    if (!context.privateState.revealPath) throw new Error('The reveal path is unavailable');
    return [context.privateState, context.privateState.revealPath];
  },
});
const initial = referendum.initialState(
  createConstructorContext(privateState, sampleCoinPublicKey()),
  bytes(6),
  claims.issuerId,
  claims.epoch,
  credentials.root(),
  crypto.deriveRegistryContractBinding(dummyContractAddress()),
  { bytes: encodeContractAddress(dummyContractAddress()) },
  eventId,
  roleKey('cico:referendum-v2:organizer:', organizerSecret),
  roleKey('cico:ref-v2:root-publisher:', rootPublisherSecret),
  claims.country,
  true,
  2n,
  true,
  1_900_000_000n,
  OPENS_AT,
  ENROLLMENT_CLOSES_AT,
  CLOSES_AT,
  REVEAL_CLOSES_AT,
);
const cast = referendum.impureCircuits.castVote(
  createCircuitContext(
    dummyContractAddress(),
    initial.currentZswapLocalState,
    initial.currentContractState,
    initial.currentPrivateState,
    undefined,
    undefined,
    Number(OPENS_AT + 100n),
  ),
);
const revealPath = Referendum.ledger(
  cast.context.currentQueryContext.state,
).ballotCommitments.findPathForLeaf(crypto.deriveBallotCommitment(eventId, 'YES', voteSalt));
if (!revealPath) throw new Error('The ballot commitment was not inserted');
const closed = referendum.impureCircuits.closeVote(atTime(cast.context, CLOSES_AT + 10n));
const revealContext = atTime(closed.context, CLOSES_AT + 20n);
revealContext.currentPrivateState = { ...revealContext.currentPrivateState, revealPath };
const reveal = referendum.impureCircuits.revealVote(revealContext, Referendum.Choice.YES, voteSalt);

// --- what a browser would download ------------------------------------------
const downloads = new Map();
const read = (file) => {
  const content = new Uint8Array(readFileSync(file));
  downloads.set(file, content.length);
  return content;
};
const keyMaterial = {
  lookupKey: async (keyLocation) => ({
    proverKey: read(path.join(managed('referendum-v2'), 'keys', `${keyLocation}.prover`)),
    verifierKey: read(path.join(managed('referendum-v2'), 'keys', `${keyLocation}.verifier`)),
    ir: read(path.join(managed('referendum-v2'), 'zkir', `${keyLocation}.bzkir`)),
  }),
  getParams: async (k) => {
    if (!MIDNIGHT_PARAMS_SHA256[k]) throw new Error(`No pinned public parameters for size ${k}`);
    return read(path.join(paramsDirectory, paramsFileName(k)));
  },
};

async function measure(name, results) {
  const { input, output, publicTranscript, privateTranscriptOutputs } = results.proofData;
  const preimage = proofDataIntoSerializedPreimage(
    input,
    output,
    publicTranscript,
    privateTranscriptOutputs,
    name,
  );
  downloads.clear();
  const before = process.memoryUsage().rss;
  let peak = before;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 50);
  try {
    await check(preimage, keyMaterial);
    const started = performance.now();
    const proof = await prove(preimage, keyMaterial);
    const seconds = (performance.now() - started) / 1000;
    peak = Math.max(peak, process.memoryUsage().rss);
    const megabytes = [...downloads.values()].reduce((sum, size) => sum + size, 0) / 1e6;
    console.log(
      `${name.padEnd(10)} ${seconds.toFixed(1).padStart(6)} s   proof ${proof.length} bytes   ` +
        `download ${megabytes.toFixed(1)} MB   memory +${((peak - before) / 1e6).toFixed(0)} MB`,
    );
  } finally {
    clearInterval(sampler);
  }
}

console.log(`node ${process.version}, single-threaded WASM prover (@midnight-ntwrk/zkir-v2)`);
await measure('revealVote', reveal);
await measure('castVote', cast);
