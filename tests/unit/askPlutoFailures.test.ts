import { describe, expect, it } from 'vitest';

import { classifyAskPlutoFailure } from '../../electron/intelligence/askPlutoFailures';

describe('classifyAskPlutoFailure', () => {
  it('distinguishes local timeouts from an unavailable provider', () => {
    expect(
      classifyAskPlutoFailure(new DOMException('Timed out', 'TimeoutError')),
    ).toMatchObject({
      reason: 'timeout',
      answer: expect.stringContaining('took longer than expected'),
    });
    expect(
      classifyAskPlutoFailure(new TypeError('fetch failed: ECONNREFUSED')),
    ).toMatchObject({
      reason: 'provider_unavailable',
      answer: expect.stringContaining('local answer model is not reachable'),
    });
  });

  it('reports malformed model output as a response problem, not availability', () => {
    expect(
      classifyAskPlutoFailure(
        new SyntaxError('Unexpected token in JSON at position 21'),
      ),
    ).toMatchObject({
      reason: 'invalid_response',
      answer: expect.stringContaining('incomplete or invalid response'),
    });
  });

  it('keeps unknown generation failures truthful without exposing internals', () => {
    expect(
      classifyAskPlutoFailure(new Error('opaque internal detail')),
    ).toEqual({
      reason: 'generation_failed',
      answer:
        'Pluto found relevant meeting evidence, but could not finish the answer. Your question and sources are still here, so you can retry.',
    });
  });
});
