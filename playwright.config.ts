import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: 'America/Chicago',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 950 } },
    },
  ],
  webServer: {
    // Requires `npm run build` first (CI does this).
    command: `rm -rf .e2e-data && node server/dist/index.js`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      HEARTHBOARD_DATA: '.e2e-data',
      HEARTHBOARD_PHOTOS: '.e2e-data/none',
      HEARTHBOARD_DEMO: '1',
      HEARTHBOARD_ADMIN_PASSWORD: 'e2e admin password',
      TZ: 'America/Chicago',
    },
  },
});
