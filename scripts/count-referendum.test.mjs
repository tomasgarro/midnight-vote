import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./count-referendum.mjs', import.meta.url));
const salt = 'ab'.repeat(32);

function run(...args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    // No seed and no address: the script must refuse before it needs either.
    env: { ...process.env, RELAYER_SEED: '', CONTRACT_ADDRESS: '' },
    timeout: 20_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('the organizer script of a legacy referendum', () => {
  it('takes no answer and no salt, and does not repeat them', () => {
    const { status, output } = run('--ballot', `YES:${salt}`);

    expect(status).toBe(1);
    expect(output).toMatch(/no longer counts answers/u);
    expect(output).not.toContain(salt);
    expect(output).not.toMatch(/\bYES\b/u);
  });

  it('refuses the option that kept a count open for more answers', () => {
    const { status, output } = run('--no-finalize');

    expect(status).toBe(1);
    expect(output).toMatch(/The only option is --close-only/u);
  });

  it('holds no code that opens an answer', () => {
    const source = readFileSync(script, 'utf8');

    expect(source).not.toMatch(/revealVote\(|persistentCommit\(|findPathForLeaf|revealPath/u);
    expect(source).toMatch(/closeVote\(\)/u);
    expect(source).toMatch(/finalizeVote\(\)/u);
  });
});
