import { describe, expect, it } from 'vitest';
import { buildPersonDossierRead } from '../../src/utils/personDossierRead';

describe('person dossier read', () => {
  it('leads with recurring work and shows an attributable example', () => {
    const result = buildPersonDossierRead(
      'Avery',
      [
        {
          id: 'launch',
          title: 'Launch and Partner Coordination',
          current_read: 'Avery is handling launches and on partner timing.',
        },
      ],
      [
        {
          meeting_id: 'meeting-one',
          meeting_title: 'Launch review',
          quote: 'Avery revised the partner launch plan.',
          stream_ids: ['launch'],
        },
        {
          meeting_id: 'meeting-two',
          meeting_title: 'Partner check-in',
          quote: 'Avery worked through the partner handoff.',
          stream_ids: ['launch'],
        },
      ],
    );

    expect(result.headline).toBe(
      'Avery has worked on launch and partner coordination across multiple conversations.',
    );
    expect(result.workstreams[0]?.detail).toBe(
      'Avery worked through the partner handoff.',
    );
  });
});
