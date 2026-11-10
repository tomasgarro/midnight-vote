import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/restart',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4183', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node polls/dist/server.js',
      env: {
        POLL_PORT: '5185',
        POLL_APP_ORIGIN: 'http://localhost:4183',
        POLL_AUTH_DB: 'tmp/playwright-passport.sqlite',
      },
      url: 'http://127.0.0.1:5185/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        'npm run preview --workspace midnight-referendum-ui -- --host 0.0.0.0 --port 4183 --strictPort',
      url: 'http://localhost:4183',
      reuseExistingServer: false,
      env: { POLL_API_TARGET: 'http://127.0.0.1:5185' },
      timeout: 30_000,
    },
  ],
});
