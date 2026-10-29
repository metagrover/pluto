import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Ask Pluto model settings surface', () => {
  it('explains the separate routing and answer model roles', () => {
    const settings = readFileSync(
      'src/components/features/SettingsTab.tsx',
      'utf8',
    );

    expect(settings).toContain('ollama_fast_model');
    expect(settings).toContain('Local Routing Model');
    expect(settings).toContain('Local Analysis & Answers Model');
    expect(settings).toContain('OLLAMA_GENERAL_MODEL');
    expect(settings).toContain('OLLAMA_QUICK_CHAT_MODEL');
  });
});
