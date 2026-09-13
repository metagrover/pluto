import { vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  net: {},
  session: {},
}));

import { describe, expect, it } from 'vitest';
import {
  parseDuckDuckGoHtml,
  sanitizeWebResearchQuery,
} from '../../electron/web/localWebResearch';

describe('local web research', () => {
  it('removes identity and direct identifiers before searching', () => {
    const result = sanitizeWebResearchQuery(
      'How should I give Maya Patel feedback after “Project Atlas failed” at Acme Corp? maya@acme.test 12345',
      ['Maya Patel', 'Acme Corp', 'Project Atlas'],
    );
    expect(result).not.toContain('maya');
    expect(result).not.toContain('acme');
    expect(result).not.toContain('atlas');
    expect(result).not.toContain('12345');
    expect(result).toBe(
      'workplace giving constructive feedback best practices',
    );
    expect(result.length).toBeLessThanOrEqual(160);
  });

  it('generalizes unknown meeting specifics instead of forwarding them', () => {
    const result = sanitizeWebResearchQuery(
      'Find sources about the confidential Orion launch delay and Blue Harbor pricing dispute',
    );
    expect(result).toBe(
      'workplace professional relationship advice current research',
    );
    expect(result).not.toMatch(/orion|harbor|pricing|launch|delay/i);
  });

  it('extracts bounded HTTPS organic results and unwraps redirect URLs', () => {
    const html = `
      <div class="result results_links">
        <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffeedback">Giving feedback well</a></h2>
        <a class="result__snippet">A practical guide to useful feedback.</a>
      </div>
      <div class="result results_links">
        <h2><a class="result__a" href="http://unsafe.example/test">Unsafe</a></h2>
      </div>
      <div class="result results_links">
        <h2><a class="result__a" href="https://127.0.0.1/private">Private network</a></h2>
      </div>`;
    expect(parseDuckDuckGoHtml(html)).toEqual([
      {
        title: 'Giving feedback well',
        url: 'https://example.com/feedback',
        domain: 'example.com',
        snippet: 'A practical guide to useful feedback.',
      },
    ]);
  });
});
