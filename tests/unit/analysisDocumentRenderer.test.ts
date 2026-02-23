import { describe, expect, it } from 'vitest';

import type { Meeting } from '../../src/types';
import {
  analysisDocumentToMarkdown,
  parseAnalysisMarkdown,
  resolveMeetingAnalysisDocument,
} from '../../src/utils/analysisDocument';

describe('renderer analysis document utilities', () => {
  it('parses canonical markdown with multiline bullets without line fragmentation', () => {
    const doc = parseAnalysisMarkdown(`## Summary
Conversation recap.

## Key Points
- First point
continues on next line.

## Action Items
- [ ] Draft fix PR guidance.

## Decisions
- Keep sandbox + allow list defaults.`);

    expect(doc?.key_points).toEqual(['First point continues on next line.']);
    expect(doc?.action_items).toEqual(['Draft fix PR guidance.']);
  });

  it('prefers structured analysis_json over markdown fallback', () => {
    const meeting = {
      id: 'm1',
      title: 'demo',
      created_at: '2026-02-13',
      started_at: '2026-02-13',
      analysis_json: JSON.stringify({
        analysis_schema_version: 2,
        summary: ['Structured summary'],
        key_points: ['Structured point'],
        action_items: [],
        decisions: [],
        quality: {
          format_pass: true,
          retry_count: 0,
          fallback_used: false,
          issues: [],
        },
      }),
      enhanced_notes: '## Summary\nFallback summary',
    };

    const doc = resolveMeetingAnalysisDocument(meeting as unknown as Meeting);

    expect(doc?.summary).toEqual(['Structured summary']);
    expect(doc?.key_points).toEqual(['Structured point']);
  });

  it('generates soft-empty canonical markdown defaults', () => {
    const markdown = analysisDocumentToMarkdown({
      analysis_schema_version: 2,
      summary: [],
      key_points: [],
      action_items: [],
      decisions: [],
      quality: {
        format_pass: false,
        retry_count: 1,
        fallback_used: true,
        issues: [],
      },
    });

    expect(markdown).toContain(
      '- [ ] No concrete action items were explicitly committed.',
    );
    expect(markdown).toContain('- No explicit decisions were made.');
  });
});
