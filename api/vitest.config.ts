import { configDefaults, defineConfig } from 'vitest/config';

// The build compiles the tests into `dist` beside the code. Run the sources
// only: a compiled copy is the same test a second time, and after an edit
// without a build it is an old one.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
