/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true, // Enables describe, it, expect globally
        environment: 'node', // Use node environment for backend tests
        include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'], // Look for tests in tests/ directory
    },
})
