import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contracts = [
  {
    source: path.join(
      root,
      'contracts',
      'credential-registry-v1',
      'credential-registry-v1.compact',
    ),
    target: path.join(
      root,
      'contracts',
      'credential-registry-v1',
      'managed',
      'credential-registry-v1',
    ),
  },
  {
    source: path.join(root, 'contracts', 'referendum-v2', 'referendum-v2.compact'),
    target: path.join(root, 'contracts', 'referendum-v2', 'managed', 'referendum-v2'),
  },
];

const compiler = process.env.COMPACT_BIN?.trim() || 'compact';

for (const contract of contracts) {
  mkdirSync(contract.target, { recursive: true });
  const result = spawnSync(compiler, ['compile', '+0.31.1', contract.source, contract.target], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    console.error(`Unable to start ${compiler}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
