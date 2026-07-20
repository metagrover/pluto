import {
  type AlignedEnergyWindow,
  type DiarizationTurn,
  deriveAttributionEvidence,
  injectLocalEvidenceWindows,
  mapDiarizationFromAcousticEvidence,
} from '../utils/acousticSpeakerAttribution.ts';
import {
  applyDiarizationRefinement,
  splitSegmentsAtDiarizationBoundaries,
} from '../utils/speakerAttribution.ts';

interface AcceptanceSegment {
  startTime: number;
  endTime: number;
  speaker: 'Me' | 'Them';
  text: string;
}

export interface ProductionAttributionAcceptanceCase {
  id: string;
  turns: DiarizationTurn[];
  energy: AlignedEnergyWindow[];
  segments?: AcceptanceSegment[];
  referenceTurns?: Array<
    Pick<AcceptanceSegment, 'startTime' | 'endTime' | 'speaker'>
  >;
  expected: {
    falseMeSeconds: number;
    missedMeSeconds?: number;
    injectedLocalWindows: number;
  };
}

export interface ProductionAttributionAcceptanceManifest {
  schemaVersion: 1;
  cases: ProductionAttributionAcceptanceCase[];
}

const matchesSeconds = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 0.001;

const measureAgainstReference = (
  segments: AcceptanceSegment[],
  referenceTurns: NonNullable<
    ProductionAttributionAcceptanceCase['referenceTurns']
  >,
) => {
  const predictedMe = segments.filter((segment) => segment.speaker === 'Me');
  const boundaries = [
    ...new Set(
      [...predictedMe, ...referenceTurns].flatMap((turn) => [
        turn.startTime,
        turn.endTime,
      ]),
    ),
  ].sort((left, right) => left - right);
  let falseMeSeconds = 0;
  let missedMeSeconds = 0;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const midpoint = (start + end) / 2;
    const predicted = predictedMe.some(
      (turn) => turn.startTime <= midpoint && turn.endTime >= midpoint,
    );
    const referenceMe = referenceTurns.some(
      (turn) =>
        turn.speaker === 'Me' &&
        turn.startTime <= midpoint &&
        turn.endTime >= midpoint,
    );
    const referenceThem = referenceTurns.some(
      (turn) =>
        turn.speaker === 'Them' &&
        turn.startTime <= midpoint &&
        turn.endTime >= midpoint,
    );
    if (predicted && referenceThem && !referenceMe)
      falseMeSeconds += end - start;
    if (referenceMe && !predicted) missedMeSeconds += end - start;
  }
  return {
    falseMeSeconds: Math.round(falseMeSeconds * 1000) / 1000,
    missedMeSeconds: Math.round(missedMeSeconds * 1000) / 1000,
  };
};

export const runProductionAttributionAcceptance = (
  manifest: ProductionAttributionAcceptanceManifest,
) => {
  if (manifest.schemaVersion !== 1 || manifest.cases.length === 0) {
    throw new Error('Production attribution acceptance manifest is invalid.');
  }

  const results = manifest.cases.map((testCase) => {
    const evidenceWindows = deriveAttributionEvidence(testCase.energy);
    const attribution = mapDiarizationFromAcousticEvidence({
      turns: testCase.turns,
      evidenceWindows,
    });
    let appliedLocalWindows = attribution.injectedLocalWindows.length;
    let measured = {
      falseMeSeconds: attribution.falseMeEvidenceSeconds,
      missedMeSeconds: attribution.missedMeEvidenceSeconds,
    };
    if (testCase.segments && testCase.referenceTurns) {
      const mapping = Object.fromEntries(
        Object.entries(attribution.mapping).filter(
          (entry): entry is [string, 'Me' | 'Them'] =>
            entry[1] === 'Me' || entry[1] === 'Them',
        ),
      );
      const mappingConfident =
        Object.keys(mapping).length > 0 &&
        !Object.values(attribution.mapping).includes('Unknown');
      if (!mappingConfident) {
        appliedLocalWindows = 0;
        measured = measureAgainstReference(
          testCase.segments,
          testCase.referenceTurns,
        );
        return {
          id: testCase.id,
          ...measured,
          injectedLocalWindows: appliedLocalWindows,
          passed:
            matchesSeconds(
              measured.falseMeSeconds,
              testCase.expected.falseMeSeconds,
            ) &&
            (testCase.expected.missedMeSeconds === undefined ||
              matchesSeconds(
                measured.missedMeSeconds,
                testCase.expected.missedMeSeconds,
              )) &&
            appliedLocalWindows === testCase.expected.injectedLocalWindows,
        };
      }
      const diarizationSegments = testCase.turns.map((turn) => ({
        ...turn,
        speaker: turn.cluster,
        text: '',
      }));
      const boundarySplit = splitSegmentsAtDiarizationBoundaries(
        testCase.segments,
        diarizationSegments,
        mapping,
      );
      const refined = applyDiarizationRefinement({
        segments: boundarySplit.segments,
        diarizationSegments,
        mapping,
      });
      const injected = injectLocalEvidenceWindows(
        refined.segments as AcceptanceSegment[],
        attribution.injectedLocalWindows,
      );
      appliedLocalWindows = Math.max(
        0,
        injected.filter((segment) => segment.speaker === 'Me').length -
          refined.segments.filter((segment) => segment.speaker === 'Me').length,
      );
      measured = measureAgainstReference(injected, testCase.referenceTurns);
    }
    const result = {
      id: testCase.id,
      ...measured,
      injectedLocalWindows: appliedLocalWindows,
    };
    return {
      ...result,
      passed:
        matchesSeconds(
          result.falseMeSeconds,
          testCase.expected.falseMeSeconds,
        ) &&
        (testCase.expected.missedMeSeconds === undefined ||
          matchesSeconds(
            result.missedMeSeconds,
            testCase.expected.missedMeSeconds,
          )) &&
        result.injectedLocalWindows === testCase.expected.injectedLocalWindows,
    };
  });

  return {
    schemaVersion: manifest.schemaVersion,
    passed: results.every((result) => result.passed),
    results,
  };
};
