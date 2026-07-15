import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TranscriptIntegrityPanel } from '../../src/components/features/MeetingView';

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
});
