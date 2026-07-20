export const TRANSCRIPTION_TUNING = {
  speaking: {
    rmsWindowSeconds: 0.5,
    rmsThreshold: 0.012,
    minIntervalMs: 200,
    ratio: 1.25,
  },
  systemTranscribe: {
    minRms: 0.002,
  },
  micTranscribe: {
    minRms: 0.001,
    minSpeakerCoverageSeconds: 0.2,
    minSpeakerCoverageRatio: 0.1,
  },
  chunkFlush: {
    minRms: 0.003,
    minSegmentSeconds: 0.3,
    padSeconds: 0.3,
    maxSegments: 4,
    maxFullCoverageRatio: 0.75,
  },
  activityPrune: {
    meOverlapRatio: 0.45,
    meMinCoverage: 0.35,
    meCoverageRatio: 1.5,
    meMinCoverageFloor: 0.25,
    themOverlapRatio: 0.8,
    themMinCoverage: 0.75,
    themCoverageRatio: 3.0,
    themMinCoverageFloor: 0.55,
  },
  sourceEchoPrune: {
    maxGapSeconds: 0.35,
    // Berlin loudspeaker-bleed pattern contains partial paraphrases.
    // Lowering similarity slightly helps the lexical evidence gate
    // trigger more reliably without relying on RMS activity windows.
    minSimilarity: 0.38,
    minThemCoverage: 0.25,
    // Allow a bit more Me activity before assuming it's local speech,
    // since RMS windows can be polluted by echo.
    maxMeCoverageForEcho: 0.16,
    themCoverageRatio: 1.2,
  },
  transcriptQuality: {
    minWords: 5,
    minOverlapRatio: 0.45,
    qualityDelta: 0.28,
    strongQualityDelta: 0.45,
    strongWordDelta: 4,
    shortSystemWords: 3,
    informativeSystemWords: 6,
    informativeSystemScore: 0.45,
  },
  energyPrune: {
    minOverlapRatio: 0.2,
    dominanceRatio: 1.15,
  },
  competingUtterance: {
    highOverlapRatio: 0.62,
    highOverlapSeconds: 1.2,
    lowOverlapRatio: 0.45,
    tokenSimilarity: 0.28,
    prefixSimilarity: 0.45,
  },
  dominanceSelection: {
    strongCoverage: 0.8,
    strongCoverageRatio: 2.8,
    moderateCoverage: 0.2,
    moderateCoverageRatio: 1.25,
    rmsDominanceRatio: 1.2,
    wordDelta: 3,
    strongWordDelta: 4,
  },
  chunkPreference: {
    minCoverageSeconds: 0.35,
    coverageRatio: 1.2,
  },
  diarization: {
    activityWeight: 0.6,
    minSpeakerOverlapSeconds: 1.2,
    minSpeakerScoreRatio: 0.18,
    minSegmentOverlapSeconds: 0.2,
    minSegmentCoverageRatio: 0.5,
  },
  acousticAttribution: {
    micActiveRms: 0.012,
    systemActiveRms: 0.002,
    nearEndDominanceRatio: 2.5,
    minLocalClusterSeconds: 1.2,
    minLocalToRemoteRatio: 1.5,
    minRemoteEvidenceSeconds: 0.2,
    minInjectedLocalSeconds: 0.25,
    maxInjectedLocalSeconds: 1.5,
    minInjectedNearEndScore: 0.8,
    maxInjectedEvidenceGapSeconds: 0.5,
    minInjectedSegmentCoverageRatio: 0.5,
    maxSparseInjectedSegmentSeconds: 0.75,
    minSparseInjectedSegmentCoverageRatio: 0.15,
  },
  /**
   * When mix canonical ASR glues Me + Them, split using overlapping Them-channel text.
   */
  canonicalChannelSplit: {
    minThemOverlapSeconds: 0.08,
    minThemAnchorWords: 5,
    minMePrefixWords: 3,
    minThemChannelWords: 5,
  },
  /**
   * Split transcript segments when diarization shows two mapped speakers inside one span.
   */
  diarizationBoundarySplit: {
    minClipDurationSec: 0.25,
    minSegmentWords: 10,
    minSecondSpeakerClipSec: 0.35,
  },
  /**
   * Full-session Whisper text for canonical hydration: mix-down hears both sides
   * on one timeline (stable wording/boundaries). Me recovery still uses mic-only
   * when this is enabled and a mix file exists.
   */
  canonicalTranscript: {
    preferMixSource: true,
  },
  /**
   * Second-pass cross-channel collapse: high time overlap + moderate lexical
   * match, below strict isDuplicatePair thresholds (paraphrase / timing skew).
   */
  overlapNearDuplicate: {
    minOverlapRatio: 0.34,
    minOverlapSeconds: 0.3,
    minTokenSim: 0.42,
    minPrefixSim: 0.48,
  },
} as const;
