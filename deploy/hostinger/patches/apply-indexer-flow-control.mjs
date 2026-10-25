import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const patches = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(root, 'node_modules/@midnight-ntwrk/wallet-sdk-indexer-client');
if (JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8')).version !== '1.2.2') throw new Error('Review indexer flow control before changing SDK version');
const target = resolve(pkg, 'dist/effect/WsSubscriptionClient.js');
const original = '49a9ef852f1714669d18134bcae885526948acf483a8a42268664e5181a94a2c';
const replacement = readFileSync(resolve(patches, 'WsSubscriptionClient.js'));
const digest = value => createHash('sha256').update(value).digest('hex');
const current = digest(readFileSync(target));
if (current !== original && current !== digest(replacement)) throw new Error('Unrecognized indexer source; refusing to patch');
writeFileSync(target, replacement);
copyFileSync(resolve(patches, 'backpressure.js'), resolve(pkg, 'dist/effect/backpressure.js'));
console.log('Wallet indexer flow control applied to SDK 1.2.2');

