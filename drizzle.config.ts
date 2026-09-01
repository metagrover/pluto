import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
