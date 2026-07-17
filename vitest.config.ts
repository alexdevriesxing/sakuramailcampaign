import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests run against real SQLite with the production migrations applied, so the
// SQL under test is the SQL that ships.
const migrations = await readD1Migrations(path.join(process.cwd(), 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      miniflare: {
        compatibilityDate: '2026-07-15',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Test-only values — never the production secrets.
          AUTH_PEPPER: 'test-pepper-0123456789abcdef0123456789abcdef',
          // Must decode to exactly 32 bytes for AES-256-GCM.
          DATA_ENCRYPTION_KEY: 'c2FrdXJhLXRlc3QtZW5jcnlwdGlvbi1rZXktMzJiISE=',
          APP_URL: 'https://mail.example.test',
          APP_NAME: 'Sakura Mail Test',
          FROM_EMAIL: 'hello@mail.example.test',
          FROM_NAME: 'Sakura Test',
          ADMIN_EMAILS: 'admin@example.test',
          PRICE_PER_1000_USD: '1.00',
          MIN_PURCHASE_THOUSANDS: '5',
          PAYPAL_MODE: 'sandbox',
          PAYPAL_RECEIVER_EMAIL: 'billing@example.test',
          TURNSTILE_SITE_KEY: 'test',
          TURNSTILE_SECRET_KEY: 'test',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
