import { describe, expect, it } from 'vitest';

import {
  localIntelligenceEvaluationCases,
  scoreGoldOutput,
  sourceTextForCase,
} from '../manual/fixtures/localIntelligenceEvaluationCases';

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
