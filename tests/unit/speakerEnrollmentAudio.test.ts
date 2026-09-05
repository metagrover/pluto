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
        '[0:a]atrim=start=71.76:end=79.76,asetpts=PTS-STARTPTS[s0];' +
        '[0:a]atrim=start=0:end=1,volume=0,asetpts=PTS-STARTPTS[gap];' +
        '[0:a]atrim=start=1090:end=1093.04,asetpts=PTS-STARTPTS[s1];' +
        '[s0][gap][s1]concat=n=3:v=0:a=1[out]',
      totalDurationSeconds: 12.04,
    });
  });

  it('rejects anything other than two valid modal samples', () => {
    expect(planSpeakerEnrollmentAudio([])).toBeNull();
    expect(
      planSpeakerEnrollmentAudio([
        { startSec: 1, endSec: 3, excerpt: 'Only one sample' },
      ]),
    ).toBeNull();
    expect(
      planSpeakerEnrollmentAudio([
        { startSec: 5, endSec: 4, excerpt: 'Invalid' },
        { startSec: 10, endSec: 13, excerpt: 'Valid' },
      ]),
    ).toBeNull();
  });
});
