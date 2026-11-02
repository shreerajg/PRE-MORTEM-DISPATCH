import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the real FastAPI + Vite stack.
 *
 * Both processes are started automatically (and reused when already running),
 * so `npx playwright test` is the only command needed locally and in CI. The
 * API uses a separate database so a test run cannot append to the dev workspace.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'python -m uvicorn app.main:app --port 8000',
      cwd: '../api',
      url: 'http://127.0.0.1:8000/api/v1/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'sqlite:///./data/e2e.db',
      },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
});
