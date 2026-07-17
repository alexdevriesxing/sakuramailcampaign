import { applyD1Migrations, env } from 'cloudflare:test';

// Build the real schema once before the suite runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
