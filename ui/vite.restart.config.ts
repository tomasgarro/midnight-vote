import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import base from './vite.config';

const directory = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  ...base,
  define: { ...base.define, 'import.meta.env.VITE_INCLUDE_LEGACY': JSON.stringify('false') },
  build: { ...base.build, rollupOptions: { input: path.join(directory, 'index.html') } },
});
