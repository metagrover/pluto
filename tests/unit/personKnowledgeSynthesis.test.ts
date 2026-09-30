import { describe, expect, it } from 'vitest';
import {
  groundPersonKnowledgeV2Document,
  mergeKnowledgeV2Documents,
} from '../../electron/knowledgeV2';
import {
  compilePersonKnowledgeChunk,
  getPersonKnowledgeChunkPrompt,
} from '../../electron/personKnowledgeSynthesis';

const sources = [
  {
    id: 'meeting-one',
    title: 'Interface review',
    occurred_at: '2026-07-10T12:00:00.000Z',
    evidence: 'Summary: Avery added the client tenure to the UI.',
  },
  {
    id: 'meeting-two',
    title: 'Field review',
    occurred_at: '2026-07-12T12:00:00.000Z',
    evidence: 'Summary: Avery reviewed the tenure field.',
  },
];

describe('compact person knowledge synthesis', () => {
  it('asks for a small, corrected, source-linked response', () => {
    const prompt = getPersonKnowledgeChunkPrompt('Avery', sources, [
      {
        originalClaim: 'Avery owns the product',
        correctedText: 'No owner stated',
      },
    ]);
    expect(prompt).toContain('"topics"');
    expect(prompt).toContain('meeting-one');
    expect(prompt).toContain('No owner stated');
    expect(prompt).not.toContain('"needs_attention"');
  });

  it('compiles exact person observations into a grounded recurring read', () => {
    const chunk = compilePersonKnowledgeChunk('Avery', 0, sources, {
      topics: [
        {
          title: 'Interface and Data Validation',
          read: 'Avery added and reviewed the tenure field.',
          citations: [
            {
              meeting_id: 'meeting-one',
              quote: 'Avery added the client tenure to the UI.',
            },
            {
              meeting_id: 'meeting-two',
              quote: 'Avery reviewed the tenure field.',
            },
          ],
        },
        {
          title: 'Unsupported ownership',
          read: 'Avery owns the product.',
          citations: [
            { meeting_id: 'meeting-one', quote: 'Avery owns the product.' },
          ],
        },
      ],
    });
    const merged = mergeKnowledgeV2Documents(
      { type: 'person_context', title: 'Avery' },
      [chunk],
    );
    const grounded = groundPersonKnowledgeV2Document(
      merged,
      new Map(
        sources.map((source) => [source.id, source.evidence.toLowerCase()]),
      ),
      'Avery',
    );

    expect(chunk.active_streams).toHaveLength(1);
    expect(chunk.evidence_index).toHaveLength(2);
    expect(grounded.current_read.source_count).toBe(2);
    expect(grounded.current_read.headline).toContain('tenure field');
    expect(grounded.evidence_index).toHaveLength(2);
  });
});
