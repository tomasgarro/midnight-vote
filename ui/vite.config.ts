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
  define: { 'import.meta.env.VITE_INCLUDE_LEGACY': JSON.stringify('true') },
  server: { proxy: { '/api/polls': process.env.POLL_API_TARGET ?? 'http://127.0.0.1:5183' } },
  preview: { proxy: { '/api/polls': process.env.POLL_API_TARGET ?? 'http://127.0.0.1:5183' } },
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
    rollupOptions: {
      input: {
        index: path.join(configDirectory, 'index.html'),
        legacy: path.join(configDirectory, 'legacy.html'),
      },
    },
    target: 'esnext',
    minify: 'esbuild',
  },
});
