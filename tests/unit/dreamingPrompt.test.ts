import { describe, expect, it } from 'vitest';
import {
  DREAMING_MODEL,
  DREAMING_PROMPT_VERSION,
  buildDreamingGenerationRequest,
} from '../../electron/dreaming/prompt';
import type { DreamingInputPackage } from '../../electron/dreaming/types';

describe('buildDreamingGenerationRequest', () => {
  it('sends the complete bounded package and strict proposal contract to Gemma', () => {
    const input: DreamingInputPackage = {
      entityId: 'project-586',
      entityType: 'project',
      entityName: 'Memory Dreaming',
      currentBaseline: {
        summary: 'Existing accepted summary',
        milestones: ['Ship a proposal-only pipeline'],
      },
      recentMeetingNotes: [
        {
          meetingId: 'meeting-alpha',
          title: 'Architecture review',
          startedAt: '2026-09-01T17:00:00.000Z',
          notesContent:
            'Generation prepares proposals and never writes dossiers.',
        },
        {
          meetingId: 'meeting-beta',
          title: 'Trust review',
          startedAt: '2026-09-02T17:00:00.000Z',
          notesContent: 'Every proposal needs exact structured-note evidence.',
        },
      ],
      correctionFingerprints: [
        'project-summary-old-direction',
        'project-alias-dream-agent',
      ],
      negativeConstraints: ['legacy-correction-fingerprint'],
    };

    const request = buildDreamingGenerationRequest(input);

    expect(DREAMING_PROMPT_VERSION).toBe('dreaming-proposals-v1');
    expect(request).toMatchObject({
      model: DREAMING_MODEL,
      promptVersion: DREAMING_PROMPT_VERSION,
    });
    expect(DREAMING_MODEL).toBe('gemma4:12b');
    expect(request.prompt).toContain(DREAMING_PROMPT_VERSION);
    for (const expected of [
      'meeting-alpha',
      'meeting-beta',
      'Generation prepares proposals and never writes dossiers.',
      'Every proposal needs exact structured-note evidence.',
      'project-summary-old-direction',
      'project-alias-dream-agent',
      'legacy-correction-fingerprint',
      'Existing accepted summary',
    ]) {
      expect(request.prompt).toContain(expected);
    }

    expect(request.schema).toMatchObject({
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'proposals'],
          properties: {
            status: { const: 'no_change' },
            proposals: { type: 'array', maxItems: 0 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'proposals'],
          properties: {
            status: { const: 'proposed' },
            proposals: {
              type: 'array',
              minItems: 1,
              items: {
                oneOf: expect.arrayContaining([
                  expect.objectContaining({
                    additionalProperties: false,
                    required: ['kind', 'payload', 'evidence'],
                    properties: expect.objectContaining({
                      kind: { const: 'project_summary' },
                    }),
                  }),
                ]),
              },
            },
          },
        },
      ],
    });

    const proposedBranch = (
      request.schema as {
        oneOf: Array<{
          properties: {
            proposals?: {
              items?: { oneOf?: Array<Record<string, unknown>> };
            };
          };
        }>;
      }
    ).oneOf[1];
    const proposalVariants =
      proposedBranch.properties.proposals?.items?.oneOf ?? [];
    expect(
      proposalVariants.map(
        (variant) =>
          (variant.properties as { kind: { const: string } }).kind.const,
      ),
    ).toEqual([
      'project_summary',
      'project_milestone',
      'project_commitment',
      'project_alias',
    ]);
    for (const variant of proposalVariants) {
      const properties = variant.properties as {
        payload: Record<string, unknown>;
        evidence: { items: Record<string, unknown> };
      };
      expect(variant).toMatchObject({
        additionalProperties: false,
        required: ['kind', 'payload', 'evidence'],
      });
      expect(properties.payload).toMatchObject({ additionalProperties: false });
      expect(properties.evidence.items).toMatchObject({
        additionalProperties: false,
        required: ['meetingId', 'excerpt'],
      });
    }
  });
});
