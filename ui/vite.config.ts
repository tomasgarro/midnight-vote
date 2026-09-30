import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    viteCommonjs(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'crypto', 'stream'],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(configDirectory, './src'),
      'cross-fetch': path.resolve(configDirectory, './src/integration/browser-fetch.ts'),
      'isomorphic-ws': path.resolve(configDirectory, './src/integration/browser-websocket.ts'),
      'object-inspect': path.resolve(
        configDirectory,
        './src/integration/browser-object-inspect.ts',
      ),
    },
  },
  // The device prover is a worker that loads Midnight's WASM prover.
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
  },
});
