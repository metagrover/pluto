/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/unit/setup.ts'],
    globals: true, // Enables describe, it, expect globally
    environment: 'node', // Use node environment for backend tests
    include: ['tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
});
