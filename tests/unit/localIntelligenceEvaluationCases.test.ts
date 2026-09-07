import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import {
  localIntelligenceEvaluationCases,
  scoreGoldOutput,
  sourceTextForCase,
} from '../manual/fixtures/localIntelligenceEvaluationCases';
import {
  PHI_NOTES_CORPUS_SHA256,
  PHI_NOTES_RUBRIC_SHA256,
  phiNotesBoundaryFixtures,
  phiNotesCorpusPayload,
  phiNotesExpectedRejectionCases,
  phiNotesHeldOutCases,
  phiNotesOrdinaryCapacityCases,
  phiNotesRubricPayload,
} from '../manual/fixtures/localIntelligencePhiNotesHeldOut';

const requiredFailureIds = [
  'F01',
  'F02',
  'F03',
  'F04',
  'F05',
  'F06',
  'F13',
  'F14',
  'F18',
  'F19',
  'F21',
];

describe('local intelligence evaluation corpus', () => {
  it('preserves the twelve inspected September 7 notes cases as development evidence', () => {
    const inspectedIds = [
      'notes-middle-withdrawal',
      'notes-conditional-ownership',
      'notes-short-opening-decision',
      'notes-short-date-correction',
      'notes-short-owner-handoff',
      'notes-ordinary-no-decision-no-action',
      'notes-ordinary-end-commitment',
      'notes-long-dense-three-position-evidence',
      'notes-long-dense-owner-date-revision',
      'notes-long-dense-decisions-and-boundaries',
      'notes-adversarial-sparse-unrelated-beacons',
      'notes-adversarial-sparse-unmet-condition',
    ];
    const inspected = localIntelligenceEvaluationCases.filter((candidate) =>
      inspectedIds.includes(candidate.id),
    );
    expect(inspected.map((candidate) => candidate.id)).toEqual(inspectedIds);
    expect(
      inspected.every((candidate) => candidate.partition === 'development'),
    ).toBe(true);
  });

  it('freezes twelve fresh held-out semantic cases across the target profiles', () => {
    const heldOutNotes = phiNotesHeldOutCases;

    expect(heldOutNotes).toHaveLength(12);
    expect(
      heldOutNotes.reduce<Record<string, number>>((counts, candidate) => {
        counts[candidate.syntheticProfile] =
          (counts[candidate.syntheticProfile] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({
      short: 3,
      ordinary: 4,
      long_dense: 3,
      adversarial_sparse: 2,
    });
  });

  it('covers every frozen notes evidence challenge explicitly', () => {
    const heldOutNotes = phiNotesHeldOutCases;
    const covered = new Set(
      heldOutNotes.flatMap((candidate) => candidate.coverageTags),
    );

    expect(
      [
        'beginning_evidence',
        'middle_evidence',
        'end_evidence',
        'owner_handoff',
        'date_correction',
        'conditionality',
        'withdrawal',
        'explicit_no_decision',
        'explicit_no_action',
        'unrelated_topic_negative',
        'dense_multi_claim',
      ].filter((tag) => !covered.has(tag)),
    ).toEqual([]);
  });

  it('freezes eight ordinary-capacity cases in the declared source bands', () => {
    expect(phiNotesOrdinaryCapacityCases).toHaveLength(8);
    const sourceSizes = phiNotesOrdinaryCapacityCases.map((candidate) => {
      const actual = candidate.segments.reduce(
        (total, segment) => total + segment.text.length,
        0,
      );
      expect(actual, candidate.id).toBe(candidate.capacity.sourceCharacters);
      expect(candidate.segments, candidate.id).toHaveLength(
        candidate.capacity.segmentCount,
      );
      expect(candidate.capacity.editorFit).toBe(
        'pending_development_measurement',
      );
      return actual;
    });
    expect(
      sourceSizes.filter((size) => size >= 8_000 && size <= 16_000),
    ).toHaveLength(4);
    expect(
      sourceSizes.filter((size) => size >= 16_001 && size <= 24_000),
    ).toHaveLength(4);
  });

  it('keeps expected capacity rejection fixtures outside supported completion', () => {
    expect(phiNotesExpectedRejectionCases).toHaveLength(2);
    expect(
      phiNotesExpectedRejectionCases.every(
        (candidate) =>
          candidate.collection === 'expected_rejection' &&
          candidate.expectedPublication === false &&
          candidate.priorNotes.length > 0,
      ),
    ).toBe(true);
    expect(phiNotesBoundaryFixtures.map((fixture) => fixture.id)).toEqual([
      'direct-bounded-transition',
      'maximum-three-leaves',
      'single-repartition',
      'aggregate-inventory-overflow',
      'oversized-individual-segment',
      'explicit-capacity-rejection',
    ]);
  });

  it('seals the fresh corpus and rubric with literal canonical hashes', () => {
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, canonicalize(entry)]),
      );
    };
    const sha = (value: unknown) =>
      createHash('sha256')
        .update(JSON.stringify(canonicalize(value)))
        .digest('hex');
    expect(sha(phiNotesCorpusPayload)).toBe(PHI_NOTES_CORPUS_SHA256);
    expect(sha(phiNotesRubricPayload)).toBe(PHI_NOTES_RUBRIC_SHA256);
  });

  it('has unique case IDs and disjoint development/held-out membership', () => {
    const ids = localIntelligenceEvaluationCases.map(
      (candidate) => candidate.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    const development = new Set(
      localIntelligenceEvaluationCases
        .filter((candidate) => candidate.partition === 'development')
        .map((candidate) => candidate.id),
    );
    const heldOut = new Set(
      localIntelligenceEvaluationCases
        .filter((candidate) => candidate.partition === 'held_out')
        .map((candidate) => candidate.id),
    );
    expect(development.size).toBeGreaterThan(0);
    expect(heldOut.size).toBeGreaterThan(0);
    expect([...development].filter((id) => heldOut.has(id))).toEqual([]);
  });

  it('resolves every gold evidence excerpt against its declared source', () => {
    for (const candidate of localIntelligenceEvaluationCases) {
      for (const claim of candidate.gold.requiredClaims) {
        expect(
          claim.evidence.length,
          `${candidate.id}/${claim.id}`,
        ).toBeGreaterThan(0);
        for (const evidence of claim.evidence) {
          const source = sourceTextForCase(candidate, evidence.sourceId);
          expect(source, `${candidate.id}/${evidence.sourceId}`).not.toBeNull();
          expect(source?.includes(evidence.excerpt)).toBe(true);
        }
        if (claim.owner) {
          expect(
            claim.requiredTerms.flatMap((term) =>
              term.toLowerCase().split('|'),
            ),
          ).toContain(claim.owner.toLowerCase());
        }
        if (claim.date) {
          expect(
            claim.requiredTerms.flatMap((term) =>
              term.toLowerCase().split('|'),
            ),
          ).toContain(claim.date.toLowerCase());
        }
      }
    }
  });

  it('requires an explicit visible-block projection for every notes claim', () => {
    for (const candidate of localIntelligenceEvaluationCases) {
      if (candidate.lane !== 'meeting_notes') continue;
      for (const claim of candidate.gold.requiredClaims) {
        expect(
          claim.notesProjection,
          `${candidate.id}/${claim.id}`,
        ).toBeDefined();
        expect(
          claim.notesProjection?.requiredTextTerms.length,
          `${candidate.id}/${claim.id}/text`,
        ).toBeGreaterThan(0);
        expect(
          claim.notesProjection?.requiredEvidenceTerms.length,
          `${candidate.id}/${claim.id}/evidence`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('maps every required failure mode to at least one explicit gold case', () => {
    const covered = new Set(
      localIntelligenceEvaluationCases.flatMap(
        (candidate) => candidate.failureIds,
      ),
    );
    expect(requiredFailureIds.filter((id) => !covered.has(id))).toEqual([]);
  });

  it('fails a pleasing head/tail summary that drops the middle commitment', () => {
    const candidate = localIntelligenceEvaluationCases.find(
      (item) => item.id === 'notes-middle-withdrawal',
    );
    expect(candidate?.lane).toBe('meeting_notes');
    if (!candidate) throw new Error('middle fixture missing');
    const headTailOnly =
      'The team reviewed metrics. The proposed Friday launch was withdrawn, and no date is approved.';
    expect(scoreGoldOutput(candidate, headTailOnly)).toMatchObject({
      criticalPassed: false,
      passed: false,
    });
  });

  it('does not let abstention win a positive evidence case', () => {
    const candidate = localIntelligenceEvaluationCases.find(
      (item) => item.id === 'cross-meeting-ownership-transfer',
    );
    if (!candidate) throw new Error('ownership fixture missing');
    expect(
      scoreGoldOutput(candidate, 'There is not enough information.'),
    ).toMatchObject({
      passedRequiredCount: 0,
      criticalPassed: false,
      passed: false,
    });
  });

  it('accepts truthful negated notes claims while rejecting affirmative forbidden claims', () => {
    const examples = [
      {
        id: 'notes-ordinary-no-decision-no-action',
        truthful: 'No pricing decision and no follow-up assigned.',
        affirmative:
          'No pricing decision was made, but a follow-up was assigned.',
        forbidden: 'follow-up was assigned',
      },
      {
        id: 'notes-long-dense-three-position-evidence',
        truthful:
          'The EU data-residency pilot was approved. Nia owns the access audit due December 4. Luis owns the sandbox integration only if the vendor passes security review. No pricing was approved.',
        affirmative:
          'The EU data-residency pilot was approved. Nia owns the access audit due December 4. Luis owns the sandbox integration only if the vendor passes security review. Pricing was approved.',
        forbidden: 'pricing was approved',
      },
      {
        id: 'notes-long-dense-decisions-and-boundaries',
        truthful:
          'Retain seven days of pilot telemetry. Ravi owns the deletion test results due January 9. Pilot access remains limited to the research team. No public dashboard approved and no action assigned.',
        affirmative:
          'Retain seven days of pilot telemetry. Ravi owns the deletion test results due January 9. Pilot access remains limited to the research team. The public dashboard was approved, though no action was assigned.',
        forbidden: 'public dashboard was approved',
      },
    ];

    for (const example of examples) {
      const candidate = localIntelligenceEvaluationCases.find(
        (item) => item.id === example.id,
      );
      if (!candidate) throw new Error(`${example.id} fixture missing`);

      expect(
        scoreGoldOutput(candidate, example.truthful),
        `${example.id} truthful output`,
      ).toMatchObject({ passed: true, forbiddenMatches: [] });
      expect(
        scoreGoldOutput(candidate, example.affirmative).forbiddenMatches,
        `${example.id} affirmative output`,
      ).toContain(example.forbidden);
    }
  });

  it('distinguishes evidence negation from a post-claim exception', () => {
    const candidate = localIntelligenceEvaluationCases.find(
      (item) => item.id === 'notes-long-dense-three-position-evidence',
    );
    if (!candidate) throw new Error('dense pricing fixture missing');
    const supportedContext =
      'The EU data-residency pilot was approved. Nia owns the access audit due December 4. Luis owns the sandbox integration only if the vendor passes security review.';

    expect(
      scoreGoldOutput(
        candidate,
        `${supportedContext} No pricing was approved except enterprise pricing.`,
      ).forbiddenMatches,
    ).toContain('pricing was approved');
    expect(
      scoreGoldOutput(
        candidate,
        `${supportedContext} No pricing decision was made; there is no evidence that pricing was approved.`,
      ),
    ).toMatchObject({ passed: true, forbiddenMatches: [] });
    expect(
      scoreGoldOutput(
        candidate,
        'Nia owns the access audit due December 4. Luis owns the sandbox integration only if the vendor passes security review. No pricing was approved, but the EU data-residency pilot was approved.',
      ),
    ).toMatchObject({ passed: true, forbiddenMatches: [] });
    expect(
      scoreGoldOutput(
        candidate,
        `${supportedContext} No pricing was approved initially, but it was approved later.`,
      ).forbiddenMatches,
    ).toContain('pricing was approved');
    expect(
      scoreGoldOutput(
        candidate,
        `${supportedContext} No pricing was approved, but it was noted that the Android expansion was not approved.`,
      ),
    ).toMatchObject({ passed: true, forbiddenMatches: [] });
    expect(
      scoreGoldOutput(
        candidate,
        `${supportedContext} No pricing was approved, but enterprise pricing was.`,
      ).forbiddenMatches,
    ).toContain('pricing was approved');
  });

  it('rejects invented causation and accepts explicit no-change output', () => {
    const association = localIntelligenceEvaluationCases.find(
      (item) => item.id === 'cross-meeting-association-no-causation',
    );
    const noChange = localIntelligenceEvaluationCases.find(
      (item) => item.id === 'dreaming-rejected-correction',
    );
    if (!association || !noChange)
      throw new Error('cross-meeting fixtures missing');
    expect(
      scoreGoldOutput(
        association,
        'Aurora usability testing caused the pricing review.',
      ),
    ).toMatchObject({ passed: false });
    expect(
      scoreGoldOutput(noChange, '{"status":"no_change","proposals":[]}'),
    ).toMatchObject({ passed: true });
  });
});
