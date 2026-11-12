import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../ui/package.json', import.meta.url));
const vite = fileURLToPath(
  new URL('./bin/vite.js', pathToFileURL(require.resolve('vite/package.json'))),
);
const port = Number(process.env.RESTART_PORT ?? 4184);
const apiPort = Number(process.env.POLL_PORT ?? 5183);
if (
  [port, apiPort].some((value) => !Number.isInteger(value) || value < 1024 || value > 65535) ||
  port === apiPort
)
  throw new Error('Choose different RESTART_PORT and POLL_PORT values between 1024 and 65535.');
const origin = `http://localhost:${port}`;
const children = [
  spawn(process.execPath, ['polls/dist/server.js'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      POLL_PORT: String(apiPort),
      POLL_APP_ORIGIN: origin,
      POLL_AUTH_DB:
        process.env.POLL_AUTH_DB ?? path.join(root, 'polls/.state/passport-verification.sqlite'),
    },
  }),
  spawn(
    process.execPath,
    [
      vite,
      'preview',
      '--config',
      'vite.config.ts',
      '--configLoader',
      'runner',
      '--host',
      '0.0.0.0',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: path.join(root, 'ui'),
      stdio: 'inherit',
      env: { ...process.env, POLL_API_TARGET: `http://127.0.0.1:${apiPort}` },
    },
  ),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(0));
for (const child of children) {
  child.once('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once('exit', () => {
    if (!stopping) stop(1);
  });
}
console.log(`Development preview: ${origin}/#connect. Live voting remains gated.`);
