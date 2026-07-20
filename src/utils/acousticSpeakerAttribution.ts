import { TRANSCRIPTION_TUNING } from './transcriptionConfig.ts';

export interface AlignedEnergyWindow {
  startTime: number;
  endTime: number;
  micRms: number;
  systemRms: number;
}

export interface AttributionEvidenceWindow {
  startTime: number;
  endTime: number;
  nearEndScore: number;
  remoteScore: number;
  evidence: 'mic_exclusive' | 'system_correlated' | 'inconclusive';
}

export interface DiarizationTurn {
  startTime: number;
  endTime: number;
  cluster: string;
}

export type AcousticSpeakerLabel = 'Me' | 'Them' | 'Unknown';

const overlapSeconds = (
  left: { startTime: number; endTime: number },
  right: { startTime: number; endTime: number },
): number => {
  return Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );
};

const roundSeconds = (value: number): number => Math.round(value * 1000) / 1000;

export const deriveAttributionEvidence = (
  windows: AlignedEnergyWindow[],
): AttributionEvidenceWindow[] => {
  const tuning = TRANSCRIPTION_TUNING.acousticAttribution;
  return windows
    .filter(
      (window) =>
        Number.isFinite(window.startTime) &&
        Number.isFinite(window.endTime) &&
        window.endTime > window.startTime,
    )
    .map((window) => {
      const micRms = Math.max(0, window.micRms);
      const systemRms = Math.max(0, window.systemRms);
      const micActive = micRms >= tuning.micActiveRms;
      const systemActive = systemRms >= tuning.systemActiveRms;
      const dominance = micRms / Math.max(systemRms, 0.000001);

      if (
        micActive &&
        (!systemActive || dominance >= tuning.nearEndDominanceRatio)
      ) {
        return {
          startTime: window.startTime,
          endTime: window.endTime,
          nearEndScore: Math.min(1, dominance / tuning.nearEndDominanceRatio),
          remoteScore: systemActive ? Math.min(1, 1 / dominance) : 0,
          evidence: 'mic_exclusive' as const,
        };
      }

      if (systemActive) {
        return {
          startTime: window.startTime,
          endTime: window.endTime,
          nearEndScore: 0,
          remoteScore: 1,
          evidence: 'system_correlated' as const,
        };
      }

      return {
        startTime: window.startTime,
        endTime: window.endTime,
        nearEndScore: 0,
        remoteScore: 0,
        evidence: 'inconclusive' as const,
      };
    });
};

export const mapDiarizationFromAcousticEvidence = (params: {
  turns: DiarizationTurn[];
  evidenceWindows: AttributionEvidenceWindow[];
}) => {
  const tuning = TRANSCRIPTION_TUNING.acousticAttribution;
  const clusters = [...new Set(params.turns.map((turn) => turn.cluster))];
  const mapping: Record<string, AcousticSpeakerLabel> = {};

  if (params.evidenceWindows.length === 0) {
    for (const cluster of clusters) mapping[cluster] = 'Unknown';
    return {
      mapping,
      confidence: 0,
      fallbackReason: 'missing_acoustic_evidence' as const,
      injectedLocalWindows: [],
      falseMeEvidenceSeconds: 0,
      missedMeEvidenceSeconds: 0,
    };
  }

  const scores = clusters.map((cluster) => {
    const turns = params.turns.filter((turn) => turn.cluster === cluster);
    let near = 0;
    let remote = 0;
    for (const turn of turns) {
      for (const evidence of params.evidenceWindows) {
        const overlap = overlapSeconds(turn, evidence);
        near += overlap * evidence.nearEndScore;
        remote += overlap * evidence.remoteScore;
      }
    }
    return { cluster, near, remote };
  });

  const local = [...scores]
    .filter(
      (score) =>
        score.near >= tuning.minLocalClusterSeconds &&
        score.near >= score.remote * tuning.minLocalToRemoteRatio,
    )
    .sort((left, right) => right.near - left.near)[0];

  for (const score of scores) {
    if (local?.cluster === score.cluster) {
      mapping[score.cluster] = 'Me';
    } else if (
      score.remote >= tuning.minRemoteEvidenceSeconds ||
      local !== undefined
    ) {
      mapping[score.cluster] = 'Them';
    } else {
      mapping[score.cluster] = 'Unknown';
    }
  }

  const injectedLocalWindows = params.evidenceWindows
    .filter((evidence) => {
      const duration = evidence.endTime - evidence.startTime;
      if (
        evidence.evidence !== 'mic_exclusive' ||
        evidence.nearEndScore < tuning.minInjectedNearEndScore ||
        duration < tuning.minInjectedLocalSeconds ||
        duration > tuning.maxInjectedLocalSeconds
      ) {
        return false;
      }
      const alreadyLocal = params.turns.some(
        (turn) =>
          mapping[turn.cluster] === 'Me' && overlapSeconds(turn, evidence) > 0,
      );
      return !alreadyLocal;
    })
    .map((evidence) => ({
      startTime: evidence.startTime,
      endTime: evidence.endTime,
      overlapsRemote: params.turns.some(
        (turn) =>
          mapping[turn.cluster] === 'Them' &&
          overlapSeconds(turn, evidence) > 0,
      ),
    }));

  let falseMeEvidenceSeconds = 0;
  let missedMeEvidenceSeconds = 0;
  for (const evidence of params.evidenceWindows) {
    const duration = evidence.endTime - evidence.startTime;
    if (evidence.evidence === 'system_correlated') {
      const meOverlap = params.turns.some(
        (turn) =>
          mapping[turn.cluster] === 'Me' && overlapSeconds(turn, evidence) > 0,
      );
      if (meOverlap) falseMeEvidenceSeconds += duration;
    }
    if (evidence.evidence === 'mic_exclusive') {
      const coveredByMe = params.turns.some(
        (turn) =>
          mapping[turn.cluster] === 'Me' && overlapSeconds(turn, evidence) > 0,
      );
      const injected = injectedLocalWindows.some(
        (window) => overlapSeconds(window, evidence) > 0,
      );
      if (!coveredByMe && !injected) missedMeEvidenceSeconds += duration;
    }
  }

  const supportedSeconds = scores.reduce(
    (total, score) => total + Math.max(score.near, score.remote),
    0,
  );
  const totalSeconds = scores.reduce(
    (total, score) => total + score.near + score.remote,
    0,
  );

  return {
    mapping,
    confidence: totalSeconds > 0 ? supportedSeconds / totalSeconds : 0,
    fallbackReason: Object.values(mapping).includes('Unknown')
      ? ('inconclusive_acoustic_evidence' as const)
      : undefined,
    injectedLocalWindows,
    falseMeEvidenceSeconds: roundSeconds(falseMeEvidenceSeconds),
    missedMeEvidenceSeconds: roundSeconds(missedMeEvidenceSeconds),
  };
};
