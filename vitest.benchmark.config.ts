/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/manual/meetingNotesQualityBenchmark.test.ts'],
  },
});
