import { describe, expect, it } from 'vitest';

import {
  aggregateTerminologyCandidates,
  buildTerminologyContextBlock,
  createTerminologyArtifact,
  discoverRepeatedTerminologyCandidates,
  parseTerminologyCandidates,
} from '../../electron/llm/terminologyReconciliation';

describe('terminology candidate parsing', () => {
  it('keeps only bounded candidates found in their referenced transcript lines', () => {
    const lines = [
      'Ayush: We should ask the Ovaltree team about the contract.',
      'Deepak: Ogletree can review it next week.',
    ];

    const candidates = parseTerminologyCandidates(
      [
        {
          raw_text: 'Ovaltree',
          segment_indexes: [0],
          kind: 'organization',
          reason: 'variant',
        },
        {
          raw_text: 'invented term',
          segment_indexes: [1],
          kind: 'product',
          reason: 'ambiguous',
        },
        {
          raw_text: 'next week',
          segment_indexes: [1],
          kind: 'domain_term',
          reason: 'ambiguous',
        },
      ],
      lines,
      10,
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        rawText: 'Ovaltree',
        segmentIndexes: [10],
        context: [lines[0]],
      }),
    ]);
  });

  it('discovers repeated proper-looking terms missed by model segmentation', () => {
    const lines = [
      'Ayush: We should ask Ovaltree about the certification.',
      'Deepak: The Ovaltree team can clarify it.',
      'Ayush: Monday is only a tentative target.',
    ];

    expect(discoverRepeatedTerminologyCandidates(lines, 20)).toEqual([
      expect.objectContaining({
        rawText: 'Ovaltree',
        segmentIndexes: [20, 21],
        context: [lines[0], lines[1]],
      }),
    ]);
  });

  it('groups duplicate candidates and caps contexts and candidate count', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      rawText: `Term ${index}`,
      segmentIndexes: [index],
      context: [`Speaker: Term ${index}`],
      kind: 'domain_term' as const,
      reason: 'ambiguous' as const,
    }));
    candidates.push({
      rawText: 'term 0',
      segmentIndexes: [99],
      context: ['Speaker: term 0 again'],
      kind: 'domain_term',
      reason: 'variant',
    });

    const aggregated = aggregateTerminologyCandidates(candidates);

    expect(aggregated).toHaveLength(24);
    expect(aggregated[0]).toMatchObject({
      rawForms: ['Term 0', 'term 0'],
      segmentIndexes: [0, 99],
    });
  });
});

describe('terminology application gate', () => {
  const candidate = {
    rawForms: ['Ovaltree'],
    segmentIndexes: [4, 9],
    contexts: [
      'Ayush: Ask the Ovaltree team.',
      'Deepak: The Ovaltree contract is ready.',
    ],
    kind: 'organization' as const,
    reasons: ['variant' as const],
  };

  it('does not apply a correction based on model confidence alone', () => {
    const artifact = createTerminologyArtifact({
      candidates: [candidate],
      proposals: [
        {
          raw_forms: ['Ovaltree'],
          preferred_term: 'Ogletree',
          confidence: 'high',
          signals: [],
        },
      ],
      knownTerms: [],
      provider: 'ollama',
      model: 'test-model',
      generatedAt: '2026-08-26T00:00:00.000Z',
    });

    expect(artifact.proposals[0].status).toBe('proposed');
    expect(buildTerminologyContextBlock(artifact)).toBe('');
  });

  it('applies a high-confidence correction independently supported by a known term', () => {
    const artifact = createTerminologyArtifact({
      candidates: [candidate],
      proposals: [
        {
          raw_forms: ['Ovaltree'],
          preferred_term: 'Ogletree',
          confidence: 'high',
          signals: ['known_entity'],
        },
      ],
      knownTerms: ['Ogletree'],
      provider: 'ollama',
      model: 'test-model',
      generatedAt: '2026-08-26T00:00:00.000Z',
    });

    expect(artifact.proposals[0].status).toBe('applied');
    expect(buildTerminologyContextBlock(artifact)).toContain(
      'Raw forms: "Ovaltree". Preferred term: "Ogletree".',
    );
  });

  it('does not override an explicit model preserve disposition', () => {
    const artifact = createTerminologyArtifact({
      candidates: [candidate],
      proposals: [
        {
          raw_forms: ['Ovaltree'],
          preferred_term: 'Ogletree',
          confidence: 'high',
          signals: ['known_entity'],
          disposition: 'preserve_raw',
        },
      ],
      knownTerms: ['Ogletree'],
      provider: 'ollama',
      model: 'test-model',
      generatedAt: '2026-08-26T00:00:00.000Z',
    });

    expect(artifact.proposals[0].status).toBe('preserved');
  });

  it('applies a high-confidence correction supported across repeated contexts', () => {
    const artifact = createTerminologyArtifact({
      candidates: [candidate],
      proposals: [
        {
          raw_forms: ['Ovaltree'],
          preferred_term: 'Ogletree',
          confidence: 'high',
          signals: ['repeated_context'],
          disposition: 'apply',
        },
      ],
      knownTerms: [],
      provider: 'ollama',
      model: 'test-model',
      generatedAt: '2026-08-26T00:00:00.000Z',
    });

    expect(artifact.proposals[0].status).toBe('applied');
  });

  it('preserves protected numeric, date, negation, and speaker content', () => {
    const protectedCandidates = ['42', 'August 26', 'not', 'Ayush'].map(
      (rawText, index) => ({
        rawForms: [rawText],
        segmentIndexes: [index],
        contexts: [`Ayush: ${rawText}`],
        kind: 'domain_term' as const,
        reasons: ['ambiguous' as const],
      }),
    );

    const artifact = createTerminologyArtifact({
      candidates: protectedCandidates,
      proposals: protectedCandidates.map((candidate) => ({
        raw_forms: candidate.rawForms,
        preferred_term: 'Replacement',
        confidence: 'high' as const,
        signals: ['known_entity' as const],
      })),
      knownTerms: ['Replacement'],
      provider: 'ollama',
      model: 'test-model',
      generatedAt: '2026-08-26T00:00:00.000Z',
    });

    expect(artifact.proposals.map((proposal) => proposal.status)).toEqual([
      'preserved',
      'preserved',
      'preserved',
      'preserved',
    ]);
  });
});
