import { expect, it } from 'vitest';

import { runAskPlutoBenchmark } from '../../scripts/run_ask_pluto_benchmark';

it(
  'measures the notes-first production provider path without meeting content',
  async () => {
    const report = await runAskPlutoBenchmark();

    expect(report.samples.length).toBeGreaterThanOrEqual(2);
    expect(
      report.samples.every(
        (sample) =>
          sample.policy === 'notes_only' &&
          sample.sourceCount > 0 &&
          sample.promptChars > sample.evidenceChars,
      ),
    ).toBe(true);
  },
  15 * 60_000,
);
