import { describe, expect, it } from 'vitest';

import { parseKnowledgeJsonResponse } from '../../electron/knowledgeJson';

describe('parseKnowledgeJsonResponse', () => {
  it('parses JSON inside markdown fences', () => {
    expect(parseKnowledgeJsonResponse('```json\n{"chapters":[]}\n```')).toEqual(
      {
        chapters: [],
      },
    );
  });

  it('extracts the JSON object when the model adds commentary', () => {
    expect(
      parseKnowledgeJsonResponse('Here is the JSON:\n{"chapters":[]}\nDone.'),
    ).toEqual({ chapters: [] });
  });

  it('repairs missing commas between object properties', () => {
    const parsed = parseKnowledgeJsonResponse(
      '{"text":"Single-pass synthesis can fail" "why_it_matters":"Local models need smaller chunks" "citations":[]}',
    ) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      text: 'Single-pass synthesis can fail',
      why_it_matters: 'Local models need smaller chunks',
      citations: [],
    });
  });

  it('removes trailing commas before closing braces and brackets', () => {
    expect(
      parseKnowledgeJsonResponse('{"chapters":[],"signals":[1,],}'),
    ).toEqual({
      chapters: [],
      signals: [1],
    });
  });

  it('repairs missing commas after arrays and nested objects', () => {
    expect(
      parseKnowledgeJsonResponse(
        '{"scope":{"type":"global"} "chapters":[] "dependency_suggestions":[]}',
      ),
    ).toEqual({
      scope: { type: 'global' },
      chapters: [],
      dependency_suggestions: [],
    });
  });

  it('repairs missing commas between array items', () => {
    expect(
      parseKnowledgeJsonResponse('{"chapters":[{"title":"A"} {"title":"B"}]}'),
    ).toEqual({
      chapters: [{ title: 'A' }, { title: 'B' }],
    });
  });

  it('repairs missing commas after scalar property values', () => {
    expect(
      parseKnowledgeJsonResponse(
        '{"schema_version":1 "is_compiled":true "scope":null "chapters":[]}',
      ),
    ).toEqual({
      schema_version: 1,
      is_compiled: true,
      scope: null,
      chapters: [],
    });
  });

  it('escapes unescaped quotes inside string values', () => {
    expect(
      parseKnowledgeJsonResponse(
        '{"citations":[{"meeting_id":"m1","quote":"Taylor said "use smaller chunks" before retrying."}]}',
      ),
    ).toEqual({
      citations: [
        {
          meeting_id: 'm1',
          quote: 'Taylor said "use smaller chunks" before retrying.',
        },
      ],
    });
  });
});
