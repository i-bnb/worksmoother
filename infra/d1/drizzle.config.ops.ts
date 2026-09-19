import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/shared/src/db/schema-ops.ts',
  out: './infra/d1/migrations/ops',
  dialect: 'sqlite',
  driver: 'd1-http',
});
