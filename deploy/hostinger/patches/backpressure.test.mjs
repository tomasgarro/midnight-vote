import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocketBackpressure } from './backpressure.js';
function fixture() {
  const flow = createSocketBackpressure(4, 2);
  const events = [];
  const socket = { pause: () => events.push('pause'), resume: () => events.push('resume') };
  flow.setSocket(socket);
  const releases = [];
  const values = [];
  const sends = Array.from({ length: 6 }, (_, i) => flow.push(() => new Promise(resolve => releases.push(() => { values.push(i); resolve(i); }))));
  return { flow, events, releases, values, sends };
}
test('pauses intake while downstream is slow, preserves every item, and resumes after draining', async () => {
  const f = fixture();
  assert.deepEqual(f.events, ['pause']);
  assert.equal(f.flow.pending, 6);
  for (const release of f.releases.slice(0, 3)) release();
  await Promise.all(f.sends.slice(0, 3));
  assert.deepEqual(f.events, ['pause']);
  f.releases[3]();
  await f.sends[3];
  assert.deepEqual(f.events, ['pause', 'resume']);
  for (const release of f.releases.slice(4)) release();
  assert.deepEqual(await Promise.all(f.sends), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(f.values, [0, 1, 2, 3, 4, 5]);
  assert.equal(f.flow.pending, 0);
});
test('releases pressure when a consumer rejects or throws', async () => {
  const flow = createSocketBackpressure(2, 0);
  let done;
  const first = flow.push(() => new Promise(resolve => { done = resolve; }));
  await assert.rejects(flow.push(() => Promise.reject(new Error('cancelled'))), /cancelled/);
  await assert.rejects(flow.push(() => { throw new Error('disposed'); }), /disposed/);
  assert.equal(flow.pending, 1);
  done(); await first;
  assert.equal(flow.pending, 0);
});
test('applies outstanding pressure to a replacement socket', async () => {
  const f = fixture();
  const next = [];
  f.flow.setSocket({ pause: () => next.push('pause'), resume: () => next.push('resume') });
  assert.deepEqual(f.events, ['pause', 'resume']);
  assert.deepEqual(next, ['pause']);
  f.releases.forEach(release => release());
  await Promise.all(f.sends);
  assert.deepEqual(next, ['pause', 'resume']);
});
test('invalid limits are rejected', () => {
  assert.throws(() => createSocketBackpressure(2, 2), /Invalid/);
});
