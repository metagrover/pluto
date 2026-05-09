import { describe, expect, it } from 'vitest';

import type { EntitySummary } from '../../src/api/knowledgeWorkspace';
import { resolveFocusSheetSummary } from '../../src/components/KnowledgeGraph/focusSheetSummary';

describe('resolveFocusSheetSummary', () => {
  it('uses the fetched summary for Pluto instead of hardcoded mock content', () => {
    const summary: EntitySummary = {
      sentences: [
        {
          text: 'Pluto is grounded in real project evidence.',
          source_meeting_ids: ['meeting-1'],
        },
      ],
      isInitialExtraction: false,
    };

    expect(resolveFocusSheetSummary('Pluto', summary)).toEqual(summary);
  });

  it('returns null when no summary was fetched', () => {
    expect(resolveFocusSheetSummary('Pluto', null)).toBeNull();
  });
});
