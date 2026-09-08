import { describe, expect, it } from 'vitest';
import { planSpeakerEnrollmentAudio } from '../../electron/speakerEnrollmentAudio';

describe('speakerEnrollmentAudio', () => {
  it('builds a bounded two-sample clip separated by silence', () => {
    const plan = planSpeakerEnrollmentAudio([
      { startSec: 71.76, endSec: 79.76, excerpt: 'First sample' },
      { startSec: 1090, endSec: 1093.04, excerpt: 'Second sample' },
    ]);

    expect(plan).toEqual({
      filter:
        '[0:a]atrim=start=0:duration=8,asetpts=PTS-STARTPTS[s0];' +
        '[1:a]atrim=start=0:duration=3.04,asetpts=PTS-STARTPTS[s1];' +
        'anullsrc=channel_layout=mono:sample_rate=16000:d=1[gap0];' +
        '[s0][gap0][s1]concat=n=3:v=0:a=1[out]',
      inputSeeks: [71.76, 1090],
      totalDurationSeconds: 12.04,
    });
  });

  it('accepts one valid interval and rejects invalid intervals', () => {
    expect(planSpeakerEnrollmentAudio([])).toBeNull();
    expect(
      planSpeakerEnrollmentAudio([
        { startSec: 1, endSec: 3, excerpt: 'Only one sample' },
      ]),
    ).not.toBeNull();
    expect(
      planSpeakerEnrollmentAudio([
        { startSec: 5, endSec: 4, excerpt: 'Invalid' },
        { startSec: 10, endSec: 13, excerpt: 'Valid' },
      ]),
    ).toBeNull();
  });

  it('concatenates multiple enrollment intervals with bounded silence gaps', () => {
    const plan = planSpeakerEnrollmentAudio([
      { startSec: 1, endSec: 5, excerpt: 'First' },
      { startSec: 20, endSec: 25, excerpt: 'Second' },
      { startSec: 40, endSec: 43, excerpt: 'Third' },
    ]);

    expect(plan).toEqual({
      filter:
        '[0:a]atrim=start=0:duration=4,asetpts=PTS-STARTPTS[s0];' +
        '[1:a]atrim=start=0:duration=5,asetpts=PTS-STARTPTS[s1];' +
        '[2:a]atrim=start=0:duration=3,asetpts=PTS-STARTPTS[s2];' +
        'anullsrc=channel_layout=mono:sample_rate=16000:d=1[gap0];' +
        'anullsrc=channel_layout=mono:sample_rate=16000:d=1[gap1];' +
        '[s0][gap0][s1][gap1][s2]concat=n=5:v=0:a=1[out]',
      inputSeeks: [1, 20, 40],
      totalDurationSeconds: 14,
    });
  });
});
