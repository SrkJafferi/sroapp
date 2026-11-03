import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  testMatch: 'auth.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    channel: 'chrome',
    headless: true,
    trace: 'off',
    screenshot: 'off',
  },
  // An operator starts the real app; no alternate auth configuration or mock login bypass.
});
