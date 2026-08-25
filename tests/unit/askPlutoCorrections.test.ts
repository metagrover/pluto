import { describe, expect, it } from 'vitest';

import {
  detectExplicitAskPlutoCorrection,
  formatAskPlutoCorrectionsForPrompt,
  parseAskPlutoCorrectionRecords,
  selectRelevantAskPlutoCorrections,
} from '../../electron/intelligence/askPlutoCorrections';

describe('Ask Pluto corrections', () => {
  const priorTurns = [
    {
      role: 'assistant' as const,
      content: 'Sam owns the pricing approval.',
      meetingIds: ['meeting-1'],
    },
  ];

  it('captures an explicit correction against the prior cited answer', () => {
    expect(
      detectExplicitAskPlutoCorrection(
        'Actually, Alex owns pricing approval, not Sam.',
        priorTurns,
      ),
    ).toEqual({
      originalClaim: 'Sam owns the pricing approval.',
      correctedText: 'Alex owns pricing approval, not Sam.',
      meetingIds: ['meeting-1'],
    });
  });

  it('does not treat an ordinary negative question as a correction', () => {
    expect(
      detectExplicitAskPlutoCorrection(
        'No blockers were mentioned?',
        priorTurns,
      ),
    ).toBeNull();
  });

  it('does not persist a conversational transition as a correction', () => {
    expect(
      detectExplicitAskPlutoCorrection(
        'Actually, can you compare those meetings?',
        priorTurns,
      ),
    ).toBeNull();
  });

  it('requires a prior cited assistant answer before storing a correction', () => {
    expect(
      detectExplicitAskPlutoCorrection('Correction: Alex owns it.', [
        { role: 'assistant', content: 'Sam owns it.', meetingIds: [] },
      ]),
    ).toBeNull();
  });

  it('parses only Ask Pluto claim corrections from shared correction records', () => {
    const parsed = parseAskPlutoCorrectionRecords([
      {
        target_kind: 'claim',
        action: 'correct_claim',
        created_at: '2026-08-25T12:00:00.000Z',
        payload_json: JSON.stringify({
          source: 'ask_pluto',
          original_claim: 'Sam owns pricing approval.',
          corrected_text: 'Alex owns pricing approval.',
          meeting_ids: ['meeting-1'],
        }),
      },
      {
        target_kind: 'item',
        action: 'promote_item',
        created_at: '2026-08-25T12:01:00.000Z',
        payload_json: null,
      },
    ]);

    expect(parsed).toEqual([
      {
        originalClaim: 'Sam owns pricing approval.',
        correctedText: 'Alex owns pricing approval.',
        meetingIds: ['meeting-1'],
        createdAt: '2026-08-25T12:00:00.000Z',
      },
    ]);
  });

  it('selects relevant corrections and formats them as non-citation constraints', () => {
    const corrections = [
      {
        originalClaim: 'Sam owns pricing approval.',
        correctedText: 'Alex owns pricing approval.',
        meetingIds: ['meeting-1'],
        createdAt: '2026-08-25T12:00:00.000Z',
      },
      {
        originalClaim: 'The launch is Friday.',
        correctedText: 'The launch is Monday.',
        meetingIds: ['meeting-2'],
        createdAt: '2026-08-25T13:00:00.000Z',
      },
    ];

    const relevant = selectRelevantAskPlutoCorrections(
      'Who owns pricing approval?',
      corrections,
    );
    expect(relevant).toHaveLength(1);
    expect(formatAskPlutoCorrectionsForPrompt(relevant)).toContain(
      'Alex owns pricing approval.',
    );
    expect(formatAskPlutoCorrectionsForPrompt(relevant)).toContain(
      'not meeting evidence',
    );
  });
});
