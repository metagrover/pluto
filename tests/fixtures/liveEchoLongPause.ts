import type { LiveTranscriptSegment } from '../../src/components/features/recordingWorkspaceModel';
import type { LiveEchoEvidenceWindow } from '../../src/services/liveTranscription/liveEchoEvidence';

// Saved native word times and source-PCM proof for a reference phrase followed
// by a long pause. The last mic word end was revised to the next local onset.
export const liveEchoLongPauseFixture = (): {
  rows: LiveTranscriptSegment[];
  echoEvidence: LiveEchoEvidenceWindow[];
} => ({
  rows: [
    {
      id: 'long-pause-0',
      source: 'system',
      speaker: 'Them',
      text: 'the blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript',
      rawText:
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript',
      timestampMs: 26349.333333333336,
      endTimestampMs: 36349.333333333336,
      confirmed: true,
      wordTimings: [
        {
          text: 'the',
          timestampMs: 26349.333333333336,
          endTimestampMs: 26589.333333333332,
        },
        {
          text: 'blue',
          timestampMs: 26589.333333333332,
          endTimestampMs: 26749.333333333332,
        },
        {
          text: 'notebook',
          timestampMs: 26749.333333333332,
          endTimestampMs: 27069.333333333332,
        },
        {
          text: 'is',
          timestampMs: 27069.333333333332,
          endTimestampMs: 27229.333333333332,
        },
        {
          text: 'on',
          timestampMs: 27229.333333333332,
          endTimestampMs: 27389.333333333332,
        },
        {
          text: 'the',
          timestampMs: 27389.333333333332,
          endTimestampMs: 27709.333333333332,
        },
        {
          text: 'desk',
          timestampMs: 27709.333333333332,
          endTimestampMs: 28029.333333333332,
        },
        {
          text: 'i',
          timestampMs: 28029.333333333332,
          endTimestampMs: 28189.333333333332,
        },
        {
          text: 'will',
          timestampMs: 28189.333333333332,
          endTimestampMs: 28509.333333333336,
        },
        {
          text: 'review',
          timestampMs: 28509.333333333336,
          endTimestampMs: 28669.333333333336,
        },
        {
          text: 'the',
          timestampMs: 28669.333333333336,
          endTimestampMs: 28989.333333333336,
        },
        {
          text: 'recording',
          timestampMs: 28989.333333333336,
          endTimestampMs: 29469.333333333336,
        },
        {
          text: 'tomorrow',
          timestampMs: 29469.333333333336,
          endTimestampMs: 32109.333333333332,
        },
        {
          text: 'the',
          timestampMs: 32109.333333333332,
          endTimestampMs: 32269.333333333336,
        },
        {
          text: 'green',
          timestampMs: 32269.333333333336,
          endTimestampMs: 32749.333333333332,
        },
        {
          text: 'folder',
          timestampMs: 32749.333333333332,
          endTimestampMs: 33149.33333333333,
        },
        {
          text: 'contains',
          timestampMs: 33149.33333333333,
          endTimestampMs: 33949.333333333336,
        },
        {
          text: 'our',
          timestampMs: 33949.333333333336,
          endTimestampMs: 34109.33333333333,
        },
        {
          text: 'notes',
          timestampMs: 34109.33333333333,
          endTimestampMs: 34429.333333333336,
        },
        {
          text: 'i',
          timestampMs: 34429.333333333336,
          endTimestampMs: 34589.33333333333,
        },
        {
          text: 'will',
          timestampMs: 34589.33333333333,
          endTimestampMs: 34749.333333333336,
        },
        {
          text: 'check',
          timestampMs: 34749.333333333336,
          endTimestampMs: 35069.333333333336,
        },
        {
          text: 'the',
          timestampMs: 35069.333333333336,
          endTimestampMs: 35229.33333333333,
        },
        {
          text: 'final',
          timestampMs: 35229.33333333333,
          endTimestampMs: 35709.333333333336,
        },
        {
          text: 'transcript',
          timestampMs: 35709.333333333336,
          endTimestampMs: 36349.333333333336,
        },
      ],
    },
    {
      id: 'long-pause-1',
      source: 'mic',
      speaker: 'Me',
      text: 'the blue notebook is on the desk i will review the recording',
      rawText: 'the blue notebook is on the desk i will review the recording',
      timestampMs: 26412.625000000004,
      endTimestampMs: 29532.625000000004,
      confirmed: true,
      wordTimings: [
        {
          text: 'the',
          timestampMs: 26412.625000000004,
          endTimestampMs: 26652.625,
        },
        {
          text: 'blue',
          timestampMs: 26652.625,
          endTimestampMs: 26972.625,
        },
        {
          text: 'notebook',
          timestampMs: 26972.625,
          endTimestampMs: 27292.625,
        },
        {
          text: 'is',
          timestampMs: 27292.625,
          endTimestampMs: 27372.625000000004,
        },
        {
          text: 'on',
          timestampMs: 27372.625000000004,
          endTimestampMs: 27452.625,
        },
        {
          text: 'the',
          timestampMs: 27452.625,
          endTimestampMs: 27772.625,
        },
        {
          text: 'desk',
          timestampMs: 27772.625,
          endTimestampMs: 28092.625,
        },
        {
          text: 'i',
          timestampMs: 28092.625,
          endTimestampMs: 28252.625000000004,
        },
        {
          text: 'will',
          timestampMs: 28252.625000000004,
          endTimestampMs: 28572.625000000004,
        },
        {
          text: 'review',
          timestampMs: 28572.625000000004,
          endTimestampMs: 28892.625000000004,
        },
        {
          text: 'the',
          timestampMs: 28892.625000000004,
          endTimestampMs: 29052.625000000004,
        },
        {
          text: 'recording',
          timestampMs: 29052.625000000004,
          endTimestampMs: 29532.625000000004,
        },
      ],
    },
    {
      id: 'long-pause-2',
      source: 'mic',
      speaker: 'Me',
      text: 'tomorrow the green folder contains our nodes i will check the final transcript',
      rawText:
        'tomorrow the green folder contains our nodes i will check the final transcript',
      timestampMs: 29532.625000000004,
      endTimestampMs: 36412.625,
      confirmed: true,
      wordTimings: [
        {
          text: 'tomorrow',
          timestampMs: 29532.625000000004,
          endTimestampMs: 32332.625,
        },
        {
          text: 'the',
          timestampMs: 32332.625,
          endTimestampMs: 32572.625000000004,
        },
        {
          text: 'green',
          timestampMs: 32572.625000000004,
          endTimestampMs: 33052.625,
        },
        {
          text: 'folder',
          timestampMs: 33052.625,
          endTimestampMs: 33292.625,
        },
        {
          text: 'contains',
          timestampMs: 33292.625,
          endTimestampMs: 34012.625,
        },
        {
          text: 'our',
          timestampMs: 34012.625,
          endTimestampMs: 34172.625,
        },
        {
          text: 'nodes',
          timestampMs: 34172.625,
          endTimestampMs: 34492.625,
        },
        {
          text: 'i',
          timestampMs: 34492.625,
          endTimestampMs: 34652.625,
        },
        {
          text: 'will',
          timestampMs: 34652.625,
          endTimestampMs: 34812.625,
        },
        {
          text: 'check',
          timestampMs: 34812.625,
          endTimestampMs: 34972.625,
        },
        {
          text: 'the',
          timestampMs: 34972.625,
          endTimestampMs: 35292.625,
        },
        {
          text: 'final',
          timestampMs: 35292.625,
          endTimestampMs: 35932.62499999999,
        },
        {
          text: 'transcript',
          timestampMs: 35932.62499999999,
          endTimestampMs: 36412.625,
        },
      ],
    },
    {
      id: 'long-pause-3',
      source: 'system',
      speaker: 'Them',
      text: 'today',
      rawText: 'today',
      timestampMs: 36349.333333333336,
      endTimestampMs: 36509.33333333333,
      confirmed: true,
      wordTimings: [
        {
          text: 'today',
          timestampMs: 36349.333333333336,
          endTimestampMs: 36509.33333333333,
        },
      ],
    },
    {
      id: 'long-pause-4',
      source: 'mic',
      speaker: 'Me',
      text: 'today can you hear mile vice ok',
      rawText: 'today can you hear mile vice ok',
      timestampMs: 36412.625,
      endTimestampMs: 74092.625,
      confirmed: true,
      wordTimings: [
        {
          text: 'today',
          timestampMs: 36412.625,
          endTimestampMs: 72572.625,
        },
        {
          text: 'can',
          timestampMs: 72572.625,
          endTimestampMs: 72572.625,
        },
        {
          text: 'you',
          timestampMs: 72572.625,
          endTimestampMs: 72892.62500000001,
        },
        {
          text: 'hear',
          timestampMs: 72892.62500000001,
          endTimestampMs: 73452.62500000001,
        },
        {
          text: 'mile',
          timestampMs: 73452.62500000001,
          endTimestampMs: 73852.625,
        },
        {
          text: 'vice',
          timestampMs: 73852.625,
          endTimestampMs: 74012.625,
        },
        {
          text: 'ok',
          timestampMs: 74012.625,
          endTimestampMs: 74092.625,
        },
      ],
    },
  ],
  echoEvidence: [
    {
      micStartMs: 26000,
      micEndMs: 27700,
      systemStartMs: 25880,
      systemEndMs: 27580,
    },
    {
      micStartMs: 27600,
      micEndMs: 28100,
      systemStartMs: 27460,
      systemEndMs: 27960,
    },
    {
      micStartMs: 27800,
      micEndMs: 28500,
      systemStartMs: 27690,
      systemEndMs: 28390,
    },
    {
      micStartMs: 27900,
      micEndMs: 29400,
      systemStartMs: 27780,
      systemEndMs: 29280,
    },
    {
      micStartMs: 29000,
      micEndMs: 30300,
      systemStartMs: 28870,
      systemEndMs: 30170,
    },
    {
      micStartMs: 29600,
      micEndMs: 30200,
      systemStartMs: 29500,
      systemEndMs: 30100,
    },
    {
      micStartMs: 31700,
      micEndMs: 33100,
      systemStartMs: 31570,
      systemEndMs: 32970,
    },
    {
      micStartMs: 31800,
      micEndMs: 32300,
      systemStartMs: 31680,
      systemEndMs: 32180,
    },
    {
      micStartMs: 33500,
      micEndMs: 34800,
      systemStartMs: 33380,
      systemEndMs: 34680,
    },
    {
      micStartMs: 34800,
      micEndMs: 35500,
      systemStartMs: 34670,
      systemEndMs: 35370,
    },
    {
      micStartMs: 35200,
      micEndMs: 35700,
      systemStartMs: 35080,
      systemEndMs: 35580,
    },
    {
      micStartMs: 35600,
      micEndMs: 36500,
      systemStartMs: 35470,
      systemEndMs: 36370,
    },
    {
      micStartMs: 36400,
      micEndMs: 36900,
      systemStartMs: 36260,
      systemEndMs: 36760,
    },
    {
      micStartMs: 36500,
      micEndMs: 37000,
      systemStartMs: 36390,
      systemEndMs: 36890,
    },
  ],
});
