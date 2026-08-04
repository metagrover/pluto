const ALIGNMENT_TOLERANCE_SECONDS = 0.25;

type CheckpointSegment = {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
};

export const normalizeCheckpointWords = (
  segments: CheckpointSegment[],
  journalDurationSeconds: number,
): CheckpointSegment[] => {
  if (!Number.isFinite(journalDurationSeconds) || journalDurationSeconds <= 0) {
    return [];
  }

  return segments.flatMap((segment) => {
    if (
      typeof segment.text !== 'string' ||
      !segment.text.trim() ||
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.end <= segment.start
    ) {
      return [];
    }

    const start = Math.max(0, segment.start);
    const end = Math.min(journalDurationSeconds, segment.end);
    if (end <= start) return [];

    const words = segment.words?.filter(
      (word) =>
        typeof word.word === 'string' &&
        Boolean(word.word.trim()) &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.start >= start &&
        word.end > word.start &&
        word.end <= end,
    );
    const exceedsAlignmentTolerance =
      segment.start < -ALIGNMENT_TOLERANCE_SECONDS ||
      segment.end >
        journalDurationSeconds + ALIGNMENT_TOLERANCE_SECONDS;
    if (exceedsAlignmentTolerance && !words?.length) return [];
    const text = exceedsAlignmentTolerance
      ? words?.map((word) => word.word.trim()).join(' ')
      : segment.text;
    if (!text?.trim()) return [];

    return [
      {
        ...segment,
        start,
        end,
        text,
        ...(words ? { words } : {}),
      },
    ];
  });
};

export type RecoveryAudioAlignmentDependencies = {
  probeDuration: (inputPath: string) => Promise<number | null>;
  createTemporaryPath: () => string;
  trimLeadingOverflow: (args: {
    inputPath: string;
    outputPath: string;
    startSec: number;
    durationSec: number;
  }) => Promise<boolean>;
  removeTemporaryFile: (path: string) => void;
};

export const transcribeJournalAlignedAudio = async <Result>(
  inputPath: string,
  journalDurationSeconds: number,
  deps: RecoveryAudioAlignmentDependencies,
  transcribe: (alignedPath: string) => Promise<Result>,
): Promise<Result> => {
  const artifactDurationSeconds = await deps.probeDuration(inputPath);
  if (artifactDurationSeconds === null) {
    throw new Error('journal_audio_duration_unavailable');
  }
  if (
    artifactDurationSeconds <=
    journalDurationSeconds + ALIGNMENT_TOLERANCE_SECONDS
  ) {
    return await transcribe(inputPath);
  }

  const temporaryPath = deps.createTemporaryPath();
  try {
    const trimmed = await deps.trimLeadingOverflow({
      inputPath,
      outputPath: temporaryPath,
      startSec: artifactDurationSeconds - journalDurationSeconds,
      durationSec: journalDurationSeconds,
    });
    if (!trimmed) throw new Error('journal_audio_trim_failed');
    return await transcribe(temporaryPath);
  } finally {
    deps.removeTemporaryFile(temporaryPath);
  }
};
