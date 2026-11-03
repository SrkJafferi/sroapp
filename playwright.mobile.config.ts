import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  testMatch: 'mobile.spec.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:8083',
    channel: 'chrome',
    headless: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ../../node_modules/expo/bin/cli start --web --port 8083',
    cwd: 'apps/mobile',
    url: 'http://localhost:8083',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
