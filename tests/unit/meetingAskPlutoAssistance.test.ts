import { describe, expect, it } from 'vitest';

import { routeMeetingAskPlutoAssistance } from '../../electron/intelligence/meetingAskPlutoAssistance';

describe('meeting Ask Pluto assistance routing', () => {
  it.each([
    ['What did I miss?', 'catch_up'],
    ['What are they talking about right now?', 'catch_up'],
    ['Catch me up on the conversation', 'catch_up'],
  ] as const)('routes %s to recall/%s', (query, recallKind) => {
    expect(routeMeetingAskPlutoAssistance(query)).toEqual({
      mode: 'recall',
      recallKind,
    });
  });

  it.each([
    ['What did Avery say about pricing?', 'fact'],
    ['Did we discuss the launch date?', 'fact'],
    ['Remind me what the customer asked for', 'fact'],
    ['What is the name of the person mentioned?', 'fact'],
    ['Who was the person mentioned?', 'fact'],
    ['When is the launch?', 'fact'],
    ['Where are we meeting?', 'fact'],
    ['What did we decide?', 'decision'],
    ['Did everyone agree on the rollout?', 'decision'],
    ['What are the next steps?', 'action'],
    ['Who owns the migration checklist?', 'action'],
    ['Was there a deadline for the follow-up?', 'action'],
  ] as const)('routes %s to recall/%s', (query, recallKind) => {
    expect(routeMeetingAskPlutoAssistance(query)).toEqual({
      mode: 'recall',
      recallKind,
    });
  });

  it('keeps unsupported assistance modes on the general chat path', () => {
    expect(
      routeMeetingAskPlutoAssistance(
        'Draft a thoughtful follow-up email to the customer',
      ),
    ).toEqual({ mode: 'general' });
  });
});
