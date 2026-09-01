import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('database migration packaging', () => {
  it('packages the complete Drizzle migration directory', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'electron-builder.json5'),
      'utf8',
    );
    expect(source).toMatch(
      /"from"\s*:\s*"drizzle"[\s\S]*?"to"\s*:\s*"drizzle"[\s\S]*?"filter"\s*:\s*\["\*\*\/\*"\]/,
    );
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'drizzle', '0000_pluto_baseline.sql'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'drizzle', 'meta', '_journal.json'),
      ),
    ).toBe(true);
  });
});
