import { describe, expect, it } from 'vitest';

import type { Meeting } from '../../src/types';
import {
  analysisDocumentToMarkdown,
  getAnalysisEditBlocks,
  isNoOpUserEdit,
  parseAnalysisEditConflictsJson,
  parseAnalysisMarkdown,
  parseUserEditsJson,
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

    const doc = resolveMeetingAnalysisDocument(meeting as Meeting);

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

  it('keeps only source keys that are explicitly mapped to renderer paths', () => {
    const blocks = getAnalysisEditBlocks({
      analysis_schema_version: 3,
      overview: 'Overview',
      topics: [
        {
          title: 'Topic',
          summary: 'Summary',
          key_points: [],
          decisions: [],
          action_items: [{ text: 'Send the draft' }],
          open_questions: [],
        },
      ],
      all_action_items: [{ text: 'Send the draft' }],
      all_decisions: [],
      meeting_type: 'general',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
      generation_metadata: {
        provider: 'ollama',
        model: 'local',
        generation_path: 'single_pass',
        prompt_version: 'notes-v9',
        generated_at: '2026-08-26T00:00:00.000Z',
        error_categories: [],
        source_provenance: {
          schema_version: 1,
          source_revision: 'source-a',
          blocks: {
            overview: {
              id: 'overview-source',
              sources: [{ segment: 0, start: 0, end: 1 }],
            },
            's0:item:0': {
              id: 'unmapped-draft-id',
              sources: [{ segment: 0, start: 1, end: 2 }],
            },
          },
        },
      },
    });

    expect(blocks).toContainEqual({
      path: 'overview',
      text: 'Overview',
      sourceKey: 'source-a|0:0:1',
    });
    expect(blocks).toContainEqual({
      path: 'all_action_items:0',
      text: 'Send the draft',
      sourceKey: null,
    });
    expect(blocks).toContainEqual({
      path: 'native_continuations:all_action_items:0',
      text: '[]',
      sourceKey: null,
    });
  });

  it('treats incomplete source-grounded provenance as a conflict boundary', () => {
    const blocks = getAnalysisEditBlocks({
      analysis_schema_version: 3,
      overview: 'Overview',
      topics: [],
      all_action_items: [],
      all_decisions: [],
      meeting_type: 'general',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
      generation_metadata: {
        provider: 'ollama',
        model: 'local',
        generation_path: 'single_pass',
        prompt_version: 'notes-v10',
        generated_at: '2026-08-26T00:00:00.000Z',
        error_categories: [],
        pipeline_version: 'writer-audit-v1',
        source_provenance: {
          schema_version: 1,
          source_revision: 'source-a',
          blocks: {},
        },
      },
    });

    expect(blocks).toEqual([]);
  });

  it('drops legacy whitespace-only overlays before rendering', () => {
    const edits = parseUserEditsJson(
      JSON.stringify({
        overview: {
          original: 'Generated wording.\r\n',
          edited: ' Generated wording.\n ',
          edited_at: '2026-08-26T00:00:00.000Z',
        },
      }),
    );

    expect(edits).toEqual({});
    expect(
      isNoOpUserEdit('Generated wording.\r\n', ' Generated wording.\n '),
    ).toBe(true);
  });

  it('returns no conflicts for malformed persisted conflict JSON', () => {
    expect(parseAnalysisEditConflictsJson('{broken')).toEqual([]);
    expect(parseAnalysisEditConflictsJson('[{"edited":42}]')).toEqual([]);
  });
});
