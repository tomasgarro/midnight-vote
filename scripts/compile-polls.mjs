import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localCompiler = path.join(root, 'tmp/compact-v9');
const prefix =
  !process.env.COMPACT_DIRECTORY && existsSync(path.join(localCompiler, 'versions/0.36.0'))
    ? ['--directory', localCompiler, 'compile', '+0.36.0']
    : ['compile', '+0.36.0'];
if (process.argv.includes('--skip-zk')) prefix.push('--skip-zk');
for (const [source, name] of [
  ['contracts/poll-v3-prototype/poll-v3-prototype.compact', 'poll-v3-prototype'],
  ['contracts/registry-provenance-prototype/root-oracle.compact', 'root-oracle'],
  ['contracts/registry-provenance-prototype/root-consumer.compact', 'root-consumer'],
]) {
  const result = spawnSync(
    process.env.COMPACT_BIN || 'compact',
    [...prefix, path.join(root, source), path.join(root, 'chain/managed', name)],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
