import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/shared/src/db/schema-records.ts',
  out: './infra/d1/migrations/records',
  dialect: 'sqlite',
  driver: 'd1-http',
});
