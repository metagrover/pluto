import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  TranscriptIntegrityPanel,
  canGenerateMeetingIntelligence,
} from '../../src/components/features/MeetingView';

describe('MeetingView transcript integrity', () => {
  it('offers a content-free retry when a transcript needs attention', () => {
    const markup = renderToStaticMarkup(
      <TranscriptIntegrityPanel status="needs_attention" onRetry={vi.fn()} />,
    );

    expect(markup).toContain('Transcript needs attention');
    expect(markup).toContain(
      'The recording is safe, but Pluto could not account for all captured speech.',
    );
    expect(markup).toContain('Retry transcript validation');
  });

  it('blocks derived intelligence until validation succeeds', () => {
    expect(canGenerateMeetingIntelligence('needs_attention')).toBe(false);
    expect(canGenerateMeetingIntelligence('validating')).toBe(false);
    expect(canGenerateMeetingIntelligence('validated')).toBe(true);
    expect(canGenerateMeetingIntelligence(undefined)).toBe(true);
  });

  it('renders durable retry stage and recoverable timeout state', () => {
    const validating = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="validating"
        integrityJson={JSON.stringify({ retry: { stage: 'transcribing' } })}
      />,
    );
    const timedOut = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        integrityJson={JSON.stringify({ retryFailure: 'retry_timeout' })}
      />,
    );

    expect(validating).toContain('Transcribing the preserved recording.');
    expect(timedOut).toContain('stopped after its safety deadline');
  });
});
