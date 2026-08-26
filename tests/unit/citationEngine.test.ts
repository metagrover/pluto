import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '../../electron/db';
import {
  auditAnswerGrounding,
  auditCitations,
  buildCitationChain,
  buildSafeAnswerPresentation,
  claimIsSupportedByEvidence,
  createValidatedAnswerStream,
} from '../../electron/intelligence/citationEngine';
import type { RetrievalResult } from '../../electron/intelligence/intelligenceTypes';

vi.mock('../../electron/db', () => ({
  getEntity: vi.fn(),
  getMeetingMid: vi.fn(),
}));

describe('Citation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildCitationChain', () => {
    it('extracts citation tags from LLM output correctly', () => {
      const answer =
        'Here is what happened: <cite meeting="m1" entity="e1" quote="let\'s migrate">We decided to migrate</cite>. Later, <cite meeting="m2">No quote</cite>.';

      const context = [
        { meeting_id: 'm1', mid: { title: 'First Meeting' } },
        { meeting_id: 'm2', mid: { title: 'Second Meeting' } },
      ] as RetrievalResult[];

      const citations = buildCitationChain(answer, context);

      expect(citations.length).toBe(2);
      expect(citations[0]).toMatchObject({
        meeting_id: 'm1',
        entity_id: 'e1',
        evidence_span: "let's migrate",
        claim: 'We decided to migrate',
        meeting_title: 'First Meeting',
        evidence_valid: false,
      });

      expect(citations[1]).toMatchObject({
        meeting_id: 'm2',
        evidence_span: undefined,
        claim: 'No quote',
        meeting_title: 'Second Meeting',
        evidence_valid: false,
      });
    });

    it('keeps separate claims that cite the same meeting', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Launch review',
          evidence_text: 'Sam owns signoff.\nThe launch is Friday.',
          mid: {
            title: 'Launch review',
            evidence_spans: [
              { quote: 'Sam owns signoff.' },
              { quote: 'The launch is Friday.' },
            ],
          },
        },
      ] as RetrievalResult[];

      const citations = buildCitationChain(
        'Sam owns signoff. [Source 1] The launch is Friday. [Source 1]',
        context,
      );

      expect(citations).toHaveLength(2);
      expect(citations.map((citation) => citation.claim)).toEqual([
        'Sam owns signoff.',
        'The launch is Friday.',
      ]);
    });

    it('attaches consecutive source references to the same comparative claim', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Earlier plan',
          evidence_text: 'The launch was Tuesday.',
          mid: null,
        },
        {
          meeting_id: 'm2',
          meeting_title: 'Current plan',
          evidence_text: 'The launch is Friday.',
          mid: null,
        },
      ] as RetrievalResult[];

      const citations = buildCitationChain(
        'The launch moved from Tuesday to Friday. [Source 1] [Source 2]',
        context,
      );

      expect(citations.map((citation) => citation.claim)).toEqual([
        'The launch moved from Tuesday to Friday.',
        'The launch moved from Tuesday to Friday.',
      ]);
    });
  });

  describe('createValidatedAnswerStream', () => {
    const sources = [
      {
        meeting_id: 'm1',
        meeting_title: 'Launch review',
        evidence_text: 'Sam owns launch signoff. The launch is Friday.',
        mid: {
          title: 'Launch review',
          evidence_spans: [
            { quote: 'Sam owns launch signoff.' },
            { quote: 'The launch is Friday.' },
          ],
        },
      },
    ] as RetrievalResult[];

    it('never exposes unsupported provider prose before the no-evidence result', () => {
      const onDelta = vi.fn();
      const stream = createValidatedAnswerStream(sources, onDelta);

      stream.push('Sam approved a Monday launch. ');
      stream.push('[Source 1]');
      const presentation = stream.finalize(
        'Sam approved a Monday launch. [Source 1]',
      );

      expect(onDelta).not.toHaveBeenCalled();
      expect(stream.streamedAnswer).toBe('');
      expect(presentation.outcome).toBe('no_evidence');
    });

    it('streams a supported claim only after its citation passes validation', () => {
      const deltas: string[] = [];
      const stream = createValidatedAnswerStream(sources, (delta) =>
        deltas.push(delta),
      );

      stream.push('Sam owns launch signoff. ');
      expect(deltas).toEqual([]);
      stream.push('[Source 1]');

      const presentation = stream.finalize(
        'Sam owns launch signoff. [Source 1]',
      );
      expect(deltas.join('')).toBe('Sam owns launch signoff.');
      expect(presentation.answer).toBe(deltas.join(''));
      expect(presentation.outcome).toBe('answered');
    });

    it('streams a supported cited bullet without requiring final punctuation', () => {
      const deltas: string[] = [];
      const stream = createValidatedAnswerStream(sources, (delta) =>
        deltas.push(delta),
      );

      stream.push('- Sam owns launch signoff ');
      stream.push('[Source 1]');

      expect(deltas.join('')).toBe('- Sam owns launch signoff');
    });
  });

  describe('auditCitations', () => {
    it('audits valid citations successfully', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue({
        evidence_spans: [{ quote: 'hello this is a test' }],
      } as unknown as ReturnType<typeof dbModule.getMeetingMid>);

      vi.mocked(dbModule.getEntity).mockReturnValue({
        id: 'e1',
      } as unknown as dbModule.Entity);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          entity_id: 'e1',
          evidence_span: 'this is a test',
          evidence_valid: false,
          meeting_title: 'Meeting 1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(true);
    });

    it('fails audit if meeting is not found', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue(null);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          evidence_valid: false,
          meeting_title: 'M1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(false);
    });

    it('fails audit if entity is not found', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue(
        {} as ReturnType<typeof dbModule.getMeetingMid>,
      );
      vi.mocked(dbModule.getEntity).mockReturnValue(undefined);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          entity_id: 'e_invalid',
          evidence_valid: false,
          meeting_title: 'M1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(false);
    });

    it('fails audit if evidence span is missing from MID', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue({
        evidence_spans: [{ quote: 'some other thing entirely' }],
      } as unknown as ReturnType<typeof dbModule.getMeetingMid>);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          evidence_span: 'not found quote',
          evidence_valid: false,
          meeting_title: 'M1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(false);
    });

    it('does not ground a structurally valid citation whose evidence does not support the claim', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Launch review',
          evidence_text: 'Sam will prepare the launch checklist.',
          mid: {
            evidence_spans: [
              { quote: 'Sam will prepare the launch checklist.' },
            ],
          },
        },
      ] as RetrievalResult[];
      vi.mocked(dbModule.getMeetingMid).mockReturnValue(
        context[0].mid as ReturnType<typeof dbModule.getMeetingMid>,
      );

      const audited = auditCitations(
        buildCitationChain('Alex owns pricing approval. [Source 1]', context),
        context,
      );

      expect(audited[0]).toMatchObject({
        evidence_valid: false,
        trust_status: 'needs_review',
      });
    });

    it('rejects a different named owner even when the rest of the claim matches', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Pricing review',
          evidence_text: 'Sam owns pricing approval.',
          mid: { evidence_spans: [{ quote: 'Sam owns pricing approval.' }] },
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        [
          {
            claim: 'Alex owns pricing approval.',
            meeting_id: 'm1',
            meeting_title: 'Pricing review',
            evidence_span: 'Sam owns pricing approval.',
            evidence_valid: false,
            trust_status: 'needs_review',
          },
        ],
        context,
      );

      expect(audited[0].evidence_valid).toBe(false);
    });

    it('rejects evidence that reverses the scope of a negation', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Pricing review',
          evidence_text: 'Alex does not own pricing; Sam does.',
          mid: {
            evidence_spans: [{ quote: 'Alex does not own pricing; Sam does.' }],
          },
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        [
          {
            claim: 'Sam does not own pricing; Alex does.',
            meeting_id: 'm1',
            meeting_title: 'Pricing review',
            evidence_span: 'Alex does not own pricing; Sam does.',
            evidence_valid: false,
            trust_status: 'needs_review',
          },
        ],
        context,
      );

      expect(audited[0].evidence_valid).toBe(false);
    });

    it('keeps supported live evidence provisional rather than grounded', () => {
      const context = [
        {
          meeting_id: 'live-1',
          meeting_title: 'Current recording',
          evidence_text:
            '[Current recording - provisional]: Current recording\n[Live transcript - provisional]:\nSam: The launch is Friday.',
          mid: null,
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        buildCitationChain('The launch is Friday. [Source 1]', context),
        context,
      );

      expect(audited[0]).toMatchObject({
        evidence_valid: true,
        trust_status: 'inferred',
      });
      expect(
        auditAnswerGrounding('The launch is Friday. [Source 1]', audited),
      ).toEqual({ trustStatus: 'inferred', unsupportedClaimCount: 0 });
    });

    it('selects the evidence span that best supports the cited claim', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Launch review',
          evidence_text:
            'The launch is Friday.\nSam owns the launch checklist and final signoff.',
          mid: {
            evidence_spans: [
              { quote: 'The launch is Friday.' },
              { quote: 'Sam owns the launch checklist and final signoff.' },
            ],
          },
        },
      ] as RetrievalResult[];
      vi.mocked(dbModule.getMeetingMid).mockReturnValue(
        context[0].mid as ReturnType<typeof dbModule.getMeetingMid>,
      );

      const audited = auditCitations(
        buildCitationChain(
          'Sam owns the launch checklist and final signoff. [Source 1]',
          context,
        ),
        context,
      );

      expect(audited[0]).toMatchObject({
        evidence_span: 'Sam owns the launch checklist and final signoff.',
        evidence_valid: true,
        trust_status: 'grounded',
      });
    });

    it('keeps the matching passage when support appears late in a long analysis line', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Recording review',
          evidence_text: `[Analysis]: ${'Unrelated setup sentence. '.repeat(20)}The recorder consistently misses the first twenty seconds of audio.`,
          mid: null,
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        buildCitationChain(
          'The recorder consistently misses the first twenty seconds of audio. [Source 1]',
          context,
        ),
        context,
      );

      expect(audited[0]).toMatchObject({
        evidence_span:
          'The recorder consistently misses the first twenty seconds of audio.',
        evidence_valid: true,
      });
    });

    it('uses the persisted meeting title as support when a claim names its source meeting', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Transcription System Performance Review',
          evidence_text:
            'The team identified a recording delay missing the first twenty seconds of audio.',
          mid: null,
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        buildCitationChain(
          'During the Transcription System Performance Review, the team identified a recording delay missing the first twenty seconds of audio. [Source 1]',
          context,
        ),
        context,
      );

      expect(audited[0].evidence_valid).toBe(true);
    });

    it('does not treat a sentence-start pronoun as an unsupported named entity', () => {
      expect(
        claimIsSupportedByEvidence(
          'They evaluated whether live transcription refinement is necessary.',
          'The team evaluated whether live transcription refinement is necessary.',
        ),
      ).toBe(true);
    });

    it('allows a supported positive claim when evidence has an unrelated negative detail', () => {
      expect(
        claimIsSupportedByEvidence(
          "One speaker expressed embarrassment about the application's origin and questioned who initiated it.",
          "The speaker expressed embarrassment about the application's origin, stated it was not their idea, and questioned who initiated it.",
        ),
      ).toBe(true);
    });

    it('uses structured MID action items exposed to the answer prompt as evidence', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Transcription review',
          evidence_text: 'The team reviewed transcription performance.',
          mid: {
            action_items: [
              {
                description:
                  'Evaluate whether live transcription refinement is necessary.',
              },
            ],
          },
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        buildCitationChain(
          'Evaluate whether live transcription refinement is necessary. [Source 1]',
          context,
        ),
        context,
      );

      expect(audited[0]).toMatchObject({
        evidence_span:
          'Evaluate whether live transcription refinement is necessary.',
        evidence_valid: true,
      });
    });

    it('combines adjacent evidence lines when a concise claim spans both', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Knowledge cafe',
          evidence_text:
            'The knowledge cafe slides were discussed.\nThe slides will be shared with the group.',
          mid: null,
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        buildCitationChain(
          'The knowledge cafe slides will be shared with the group. [Source 1]',
          context,
        ),
        context,
      );

      expect(audited[0].evidence_valid).toBe(true);
      expect(audited[0].evidence_span).toContain('knowledge cafe slides');
      expect(audited[0].evidence_span).toContain('shared with the group');
    });

    it('audits a meeting-level synthesis against the complete retrieved evidence', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Advisor review',
          evidence_text: `[Transcript excerpt 1/2]: Snowflake signals and revenue data were reviewed.\n${'Unrelated implementation detail. '.repeat(15)}\n[Transcript excerpt 2/2]: Advisor notifications will guide client follow-ups.`,
          mid: null,
        },
      ] as RetrievalResult[];

      const audited = auditCitations(
        buildCitationChain(
          'Snowflake signals and revenue data will guide advisor notifications and client follow-ups. [Source 1]',
          context,
        ),
        context,
      );

      expect(audited[0].evidence_valid).toBe(true);
    });

    it('rejects evidence that reverses the claim with negation', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Launch review',
          evidence_text: 'Sam does not own the launch checklist.',
          mid: {
            evidence_spans: [
              { quote: 'Sam does not own the launch checklist.' },
            ],
          },
        },
      ] as RetrievalResult[];
      vi.mocked(dbModule.getMeetingMid).mockReturnValue(
        context[0].mid as ReturnType<typeof dbModule.getMeetingMid>,
      );

      const audited = auditCitations(
        buildCitationChain(
          'Sam owns the launch checklist. [Source 1]',
          context,
        ),
        context,
      );

      expect(audited[0].evidence_valid).toBe(false);
    });

    it('audits a comparison against the combined evidence from both cited meetings', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Earlier plan',
          evidence_text: 'The launch was Tuesday.',
          mid: null,
        },
        {
          meeting_id: 'm2',
          meeting_title: 'Current plan',
          evidence_text: 'The launch is Friday.',
          mid: null,
        },
      ] as RetrievalResult[];
      const raw = buildCitationChain(
        'The launch moved from Tuesday to Friday. [Source 1] [Source 2]',
        context,
      );

      const audited = auditCitations(raw, context);

      expect(audited).toHaveLength(2);
      expect(audited.every((citation) => citation.evidence_valid)).toBe(true);
    });
  });

  describe('auditAnswerGrounding', () => {
    it('marks material uncited claims as needing review', () => {
      const answer =
        'Sam owns launch signoff. [Source 1] Alex owns pricing approval.';
      const citations = [
        {
          claim: 'Sam owns launch signoff.',
          meeting_id: 'm1',
          meeting_title: 'Launch review',
          evidence_span: 'Sam owns launch signoff.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      expect(auditAnswerGrounding(answer, citations)).toEqual({
        trustStatus: 'needs_review',
        unsupportedClaimCount: 1,
      });
    });

    it('requires comparative claims to cite at least two meetings', () => {
      const answer =
        'The launch moved later compared with the prior plan. [Source 1]';
      const citations = [
        {
          claim: 'The launch moved later compared with the prior plan.',
          meeting_id: 'm1',
          meeting_title: 'Launch review',
          evidence_span: 'The launch moved later.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      expect(auditAnswerGrounding(answer, citations)).toEqual({
        trustStatus: 'needs_review',
        unsupportedClaimCount: 1,
      });
    });

    it('marks a fully supported two-meeting comparison as inferred', () => {
      const answer =
        'The launch moved from Tuesday to Friday. [Source 1] [Source 2]';
      const citations = [
        {
          claim: 'The launch moved from Tuesday to Friday.',
          meeting_id: 'm1',
          meeting_title: 'Earlier plan',
          evidence_span: 'The launch was planned for Tuesday.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
        {
          claim: 'The launch moved from Tuesday to Friday.',
          meeting_id: 'm2',
          meeting_title: 'Current plan',
          evidence_span: 'The launch is now Friday.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      expect(auditAnswerGrounding(answer, citations)).toEqual({
        trustStatus: 'inferred',
        unsupportedClaimCount: 0,
      });
    });
  });

  describe('buildSafeAnswerPresentation', () => {
    it('omits grounded but contextless claims that are not useful as chat answers', () => {
      const vague = {
        claim:
          "One speaker expressed embarrassment regarding an application's origin.",
        meeting_id: 'meeting-1',
        meeting_title: 'Meeting',
        evidence_span:
          "One speaker expressed embarrassment regarding an application's origin.",
        evidence_valid: true,
        trust_status: 'grounded' as const,
      };

      expect(
        buildSafeAnswerPresentation(`${vague.claim} [Source 1]`, [vague]),
      ).toMatchObject({
        outcome: 'no_evidence',
        citations: [],
        unsupportedClaimCount: 1,
      });
    });

    it('treats a refusal as no evidence rather than a grounded answer', () => {
      expect(
        buildSafeAnswerPresentation(
          "I couldn't find information about that in your meetings.",
          [],
        ),
      ).toEqual({
        answer: "I couldn't find information about that in your meetings.",
        citations: [],
        outcome: 'no_evidence',
        trustStatus: undefined,
        unsupportedClaimCount: 0,
      });
    });

    it('removes unsupported prose and keeps verified claims as a partial answer', () => {
      const citations = [
        {
          claim: 'Sam owns pricing approval.',
          meeting_id: 'm1',
          meeting_title: 'Pricing review',
          evidence_span: 'Sam owns pricing approval.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
        {
          claim: 'The launch moved to Friday.',
          meeting_id: 'm2',
          meeting_title: 'Launch review',
          evidence_span: 'The launch is Tuesday.',
          evidence_valid: false,
          trust_status: 'needs_review' as const,
        },
      ];

      expect(
        buildSafeAnswerPresentation(
          'Sam owns pricing approval. [Source 1] The launch moved to Friday. [Source 2]',
          citations,
        ),
      ).toMatchObject({
        answer: 'Sam owns pricing approval.',
        citations: [citations[0]],
        outcome: 'partial',
        trustStatus: 'grounded',
        unsupportedClaimCount: 1,
      });
    });

    it('preserves readable line breaks between supported bullets', () => {
      const citations = [
        {
          claim: '- Sam owns pricing approval.',
          meeting_id: 'm1',
          meeting_title: 'Pricing review',
          evidence_span: 'Sam owns pricing approval.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
        {
          claim: '- The launch is Friday.',
          meeting_id: 'm2',
          meeting_title: 'Launch review',
          evidence_span: 'The launch is Friday.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      expect(
        buildSafeAnswerPresentation(
          '- Sam owns pricing approval. [Source 1]\n- The launch is Friday. [Source 2]\n- Alex owns launch approval.',
          citations,
        ).answer,
      ).toBe('- Sam owns pricing approval.\n- The launch is Friday.');
    });

    it('separates supported prose claims into readable chat paragraphs', () => {
      const citations = [
        {
          claim: 'Sam owns pricing approval.',
          meeting_id: 'm1',
          meeting_title: 'Pricing review',
          evidence_span: 'Sam owns pricing approval.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
        {
          claim: 'The launch is Friday.',
          meeting_id: 'm2',
          meeting_title: 'Launch review',
          evidence_span: 'The launch is Friday.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      expect(
        buildSafeAnswerPresentation(
          'Sam owns pricing approval. [Source 1] The launch is Friday. [Source 2] Unsupported filler.',
          citations,
        ).answer,
      ).toBe('Sam owns pricing approval.\n\nThe launch is Friday.');
    });

    it('returns no evidence when every generated claim is unsupported', () => {
      const result = buildSafeAnswerPresentation(
        'Alex owns pricing approval. [Source 1]',
        [
          {
            claim: 'Alex owns pricing approval.',
            meeting_id: 'm1',
            meeting_title: 'Pricing review',
            evidence_span: 'Sam owns pricing approval.',
            evidence_valid: false,
            trust_status: 'needs_review',
          },
        ],
      );

      expect(result.outcome).toBe('no_evidence');
      expect(result.answer).not.toContain('Alex');
      expect(result.citations).toEqual([]);
      expect(result.trustStatus).toBeUndefined();
    });
  });
});
