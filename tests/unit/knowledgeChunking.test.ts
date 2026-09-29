import { describe, expect, it } from 'vitest';

import {
  buildDeterministicKnowledgeDocument,
  buildKnowledgeSourceChunks,
  chooseKnowledgeMergeResult,
  mergeChunkStructuredDocuments,
  splitKnowledgeSourceChunk,
} from '../../electron/knowledgeChunking';

const makeSource = (id: number) => ({
  id: `m${id}`,
  title: `Meeting ${id}`,
  occurred_at: `2026-04-${String(id).padStart(2, '0')}`,
  evidence: `Evidence for meeting ${id}`,
});

const makeStatement = (id: string, meetingId: string, text: string) => ({
  id,
  text,
  why_it_matters: `${text} matters because it changes active work.`,
  citations: [{ meeting_id: meetingId, quote: `Evidence for ${meetingId}` }],
});

describe('knowledge chunking', () => {
  it('splits source meetings into bounded local-model chunks', () => {
    const chunks = buildKnowledgeSourceChunks(
      Array.from({ length: 25 }, (_, index) => makeSource(index + 1)),
      10,
    );

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.sourceMeetings.length)).toEqual([
      10, 10, 5,
    ]);
    expect(chunks[0].label).toBe('Chunk 1 of 3');
    expect(chunks[2].sourceMeetings[0].id).toBe('m21');
  });

  it('publishes a small first person chunk before processing the rest', () => {
    const chunks = buildKnowledgeSourceChunks(
      Array.from({ length: 14 }, (_, index) => makeSource(index + 1)),
      6,
      2,
    );

    expect(chunks.map((chunk) => chunk.sourceMeetings.length)).toEqual([
      2, 6, 6,
    ]);
    expect(chunks.map((chunk) => chunk.label)).toEqual([
      'Chunk 1 of 3',
      'Chunk 2 of 3',
      'Chunk 3 of 3',
    ]);
    expect(
      chunks.flatMap((chunk) => chunk.sourceMeetings.map((item) => item.id)),
    ).toEqual(Array.from({ length: 14 }, (_, index) => `m${index + 1}`));
  });

  it('splits a failed chunk into smaller retry chunks', () => {
    const [chunk] = buildKnowledgeSourceChunks(
      Array.from({ length: 9 }, (_, index) => makeSource(index + 1)),
      12,
    );

    const retries = splitKnowledgeSourceChunk(chunk);

    expect(retries.map((retry) => retry.label)).toEqual([
      'Chunk 1 of 1 retry 1',
      'Chunk 1 of 1 retry 2',
    ]);
    expect(retries.map((retry) => retry.sourceMeetings.length)).toEqual([5, 4]);
    expect(retries[1].sourceMeetings[0].id).toBe('m6');
  });

  it('merges chunk documents with section caps and citation-preserving dedupe', () => {
    const merged = mergeChunkStructuredDocuments(
      {
        type: 'global',
        title: 'Global Knowledge Context',
      },
      [
        {
          schema_version: 1,
          scope: { type: 'global', title: 'Chunk 1' },
          chapters: [
            {
              chapter_id: 'chunk-1',
              title: 'Chunk 1',
              decisions: [
                makeStatement(
                  'd1',
                  'm1',
                  'Use chunked synthesis for Knowledge.',
                ),
              ],
              topic_evolution: [],
              open_risks: [
                makeStatement('r1', 'm2', 'Single-pass synthesis can fail.'),
              ],
              signals: [],
            },
          ],
          dependency_suggestions: [],
        },
        {
          schema_version: 1,
          scope: { type: 'global', title: 'Chunk 2' },
          chapters: [
            {
              chapter_id: 'chunk-2',
              title: 'Chunk 2',
              decisions: [
                makeStatement(
                  'd2',
                  'm3',
                  'Use chunked synthesis for Knowledge.',
                ),
              ],
              topic_evolution: [],
              open_risks: [
                makeStatement(
                  'r2',
                  'm4',
                  'Retry should preserve last known context.',
                ),
              ],
              signals: [],
            },
          ],
          dependency_suggestions: [],
        },
      ],
    );

    expect(merged.scope).toEqual({
      type: 'global',
      title: 'Global Knowledge Context',
    });
    expect(merged.chapters).toHaveLength(1);
    expect(merged.chapters[0].decisions).toHaveLength(1);
    expect(merged.chapters[0].open_risks.map((item) => item.text)).toEqual([
      'Single-pass synthesis can fail.',
      'Retry should preserve last known context.',
    ]);
    expect(merged.chapters[0].decisions[0].citations[0].meeting_id).toBe('m1');
  });

  it('keeps the deterministic merge when an LLM merge drops most facts', () => {
    const fallback = mergeChunkStructuredDocuments(
      {
        type: 'global',
        title: 'Global Knowledge Context',
      },
      [
        {
          schema_version: 1,
          scope: { type: 'global', title: 'Chunk 1' },
          chapters: [
            {
              chapter_id: 'chunk-1',
              title: 'Chunk 1',
              decisions: [
                makeStatement('d1', 'm1', 'Use chunked synthesis.'),
                makeStatement('d2', 'm2', 'Preserve cited facts.'),
              ],
              topic_evolution: [],
              open_risks: [
                makeStatement('r1', 'm3', 'Lossy merge can erase context.'),
                makeStatement(
                  'r2',
                  'm4',
                  'Thin output misleads the dashboard.',
                ),
              ],
              signals: [],
            },
          ],
          dependency_suggestions: [],
        },
      ],
    );
    const lossyCandidate = {
      schema_version: 1,
      scope: { type: 'global', title: 'Global Knowledge Context' },
      chapters: [
        {
          chapter_id: 'llm',
          title: 'LLM Merge',
          decisions: [makeStatement('d1', 'm1', 'Use chunked synthesis.')],
          topic_evolution: [],
          open_risks: [],
          signals: [],
        },
      ],
      dependency_suggestions: [],
    };

    const chosen = chooseKnowledgeMergeResult(fallback, lossyCandidate);

    expect(chosen).toBe(fallback);
    expect(chosen.chapters[0].open_risks).toHaveLength(2);
  });

  it('builds a useful deterministic brief from source meeting evidence', () => {
    const doc = buildDeterministicKnowledgeDocument(
      {
        type: 'global',
        title: 'Global Knowledge Context',
      },
      [
        {
          id: 'm1',
          title: 'Context Studio Review',
          occurred_at: '2026-04-10',
          evidence:
            'Summary: The team focused on context studio for assembling business context. | API layer work needs provenance.\nKey points: Connect snippets to reasoning chains. | Expose relationships across domain services.\nAction items: Resolve pending graph schema approval.\nDecisions: Put context studio on top of the knowledge graph.',
        },
        {
          id: 'm2',
          title: 'Advisor Agent Deployment',
          occurred_at: '2026-04-07',
          evidence:
            'Summary: The rollout depends on UAT and API instrumentation.\nKey points: Repository cleanup is active. | API instrumentation remains unresolved.\nAction items: Prepare deployment instrumentation.',
        },
      ],
    );

    expect(doc.chapters).toHaveLength(1);
    expect(doc.chapters[0].decisions.map((item) => item.text)).toContain(
      'Put context studio on top of the knowledge graph.',
    );
    expect(doc.chapters[0].open_risks.map((item) => item.text)).toContain(
      'Resolve pending graph schema approval.',
    );
    expect(doc.chapters[0].signals.length).toBeGreaterThanOrEqual(3);
    expect(doc.chapters[0].signals[0].citations[0]).toMatchObject({
      meeting_id: 'm1',
    });
  });

  it('keeps routine and personal follow-ups in global knowledge without treating them as decisions', () => {
    const doc = buildDeterministicKnowledgeDocument(
      {
        type: 'global',
        title: 'Global Knowledge Context',
      },
      [
        {
          id: 'travel',
          title: 'Travel Plans for Berlin Trip',
          occurred_at: '2026-03-19',
          evidence:
            "Summary: The user is planning a trip to Berlin.\nAction items: Review the user's travel dates and itinerary. | Research bike-friendly routes in Germany.\nDecisions: No explicit decisions were made.",
        },
        {
          id: 'deployment',
          title: 'Advisor Agent Deployment',
          occurred_at: '2026-04-07',
          evidence:
            'Summary: The rollout depends on UAT and API instrumentation.\nAction items: Merge a pull request after cleanup. | Resolve pending approval for API instrumentation.\nAccountability risks: Approval is still pending for API instrumentation.',
        },
      ],
    );
    const chapter = doc.chapters[0];

    expect(chapter.decisions.map((item) => item.text)).not.toContain(
      'No explicit decisions were made.',
    );
    expect(chapter.open_risks.map((item) => item.text)).toEqual([
      "Review the user's travel dates and itinerary.",
      'Research bike-friendly routes in Germany.',
      'Merge a pull request after cleanup.',
      'Resolve pending approval for API instrumentation.',
      'Approval is still pending for API instrumentation.',
    ]);
    expect(chapter.signals.map((item) => item.text)).toContain(
      'The user is planning a trip to Berlin.',
    );
  });
});
