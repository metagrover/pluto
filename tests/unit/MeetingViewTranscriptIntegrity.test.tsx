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
    expect(canGenerateMeetingIntelligence('needs_attention', 'finalized')).toBe(
      false,
    );
    expect(canGenerateMeetingIntelligence('validating', 'finalized')).toBe(
      false,
    );
    expect(canGenerateMeetingIntelligence('validated', 'finalized')).toBe(
      true,
    );
    expect(canGenerateMeetingIntelligence(undefined, undefined)).toBe(true);
    expect(
      canGenerateMeetingIntelligence('validated', 'recovery_required'),
    ).toBe(false);
  });

  it('shows a recovery-required meeting without offering transcript retry', () => {
    const markup = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        finalizationStatus="recovery_required"
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('Recording saved');
    expect(markup).toContain(
      'Processing needs recovery before this meeting is complete.',
    );
    expect(markup).not.toContain('Retry transcript validation');
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
