/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['tests/manual/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
  },
});
