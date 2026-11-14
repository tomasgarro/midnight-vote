// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { ClientError, ServerError, WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { Effect, Layer, Stream } from 'effect';
import { print } from 'graphql';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { createSocketBackpressure } from './backpressure.js';
import { SubscriptionClient } from './SubscriptionClient.js';
export const layer = (config) => {
  const flow = createSocketBackpressure();
  return Layer.scoped(
    SubscriptionClient,
    WsURL.make(config.url).pipe(
      Effect.flatMap((url) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            createClient({
              url: url.toString(),
              shouldRetry: () => false,
              keepAlive: config.keepAlive ?? 15_000,
              webSocketImpl: WebSocket,
              on: { connected: (socket) => flow.setSocket(socket) },
            }),
          ),
          (client) => Effect.sync(() => client.dispose()),
        ),
      ),
      Effect.map((client) => new WebSocketSubscriptionClientImpl(client, flow)),
    ),
  );
};
class WebSocketSubscriptionClientImpl {
  constructor(client, flow) {
    this.client = client;
    this.flow = flow;
  }
  client;
  subscribe(document, variables) {
    return Stream.async((emit) => {
      const dispose = this.client.subscribe(
        { query: print(document), variables: variables },
        {
          next: (data) => {
            if (data.errors) {
              return void emit.fail(
                new ClientError({ message: data.errors[0].message, cause: data.errors }),
              );
            }
            void this.flow
              .push(() => emit.single(data.data))
              .catch((err) => {
                void emit.fail(new ServerError({ message: 'Indexer delivery failed', cause: err }));
              });
          },
          error: (err) => {
            void emit.fail(
              Array.isArray(err)
                ? new ClientError({ message: err[0].message })
                : new ServerError({ message: String(err) }),
            );
          },
          complete: () => void emit.end(),
        },
      );
      // Ensure we dispose of the query if the running Fiber is terminated.
      return Effect.sync(dispose);
    });
  }
}
