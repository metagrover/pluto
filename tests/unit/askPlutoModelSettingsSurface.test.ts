import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Ask Pluto model settings surface', () => {
  it('exposes an optional fast chat model without replacing the analysis model', () => {
    const settings = readFileSync(
      'src/components/features/SettingsTab.tsx',
      'utf8',
    );

    expect(settings).toContain('ollama_fast_model');
    expect(settings).toContain('Fast Chat Model');
    expect(settings).toContain('Local Analysis & Deep Model');
  });
});
