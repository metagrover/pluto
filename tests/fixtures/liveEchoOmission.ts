// Native EOU word times from a two-source reference-phrase replay.
// Microphone ASR omitted the middle System sentence and padded adjacent ends.
export const liveEchoOmissionFixture = () => {
  const remote =
    'the blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript today';
  const echo =
    'the blue notebook is on the desk i will review the recording tomorrow transcript today';
  const local = 'can you hear me okay';
  const micTimes = [
    34560, 34880, 35200, 35520, 35600, 35680, 36000, 36480, 36480, 36800, 37120,
    37280, 37760, 44320, 44640, 47200, 47200, 47440, 47520, 47760, 67920,
  ];
  const systemTimes = [
    34640, 34720, 35040, 35280, 35360, 35520, 35840, 36320, 36480, 36640, 36960,
    37280, 37600, 40320, 40400, 40960, 41200, 42080, 42160, 42560, 42720, 42880,
    43200, 43520, 43840, 44480, 44640,
  ];
  const timed = (text: string, times: number[]) =>
    text.split(' ').map((text, index) => ({
      text,
      timestampMs: times[index],
      endTimestampMs: times[index + 1],
    }));
  const mic = {
    id: 'mic',
    source: 'mic' as const,
    speaker: 'Me' as const,
    text: `${echo} ${local}`,
    rawText: `${echo} ${local}`,
    timestampMs: 34560,
    endTimestampMs: 67920,
    confirmed: true,
    wordTimings: timed(`${echo} ${local}`, micTimes),
  };
  const system = {
    id: 'system',
    source: 'system' as const,
    speaker: 'Them' as const,
    text: remote,
    rawText: remote,
    timestampMs: 34640,
    endTimestampMs: 44640,
    confirmed: true,
    wordTimings: timed(remote, systemTimes),
  };
  const echoEvidence = [
    {
      micStartMs: 34500,
      micEndMs: 35500,
      systemStartMs: 34390,
      systemEndMs: 35390,
    },
    {
      micStartMs: 36000,
      micEndMs: 36500,
      systemStartMs: 35890,
      systemEndMs: 36390,
    },
    {
      micStartMs: 36500,
      micEndMs: 37000,
      systemStartMs: 36380,
      systemEndMs: 36880,
    },
  ];
  return { mic, system, echoEvidence, local };
};
