import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync('electron/main.ts', 'utf8');
const start = main.indexOf("'intelligence:person-chat:send'");
const end = main.indexOf("'intelligence:person-chat:cancel'", start);
const handler = main.slice(start, end);

describe('Person Chat performance boundary', () => {
  it('reuses the fast Ask Pluto inference path without classifier or title calls', () => {
    expect(handler).toContain('provider.answerAskPluto');
    expect(handler).toContain("mode: 'fast'");
    expect(handler).not.toContain('classifyQueryIntent');
    expect(handler).not.toContain('generateTitle');
    expect(handler).not.toContain('synthesizeKnowledgeDocument');
  });

  it('records content-free first-token diagnostics', () => {
    expect(handler).toContain('firstTokenMs');
    expect(handler).toContain('promptChars');
    expect(handler).toContain('evidenceChars');
    expect(handler).not.toContain('prompt,\n');
  });
});
