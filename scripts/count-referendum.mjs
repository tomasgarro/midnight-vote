/**
 * The organizer's part of the ending of a legacy (v1) referendum: closeVote,
 * then finalizeVote.
 *
 * Usage (from the repository root, inside WSL/Linux, with the relayer running):
 *
 *   CONTRACT_ADDRESS=<hex> node --env-file-if-exists=relayer/.env \
 *     scripts/count-referendum.mjs
 *
 *   --close-only     close the commit phase and stop
 *
 * This script used to count too: it took each answer and its salt on the
 * command line. That made the organizer the holder of a list of who answered
 * what, before publication. ADR-009 moved the count to the device that sealed
 * the answer, so this script takes no answer and no salt, and refuses them.
 *
 * A Referendum V2 consultation is closed and finalized by running
 * deploy-passport-v2.mjs again after each deadline.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

globalThis.WebSocket ??= WebSocket;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const known = new Set(['--close-only']);
const unknown = argv.filter((argument) => !known.has(argument));
if (unknown.length > 0) {
  // The arguments are not echoed: an old command line holds answers and salts.
  console.error(
    argv.includes('--ballot')
      ? 'This script no longer counts answers, and takes no answer and no salt (ADR-009). ' +
          'Remove --ballot and what follows it.'
      : 'Unknown arguments. The only option is --close-only.',
  );
  process.exit(1);
}

const seedHex = (process.env.RELAYER_SEED ?? '').trim().toLowerCase().replace(/^0x/, '');
if (!/^[0-9a-f]{64}$/.test(seedHex)) {
  console.error('RELAYER_SEED is missing. Run with --env-file-if-exists=relayer/.env');
  process.exit(1);
}
const roleSecret = (label) =>
  new Uint8Array(
    createHash('sha256')
      .update(`referendum:role:${label}:`)
      .update(Buffer.from(seedHex, 'hex'))
      .digest(),
  );

const envPath = resolve(ROOT, 'ui/.env');
const contractAddress =
  process.env.CONTRACT_ADDRESS ??
  (existsSync(envPath)
    ? /^VITE_MIDNIGHT_CONTRACT_ADDRESS=(.+)$/m.exec(readFileSync(envPath, 'utf8'))?.[1]?.trim()
    : null);
if (!contractAddress) {
  console.error('No contract address. Set CONTRACT_ADDRESS or deploy first.');
  process.exit(1);
}

const api = await import(`${ROOT}/api/dist/index.js`);
const { loadConfig } = await import(`${ROOT}/relayer/dist/config.js`);
const { NodeZkConfigProvider } = await import(
  '@midnight-ntwrk/midnight-js-node-zk-config-provider'
);
const generated = await import(`${ROOT}/api/dist/generated/referendum/index.js`);

const config = loadConfig();
const providers = await api.createRelayerProviders({
  relayerUrl: `http://${config.host}:${config.port}`,
  proofServerUri: config.provingServerUrl,
  networkId: config.networkId,
  indexerUri: config.indexerHttpUrl,
  indexerWsUri: config.indexerWsUrl,
  zkConfigProvider: new NodeZkConfigProvider(
    resolve(ROOT, 'contracts/referendum/managed/referendum'),
  ),
});

const issuerSecret = roleSecret('issuer');
const organizerSecret = roleSecret('organizer');
const basePrivateState = api.createReferendumPrivateState({ issuerSecret, organizerSecret });
const executor = api.createReferendumExecutor(providers, {
  issuerSecret,
  organizerSecret,
  eventId: new Uint8Array(createHash('sha256').update('referendum:event:v1').digest()),
});

const readLedger = async () => {
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  return generated.ledger(state.data);
};
const showTally = async (label) => {
  const ledger = await readLedger();
  const tally = [...ledger.tally].map(([c, n]) => `${['YES', 'NO', 'ABSTAIN'][c] ?? c}=${n}`);
  console.log(
    `${label}: phase=${ledger.phase} closed=${ledger.closed} tally=${tally.join(' ') || '(hidden)'}`,
  );
};

const relayerHealth = () =>
  fetch(`http://${config.host}:${config.port}/health`)
    .then((r) => r.json())
    .catch(() => null);

/**
 * The relayer holds a single DUST coin. Balancing spends it and produces
 * change, but the wallet cannot spend that change until it observes the block,
 * and submitting in the meantime is rejected by the node as
 * InvalidDustSpendProof (custom error 170) — which also leaves the wallet
 * convinced its coin is gone. Closing and finalizing are two transactions in a
 * row, so the second has to wait for the change of the first to land.
 */
const waitForRelayerChange = async (previousDust, timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write("waiting for the relayer's DUST change to land");
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    const health = await relayerHealth();
    if (health?.synced && health.dustBalance !== '0' && health.dustBalance !== previousDust) {
      console.log(' ok');
      return health.dustBalance;
    }
    process.stdout.write('.');
  }
  console.log('');
  throw new Error(
    "The relayer's DUST did not recover in time. If it reports dustBalance 0 while " +
      'still holding NIGHT, restart it so it re-derives its coins from chain.',
  );
};

await executor.join(contractAddress, basePrivateState);
await showTally('before');

const dustBefore = (await relayerHealth())?.dustBalance ?? '0';

const ledgerNow = await readLedger();
if (ledgerNow.phase === 'COMMIT' || Number(ledgerNow.phase) === 0) {
  console.log('\nclosing the commit phase…');
  const receipt = await executor.closeVote();
  console.log(`closed. tx ${receipt.txHash}`);
  if (!argv.includes('--close-only')) await waitForRelayerChange(dustBefore);
} else {
  console.log('\nalready past the commit phase; skipping closeVote');
}
if (argv.includes('--close-only')) {
  await showTally('after');
  process.exit(0);
}

console.log('\nfinalizing…');
const receipt = await executor.finalizeVote();
console.log(`finalized. tx ${receipt.txHash}`);

await showTally('after');
process.exit(0);
