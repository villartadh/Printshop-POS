import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PW_DATA_DIR = path.join(os.tmpdir(), `printshop-pw-${process.pid}`);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } },
    },
  ],
  webServer: {
    command: 'npx tsx server.ts',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      PRINTSHOP_DATA_DIR: PW_DATA_DIR,
      DISABLE_HMR: 'true',
    },
  },
});
