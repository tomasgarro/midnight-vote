import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const source = path.join(projectDirectory, 'contracts', 'referendum', 'referendum.compact');
const target = path.join(projectDirectory, 'contracts', 'referendum', 'managed', 'referendum');

mkdirSync(target, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    stdio: 'inherit',
    windowsHide: true,
  });
  return result.error ? null : result.status;
}

function isUsable(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    stdio: 'ignore',
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

const compactc = process.env.COMPACTC_BIN?.trim();
const compact = process.env.COMPACT_BIN?.trim();

let status = null;
if (compactc) {
  status = run(compactc, [source, target]);
} else if (process.platform !== 'win32' && isUsable('compactc', ['--version'])) {
  status = run('compactc', [source, target]);
}
if (status === null && compact) {
  status = run(compact, ['compile', '+0.31.1', source, target]);
}
if (
  status === null &&
  !compact &&
  process.platform !== 'win32' &&
  isUsable('compact', ['compile', '--version'])
) {
  status = run('compact', ['compile', '+0.31.1', source, target]);
}

if (status === null) {
  console.error(
    'Compact compiler not found. Install the Linux Compact CLI/compiler in WSL, or set COMPACTC_BIN to its executable (COMPACT_BIN is supported for the legacy CLI) before running npm run compile.',
  );
  process.exit(1);
}

process.exit(status ?? 1);
