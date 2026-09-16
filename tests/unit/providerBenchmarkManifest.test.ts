import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('provider comparison benchmark manifest', () => {
  it('pins synthetic fixtures by immutable SHA-256 and required coverage', () => {
    const root = path.resolve('benchmarks/provider-comparison');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'),
    ) as {
      fixtures: Array<{ path: string; sha256: string }>;
      workflows: string[];
      requiredDimensions: string[];
    };
    for (const fixture of manifest.fixtures) {
      const bytes = fs.readFileSync(path.join(root, fixture.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        fixture.sha256,
      );
    }
    expect(manifest.workflows).toEqual(
      expect.arrayContaining([
        'meeting_notes',
        'commitments',
        'profile_updates',
        'project_updates',
        'meeting_qa',
        'suggested_questions',
      ]),
    );
    expect(manifest.requiredDimensions).toEqual(
      expect.arrayContaining([
        'factuality',
        'unsupported_claims',
        'missed_commitments',
        'speaker_context_accuracy',
        'end_to_end_latency_ms',
        'api_cost_usd',
      ]),
    );
  });
});
