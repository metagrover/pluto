import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '../../electron/db';
import {
  auditAnswerGrounding,
  auditCitations,
  buildCitationChain,
  buildSafeAnswerPresentation,
  buildSynthesizedAnswerPresentation,
  claimIsSupportedByEvidence,
  createSynthesizedAnswerStream,
  createValidatedAnswerStream,
  isNonFactualResponseText,
  pruneOrphanHeadings,
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
    it('preserves local artifact provenance in citations', () => {
      const context = [
        {
          meeting_id: 'artifact-1',
          meeting_title: 'Launch reference',
          source_type: 'artifact',
          source_id: 'artifact-1',
          evidence_kind: 'artifact',
          evidence_text: 'The Juniper launch uses a canary rollout.',
          source_revision: 'revision-1',
          trust_status: 'grounded',
          mid: null,
        },
      ] as RetrievalResult[];

      const citations = buildCitationChain(
        'Juniper uses a canary rollout. [Source 1]',
        context,
      );

      expect(citations[0]).toMatchObject({
        meeting_id: 'artifact-1',
        meeting_title: 'Launch reference',
        source_type: 'artifact',
        source_id: 'artifact-1',
        evidence_kind: 'artifact',
        source_revision: 'revision-1',
      });
    });

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

    it('recovers a missing inline reference only when retrieved evidence strongly supports the claim', () => {
      const context = [
        {
          meeting_id: 'm1',
          meeting_title: 'Client lending review',
          evidence_text:
            'Jordan said clients are concerned about structuring lending without advisor help.',
          mid: null,
        },
      ] as RetrievalResult[];

      const recovered = auditCitations(
        buildCitationChain(
          'Jordan said clients are concerned about structuring lending without advisor help.',
          context,
        ),
        context,
      );
      const unsupported = buildCitationChain(
        'Jordan approved an automated lending launch.',
        context,
      );

      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({
        meeting_id: 'm1',
        evidence_valid: true,
      });
      expect(unsupported).toEqual([]);
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

    it('validates direct address only against a confirmed self name in the cited passage', () => {
      const selfSource = [
        {
          meeting_id: 'self-meeting',
          meeting_title: 'Workspace review',
          evidence_text:
            'Punit Grover asked whether the kitchen table could be used.',
          mid: null,
        },
      ] as RetrievalResult[];
      const answer =
        'You asked whether the kitchen table could be used. [Source 1]';
      const grounded = createValidatedAnswerStream(
        selfSource,
        () => undefined,
        'grounded',
        undefined,
        'Punit Grover',
      ).finalize(answer);
      expect(grounded.outcome).toBe('answered');
      expect(grounded.answer).toBe(
        'You asked whether the kitchen table could be used.',
      );
      expect(grounded.citations[0].evidence_valid).toBe(true);

      const unconfirmed = createValidatedAnswerStream(
        selfSource,
        () => undefined,
      ).finalize(answer);
      expect(unconfirmed.outcome).toBe('no_evidence');
    });

    it('does not attribute another person’s action to the confirmed self', () => {
      const source = [
        {
          meeting_id: 'mixed-meeting',
          meeting_title: 'Workspace review',
          evidence_text:
            'Punit Grover attended the review. Sam asked whether the kitchen table could be used.',
          mid: null,
        },
      ] as RetrievalResult[];
      const result = createValidatedAnswerStream(
        source,
        () => undefined,
        'grounded',
        undefined,
        'Punit Grover',
      ).finalize(
        'You asked whether the kitchen table could be used. [Source 1]',
      );
      expect(result.outcome).toBe('no_evidence');
    });

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
      const validated = vi.fn();
      const stream = createValidatedAnswerStream(
        sources,
        (delta) => deltas.push(delta),
        'grounded',
        validated,
      );

      stream.push('Sam owns launch signoff. ');
      expect(deltas).toEqual([]);
      expect(validated).not.toHaveBeenCalled();
      stream.push('[Source 1]');

      const presentation = stream.finalize(
        'Sam owns launch signoff. [Source 1]',
      );
      expect(deltas.join('')).toBe('Sam owns launch signoff.');
      expect(presentation.answer).toBe(deltas.join(''));
      expect(presentation.outcome).toBe('answered');
      expect(validated).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: 'Sam owns launch signoff.',
          citations: [expect.objectContaining({ meeting_id: 'm1' })],
        }),
      );
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

    it('preserves draft structure while removing an unsupported factual paragraph', () => {
      const draft = [
        'Subject: Launch plan follow-up',
        'Hi Jordan,',
        'The launch is Friday. [Source 1]',
        'The budget was approved. [Source 1]',
        'Could you send the final checklist?',
        'Best,',
      ].join('\n\n');
      const stream = createValidatedAnswerStream(
        sources,
        () => undefined,
        'draft',
      );

      const presentation = stream.finalize(draft);

      expect(presentation).toMatchObject({
        outcome: 'partial',
        unsupportedClaimCount: 1,
      });
      expect(presentation.answer).toContain('Subject: Launch plan follow-up');
      expect(presentation.answer).toContain('Hi Jordan,');
      expect(presentation.answer).toContain('The launch is Friday.');
      expect(presentation.answer).toContain(
        'Could you send the final checklist?',
      );
      expect(presentation.answer).toContain('Best,');
      expect(presentation.answer).not.toContain('budget was approved');
    });

    it('keeps explicitly labeled analytical guidance separate from grounded observations', () => {
      const stream = createValidatedAnswerStream(
        sources,
        () => undefined,
        'analysis',
      );

      const presentation = stream.finalize(
        'Sam owns launch signoff. [Source 1]\n\nSuggestion: Reserve time to confirm the final handoff.',
      );

      expect(presentation).toMatchObject({
        outcome: 'answered',
        unsupportedClaimCount: 0,
      });
      expect(presentation.answer).toContain(
        'Suggestion: Reserve time to confirm the final handoff.',
      );
    });
  });

  describe('createSynthesizedAnswerStream', () => {
    const sources = [
      {
        meeting_id: 'm1',
        meeting_title: 'Launch review',
        evidence_text: 'Sam owns launch signoff. The launch is Friday.',
        mid: null,
      },
    ] as RetrievalResult[];

    it('streams synthesized prose immediately without waiting for a citation', () => {
      const deltas: string[] = [];
      const stream = createSynthesizedAnswerStream(sources, (delta) =>
        deltas.push(delta),
      );

      stream.push('The launch plan has a clear owner');

      expect(deltas.join('')).toBe('The launch plan has a clear owner');
      expect(stream.streamedAnswer).toBe('The launch plan has a clear owner');
    });

    it('keeps the full answer while stripping source markers for display', () => {
      const deltas: string[] = [];
      const stream = createSynthesizedAnswerStream(sources, (delta) =>
        deltas.push(delta),
      );
      const answer =
        'The work is moving toward launch even though this wording is a synthesis. [Source 1]';

      for (const chunk of [
        'The work is moving toward launch ',
        'even though this wording is a synthesis. ',
        '[Sour',
        'ce 1]',
      ]) {
        stream.push(chunk);
      }
      const presentation = stream.finalize(answer);

      expect(deltas.join('')).toBe(
        'The work is moving toward launch even though this wording is a synthesis.',
      );
      expect(presentation).toMatchObject({
        answer:
          'The work is moving toward launch even though this wording is a synthesis.',
        outcome: 'answered',
        unsupportedClaimCount: 0,
      });
      expect(presentation.citations).toHaveLength(1);
    });

    it('does not prune healthy synthesized prose for weak lexical overlap', () => {
      const presentation = buildSynthesizedAnswerPresentation(
        'The project is approaching its release phase. [Source 1]',
        sources,
      );

      expect(presentation.answer).toBe(
        'The project is approaching its release phase.',
      );
      expect(presentation.outcome).toBe('answered');
      expect(presentation.unsupportedClaimCount).toBe(0);
    });

    it('attaches response-level provenance without requiring inline markers', () => {
      const presentation = buildSynthesizedAnswerPresentation(
        'The release plan has a clear owner and a Friday target.',
        [
          {
            ...sources[0],
            retrieved_sections: [
              {
                section_id: 'section-1',
                heading: 'Launch plan',
                kind: 'overview',
                summary: 'Sam owns launch signoff. The launch is Friday.',
                trust_status: 'grounded',
                source_revision: 'revision-1',
              },
            ],
          },
          { ...sources[0] },
        ],
      );

      expect(presentation.citations).toEqual([
        expect.objectContaining({
          claim: 'Launch review',
          meeting_id: 'm1',
          evidence_span: 'Sam owns launch signoff. The launch is Friday.',
          evidence_valid: true,
          trust_status: 'grounded',
          evidence_kind: 'section',
          section_id: 'section-1',
        }),
      ]);
    });

    it('never attaches raw transcript results as synthesized provenance', () => {
      const presentation = buildSynthesizedAnswerPresentation(
        'The release is Friday.',
        [
          {
            ...sources[0],
            evidence_kind: 'transcript',
            transcript_passages: [
              {
                quote: 'The release is Friday.',
                speaker: 'Sam',
                start_segment_index: 1,
                end_segment_index: 1,
                source_revision: 'revision-1',
                trust_status: 'grounded',
              },
            ],
          },
        ],
      );

      expect(presentation.citations).toEqual([]);
    });

    it('drops only a trailing sentence fragment when local generation stops mid-thought', () => {
      const presentation = buildSynthesizedAnswerPresentation(
        'The first release is ready for an architecture review. AWS certifications are being prioritized as a primary credentialing strategy to',
        sources,
      );

      expect(presentation.answer).toBe(
        'The first release is ready for an architecture review.',
      );
    });

    it('removes grouped and incomplete source markers from synthesized prose', () => {
      expect(
        buildSynthesizedAnswerPresentation(
          'The release is ready. [Source 1, Source 2]',
          sources,
        ).answer,
      ).toBe('The release is ready.');
      expect(
        buildSynthesizedAnswerPresentation(
          'The release is ready. [Sources 1-3]',
          sources,
        ).answer,
      ).toBe('The release is ready.');
      expect(
        buildSynthesizedAnswerPresentation(
          'The release is ready. [Source 4',
          sources,
        ).answer,
      ).toBe('The release is ready.');
    });

    it('drops a trailing partial year without damaging the prior sentence', () => {
      const presentation = buildSynthesizedAnswerPresentation(
        'The migration remains unresolved. The last update was in late August 202',
        sources,
      );

      expect(presentation.answer).toBe('The migration remains unresolved.');
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
      ).toEqual({
        trustStatus: 'inferred',
        unsupportedClaimCount: 0,
        unsupportedClaims: [],
      });
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

    it('does not treat common action verbs, days, or technical acronyms as unsupported named entities', () => {
      expect(
        claimIsSupportedByEvidence(
          'Follow up with Rachel to confirm approach for service notification PR.',
          'Follow up with Rachel on the approach for the service notification PR.',
        ),
      ).toBe(true);
      expect(
        claimIsSupportedByEvidence(
          'Meeting with Rachel scheduled for Monday regarding client data and database optimization.',
          'Sync with Rachel on client data pipeline and database optimization upcoming on Monday.',
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

    it('treats model unavailability as a meeting fact when the passage says it was not available', () => {
      expect(
        claimIsSupportedByEvidence(
          'Punit Grover was unsure why the Parakeet model was unavailable.',
          "Punit Grover: I don't know why the Parakeet model is not available.",
        ),
      ).toBe(true);
      expect(
        claimIsSupportedByEvidence(
          'The Parakeet model was available.',
          'The Parakeet model was not available.',
        ),
      ).toBe(false);
      expect(
        claimIsSupportedByEvidence(
          'The Parakeet model was not available.',
          'There was no Parakeet model available.',
        ),
      ).toBe(true);
      expect(
        claimIsSupportedByEvidence(
          'The Parakeet model was available.',
          'There was no Parakeet model available.',
        ),
      ).toBe(false);
      expect(
        claimIsSupportedByEvidence(
          'The Parakeet model was unavailable.',
          'The Parakeet model was available.',
        ),
      ).toBe(false);
      expect(
        claimIsSupportedByEvidence(
          'Punit Grover knew why the Parakeet model was unavailable.',
          "Punit Grover didn't know why the Parakeet model was not available.",
        ),
      ).toBe(false);

      const context = [
        {
          meeting_id: 'parakeet-meeting',
          meeting_title: 'Parakeet Model Availability Issue',
          evidence_text:
            'Punit Grover said there was no Parakeet model available.',
          mid: null,
        },
      ] as RetrievalResult[];
      const citations = auditCitations(
        buildCitationChain(
          'Punit Grover said the Parakeet model was not available. [Source 1]',
          context,
        ),
        context,
      );
      expect(citations[0].evidence_valid).toBe(true);
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

    it('accepts supported synthesized-note paraphrases but rejects fabricated claims', () => {
      const synthesizedNote =
        'Standup: Rachel will finalize the data pipeline handoff by end of week. ' +
        'Blocker on schema migration resolved. Next step: deploy to staging environment.';
      const context = [
        {
          meeting_id: 'm-synth',
          meeting_title: 'Workspace Intelligence: Working Memory',
          evidence_text: synthesizedNote,
          evidence_kind: 'note' as const,
          mid: {
            evidence_spans: [{ quote: synthesizedNote }],
          },
          score: 0.9,
          score_breakdown: {
            fts_rank: 0.9,
            graph_proximity: 0,
            recency_decay: 0,
            mention_weight: 0,
          },
        },
      ] as RetrievalResult[];

      vi.mocked(dbModule.getMeetingMid).mockReturnValue(
        context[0].mid as ReturnType<typeof dbModule.getMeetingMid>,
      );

      const audited = auditCitations(
        [
          {
            claim:
              'Schema migration issues are resolved; staging deployment is the next priority.',
            meeting_id: 'm-synth',
            meeting_title: 'Workspace Intelligence: Working Memory',
            evidence_span: synthesizedNote,
            evidence_valid: false,
            trust_status: 'needs_review',
          },
        ],
        context,
      );

      expect(audited[0].evidence_valid).toBe(true);

      const fabricated = auditCitations(
        [
          {
            claim: 'Alex approved a $50,000 production budget.',
            meeting_id: 'm-synth',
            meeting_title: 'Workspace Intelligence: Working Memory',
            evidence_span: synthesizedNote,
            evidence_valid: false,
            trust_status: 'needs_review',
          },
        ],
        context,
      );

      expect(fabricated[0].evidence_valid).toBe(false);
    });

    it('validates the deterministic workspace-focus answer against synthesized evidence', () => {
      const context = [
        {
          meeting_id: 'workspace:intelligence',
          meeting_title: 'Workspace Intelligence',
          evidence_text: [
            '[Workspace Current Read]: Platform stabilization is in progress.',
            '[Workspace refreshed]: 2026-09-25T18:00:00Z',
            '[Newer synthesized-note overlay]: 1 meeting notes through 2026-09-26T18:00:00.000Z',
            '[Selection policy]: Older or stale threads are omitted from the main priority list.',
            '[Omitted older or stale count]: 1',
            '[Omitted older or stale work]:',
            '- Stream "Legacy migration" — Historical migration planning (last reinforced 2026-05-01T12:00:00.000Z)',
            '[Your Commitments & Action Items]:',
            '- Finalize API token rotation (Due: Sep 30)',
            '[Active Projects & Focus]:',
            '- Project "API Gateway v2" [active]',
            '  * Current Focus: Zero-trust migration',
          ].join('\n'),
          evidence_kind: 'overview' as const,
          mid: null,
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 1,
            recency_decay: 1,
            mention_weight: 1,
          },
        },
        {
          meeting_id: 'release-review',
          meeting_title: 'Release review',
          evidence_text:
            '[Recent meeting context]: Release review\n[Occurred]: 2026-09-26T18:00:00Z\n[Analysis]: The final launch blocker is the signing check.',
          evidence_kind: 'note' as const,
          mid: null,
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ] as RetrievalResult[];
      const answer = [
        'Here’s my read: **Platform stabilization is in progress.** [Source 1]',
        '',
        '**Focus now**',
        '- Finalize API token rotation (due Sep 30) [Source 1]',
        '- API Gateway v2 — Zero-trust migration [Source 1]',
        '',
        'I left older or stale threads out of the main list. The workspace synthesis was refreshed Sep 25. [Source 1]',
      ].join('\n');

      const presentation = createValidatedAnswerStream(
        context,
        () => undefined,
      ).finalize(answer);

      expect(presentation.answer).toContain('Platform stabilization');
      expect(presentation.answer).toContain('Finalize API token rotation');
      expect(presentation.answer).toContain('API Gateway v2');
      expect(presentation.outcome).toBe('answered');
      expect(presentation.unsupportedClaimCount).toBe(0);

      const expanded = createValidatedAnswerStream(
        context,
        () => undefined,
      ).finalize(
        [
          'Here’s my read: **Platform stabilization is in progress.** [Source 1]',
          '',
          '**New since the workspace snapshot**',
          '- Release review — The final launch blocker is the signing check. [Source 2]',
          '',
          'The base workspace synthesis was refreshed Sep 25. [Source 1]',
          'Newer synthesized meeting notes are included through Sep 26. [Source 1]',
        ].join('\n'),
      );
      expect(expanded.answer).toContain('Release review');
      expect(expanded.answer).toContain(
        'The base workspace synthesis was refreshed Sep 25.',
      );
      expect(expanded.answer).toContain(
        'Newer synthesized meeting notes are included through Sep 26.',
      );
      expect(expanded.unsupportedClaimCount).toBe(0);

      const omitted = createValidatedAnswerStream(
        context,
        () => undefined,
      ).finalize(
        [
          'I left these older or stale signals out of the main priority list. [Source 1]',
          '',
          '**Left out as older or stale**',
          '- Legacy migration — Historical migration planning (last reinforced May 1) [Source 1]',
        ].join('\n'),
      );
      expect(omitted.answer).toContain('Legacy migration');
      expect(omitted.unsupportedClaimCount).toBe(0);
    });

    it('still applies token-overlap check for raw transcript sources', () => {
      // Raw transcripts are NOT pre-grounded; the overlap check must still apply.
      const transcriptPassage = 'Sam will prepare the launch checklist.';
      const context = [
        {
          meeting_id: 'm-raw',
          meeting_title: 'Launch review',
          evidence_text: transcriptPassage,
          evidence_kind: 'transcript' as const,
          mid: {
            evidence_spans: [{ quote: transcriptPassage }],
          },
          score: 0.8,
          score_breakdown: {
            fts_rank: 0.8,
            graph_proximity: 0,
            recency_decay: 0,
            mention_weight: 0,
          },
        },
      ] as RetrievalResult[];

      vi.mocked(dbModule.getMeetingMid).mockReturnValue(
        context[0].mid as ReturnType<typeof dbModule.getMeetingMid>,
      );

      // This claim has no token overlap with the transcript passage
      const audited = auditCitations(
        [
          {
            claim: 'Alex owns pricing approval.',
            meeting_id: 'm-raw',
            meeting_title: 'Launch review',
            evidence_span: transcriptPassage,
            evidence_valid: false,
            trust_status: 'needs_review',
          },
        ],
        context,
      );

      // Should fail: raw transcript → token-overlap still required
      expect(audited[0].evidence_valid).toBe(false);
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
        unsupportedClaims: ['Alex owns pricing approval.'],
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
        unsupportedClaims: [
          'The launch moved later compared with the prior plan.',
        ],
      });
    });

    it('requires a primary concern synthesis to cite at least two meetings', () => {
      const answer = "Jordan's primary concern is lending accuracy. [Source 1]";
      const citations = [
        {
          claim: "Jordan's primary concern is lending accuracy.",
          meeting_id: 'm1',
          meeting_title: 'Lending review',
          evidence_span: 'Jordan raised a concern about lending accuracy.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      expect(auditAnswerGrounding(answer, citations)).toEqual({
        trustStatus: 'needs_review',
        unsupportedClaimCount: 1,
        unsupportedClaims: ["Jordan's primary concern is lending accuracy."],
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
        unsupportedClaims: [],
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
        unsupportedClaims: [],
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
        unsupportedClaims: ['The launch moved to Friday.'],
      });
    });

    it('keeps supported prose together when an unsupported detail is removed', () => {
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
          claim: 'The review is due Friday.',
          meeting_id: 'm1',
          meeting_title: 'Pricing review',
          evidence_span: 'The review is due Friday.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      expect(
        buildSafeAnswerPresentation(
          'Sam owns pricing approval. [Source 1] The review is due Friday. [Source 1] The launch moved to Monday.',
          citations,
        ),
      ).toMatchObject({
        answer: 'Sam owns pricing approval. The review is due Friday.',
        outcome: 'partial',
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

    it('keeps supported prose claims in a connected response', () => {
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
      ).toBe('Sam owns pricing approval. The launch is Friday.');
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

    it('deduplicates nearly-identical supported claims with trailing punctuation differences', () => {
      const citations = [
        {
          claim:
            '• Ayush worked on a pipeline to generate and review client emails.',
          meeting_id: 'm1',
          meeting_title: 'Email review',
          evidence_span:
            'Ayush worked on a pipeline to generate and review client emails.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
        {
          claim:
            '• Ayush worked on a pipeline to generate and review client emails .',
          meeting_id: 'm1',
          meeting_title: 'Email review',
          evidence_span:
            'Ayush worked on a pipeline to generate and review client emails.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      const result = buildSafeAnswerPresentation(
        '• Ayush worked on a pipeline to generate and review client emails. [Source 1]\n• Ayush worked on a pipeline to generate and review client emails . [Source 1]\nUnsupported claim.',
        citations,
      );

      expect(result.outcome).toBe('partial');
      expect(result.answer).toBe(
        '• Ayush worked on a pipeline to generate and review client emails.',
      );
    });

    it('prunes orphan headings when body sentences are missing or stripped', () => {
      const inputWithOrphans = [
        'Email and Pipeline Development',
        '',
        'Product Strategy and UI',
        '',
        'Suggestion: Prioritize the "hardened" pipeline and the cloud deployment for Mary as these involve direct dependencies on your output for others.',
      ].join('\n');

      const pruned = pruneOrphanHeadings(inputWithOrphans);
      expect(pruned).toBe(
        'Suggestion: Prioritize the "hardened" pipeline and the cloud deployment for Mary as these involve direct dependencies on your output for others.',
      );
    });

    it('retains headings when followed by valid body content', () => {
      const input = [
        'Email and Pipeline Development',
        '',
        '- Built the SMTP gateway [Source 1]',
        '',
        'Product Strategy and UI',
        '',
        '- Redesigned the navigation bar [Source 2]',
      ].join('\n');

      const pruned = pruneOrphanHeadings(input);
      expect(pruned).toContain('Email and Pipeline Development');
      expect(pruned).toContain('Product Strategy and UI');
      expect(pruned).toContain('Built the SMTP gateway');
      expect(pruned).toContain('Redesigned the navigation bar');
    });

    it('treats analysis recommendations and connective rationale as non-factual response text', () => {
      expect(
        isNonFactualResponseText('Email and Pipeline Development', 'analysis'),
      ).toBe(true);
      expect(
        isNonFactualResponseText(
          'Suggestion: Prioritize the "hardened" pipeline and the cloud deployment for Mary as these involve direct dependencies on your output for others.',
          'analysis',
        ),
      ).toBe(true);
      expect(
        isNonFactualResponseText(
          'Recommendation: Focus on the immediate deliverables first.',
          'analysis',
        ),
      ).toBe(true);
      expect(
        isNonFactualResponseText(
          'You should prioritize these items as they represent blocking dependencies for the team.',
          'analysis',
        ),
      ).toBe(true);
      expect(
        isNonFactualResponseText(
          'Here is what is currently on your plate, based on your open commitments:',
          'analysis',
        ),
      ).toBe(true);
    });

    it('prunes orphan headings in buildSafeAnswerPresentation for analysis mode', () => {
      const citations = [
        {
          claim: 'Finish the hardened pipeline for Mary.',
          meeting_id: 'm1',
          meeting_title: 'Pipeline Sync',
          evidence_span: 'Finish the hardened pipeline for Mary.',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      const rawAnswer = [
        'Email and Pipeline Development',
        '',
        'Finish the hardened pipeline for Mary. [Source 1]',
        '',
        'Product Strategy and UI',
        '',
        'Some unverified claim about product redesign that was not discussed.',
        '',
        'Suggestion: Prioritize the "hardened" pipeline as it unblocks others.',
      ].join('\n');

      const presentation = buildSafeAnswerPresentation(
        rawAnswer,
        citations,
        'analysis',
      );

      expect(presentation.outcome).toBe('partial');
      expect(presentation.answer).toContain('Email and Pipeline Development');
      expect(presentation.answer).toContain(
        'Finish the hardened pipeline for Mary.',
      );
      // The second heading whose body was completely unsupported should be pruned!
      expect(presentation.answer).not.toContain('Product Strategy and UI');
      expect(presentation.answer).toContain(
        'Suggestion: Prioritize the "hardened" pipeline as it unblocks others.',
      );
    });

    it('preserves executive planning and priority synthesis without dropping paragraphs in analysis mode', () => {
      const citations = [
        {
          claim: 'Finish the hardened pipeline deployment for Mary.',
          meeting_id: 'workspace:intelligence',
          meeting_title:
            'Workspace Intelligence: Working Memory, Streams & Priorities',
          evidence_span:
            'Stream "pipeline": Finish the hardened pipeline deployment for Mary',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
        {
          claim: 'Project "Pluto": Next milestone is v1.0 release.',
          meeting_id: 'workspace:intelligence',
          meeting_title:
            'Workspace Intelligence: Working Memory, Streams & Priorities',
          evidence_span:
            'Project "Pluto" [active]\n  * Next Milestone: v1.0 release',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
        {
          claim: 'Resolve email look and feel errors before client rollout.',
          meeting_id: 'workspace:intelligence',
          meeting_title:
            'Workspace Intelligence: Working Memory, Streams & Priorities',
          evidence_span:
            'Open Loops & Blockers:\n- Resolve email look and feel errors before client rollout',
          evidence_valid: true,
          trust_status: 'grounded' as const,
        },
      ];

      const rawAnswer = [
        '**Immediate Priorities & Commitments:**',
        '',
        '- Finish the hardened pipeline deployment for Mary. [Source 1]',
        '',
        '**Active Work Streams & Projects:**',
        '',
        '- Project "Pluto": Next milestone is v1.0 release. [Source 1]',
        '',
        '**Open Loops & Attention Items:**',
        '',
        '- Resolve email look and feel errors before client rollout. [Source 1]',
        '',
        'Suggestion: Prioritize unblocking Mary on the pipeline deployment as it represents the highest leverage immediate task.',
      ].join('\n');

      const presentation = buildSafeAnswerPresentation(
        rawAnswer,
        citations,
        'analysis',
      );

      expect(presentation.answer).toContain(
        '**Immediate Priorities & Commitments:**',
      );
      expect(presentation.answer).toContain(
        'Finish the hardened pipeline deployment for Mary.',
      );
      expect(presentation.answer).toContain(
        'Suggestion: Prioritize unblocking Mary',
      );
      expect(presentation.outcome).toBe('answered');
      expect(presentation.unsupportedClaimCount).toBe(0);
    });
  });
});
