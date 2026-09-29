import { configDefaults, defineConfig } from 'vitest/config';

// The contract simulator tests run from the repository root. Generated
// folders can hold old copies of the repository, and a copy of a test file
// must never run as if it were the test.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'outputs/**', 'output/**', 'qa/**', 'research/**'],
    // A simulator test builds several contracts. On a busy machine that takes
    // longer than the five seconds a unit test gets by default.
    testTimeout: 20_000,
  },
});
