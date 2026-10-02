import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    // Tests must remain deterministic even when ui/.env is configured for the
    // local Undeployed chain. Runtime mode is exercised by the dev server.
    'import.meta.env.MODE': JSON.stringify('test'),
    'import.meta.env.VITE_APP_MODE': JSON.stringify('demo'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // The WSL gate reads this repository across /mnt/c. On a busy machine a
    // journey test that takes one second alone can pass five, and failed the
    // gate on 2 October 2026 for no fault of the code.
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(configDirectory, './src'),
    },
  },
});
