import { defineConfig } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env into process.env BEFORE tests run.
//
// Why: Vite automatically reads .env at build time and inlines VITE_*-prefixed
// vars into the extension bundle (that's how VITE_GEMINI_API_KEY reaches the
// service worker). Playwright is a separate Node process that runs OUTSIDE
// Vite — it sees only what's already in process.env, and never reads .env
// itself. So a test-only credential like GITHUB_TEST_PAT (no VITE_ prefix on
// purpose, to keep it out of the shipped bundle) wouldn't reach the test
// runner without this loader.
//
// Tiny inline parser — avoids pulling in `dotenv` as a dev dep for ~10 lines.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue; // shell-supplied values win
    process.env[key] = raw.replace(/^['"](.*)['"]$/, '$1');
  }
}

// E2E smoke tests load the BUILT extension from dist/, so run `npm run build` first.
export default defineConfig({
  testDir: './tests/e2e',
  // Live tests make real Gemini calls (chat, agent loop, image gen) — generous.
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
