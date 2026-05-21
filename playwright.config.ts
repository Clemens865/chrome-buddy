import { defineConfig } from '@playwright/test';

// E2E smoke tests load the BUILT extension from dist/, so run `npm run build` first.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
