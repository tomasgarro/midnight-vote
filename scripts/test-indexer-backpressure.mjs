import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'graphql';
import { Effect, Stream } from 'effect';
import { layer } from '../node_modules/@midnight-ntwrk/wallet-sdk-indexer-client/dist/effect/WsSubscriptionClient.js';
import { SubscriptionClient } from '../node_modules/@midnight-ntwrk/wallet-sdk-indexer-client/dist/effect/SubscriptionClient.js';
let pauses = 0, resumes = 0;
const pause = WebSocket.prototype.pause;
const resume = WebSocket.prototype.resume;
WebSocket.prototype.pause = function () { pauses++; return pause.call(this); };
WebSocket.prototype.resume = function () { resumes++; return resume.call(this); };
const server = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: () => 'graphql-transport-ws' });
await new Promise(resolve => server.once('listening', resolve));
server.on('connection', socket => socket.on('message', raw => {
  const message = JSON.parse(raw.toString());
  if (message.type === 'connection_init') socket.send(JSON.stringify({ type: 'connection_ack' }));
  if (message.type === 'subscribe') {
    for (let n = 0; n < 200; n++) socket.send(JSON.stringify({ id: message.id, type: 'next', payload: { data: { n, padding: 'x'.repeat(8192) } } }));
    socket.send(JSON.stringify({ id: message.id, type: 'complete' }));
  }
}));
try {
  const values = await Effect.gen(function* () {
    const client = yield* SubscriptionClient;
    return yield* Stream.runCollect(client.subscribe(parse('subscription Test { n }'), {}).pipe(
      Stream.mapEffect(value => Effect.zipRight(Effect.sleep('2 millis'), Effect.succeed(value.n)))));
  }).pipe(Effect.provide(layer({ url: `ws://127.0.0.1:${server.address().port}` })), Effect.scoped, Effect.timeout('20 seconds'), Effect.runPromise);
  assert.deepEqual(Array.from(values), Array.from({ length: 200 }, (_, n) => n));
  assert.ok(pauses > 0, 'upstream socket must pause under a slow consumer');
  assert.ok(resumes > 0, 'upstream socket must resume after draining');
  console.log(`INDEXER_INTEGRATION_OK: 200 ordered events, no loss; pauses=${pauses}, resumes=${resumes}`);
} finally {
  for (const socket of server.clients) socket.terminate();
  await new Promise(resolve => server.close(resolve));
  WebSocket.prototype.pause = pause;
  WebSocket.prototype.resume = resume;
}
