/// <reference path="../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />

// vitest-pool-workers types `env` as Cloudflare.Env, so declare the bindings that
// vitest.config.ts provides to the test worker.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    AUTH_PEPPER: string;
    DATA_ENCRYPTION_KEY: string;
    APP_URL: string;
    APP_NAME: string;
    FROM_EMAIL: string;
    FROM_NAME: string;
    ADMIN_EMAILS: string;
    PRICE_PER_1000_USD: string;
    MIN_PURCHASE_THOUSANDS: string;
    PAYPAL_MODE: 'sandbox' | 'live';
    PAYPAL_RECEIVER_EMAIL: string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
  }
}
