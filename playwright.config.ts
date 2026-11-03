import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  testMatch: 'clinic.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3101',
    channel: 'chrome',
    headless: true,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next start apps/web --port 3101',
    url: 'http://localhost:3101',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
