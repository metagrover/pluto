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
    ['Who created this plan?', 'fact'],
    ['Who will write the help guide?', 'fact'],
    ['Who built the rollout plan?', 'fact'],
    ['Who put together the proposal?', 'fact'],
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

  it('routes a requested draft separately from factual recall', () => {
    expect(
      routeMeetingAskPlutoAssistance(
        'Draft a thoughtful follow-up email to the customer',
      ),
    ).toEqual({ mode: 'draft' });
  });

  it.each([
    ['What could I do better in this conversation?', 'coaching'],
    ['How is the speaker doing?', 'coaching'],
    ['How is Mira doing in this conversation?', 'coaching'],
    ['Did Riley understand the proposal?', 'clarification'],
    ['What was confusing in that exchange?', 'clarification'],
  ] as const)('routes reflective question %s to %s', (query, mode) => {
    expect(routeMeetingAskPlutoAssistance(query)).toEqual({ mode });
  });
  it.each([
    ['Summarize this meeting', { mode: 'recall', recallKind: 'catch_up' }],
    ['Give me a brief', { mode: 'recall', recallKind: 'catch_up' }],
    ['Why did we decide to delay?', { mode: 'explanation' }],
    ['Explain that in more detail', { mode: 'explanation' }],
    ['Compare the two options', { mode: 'explanation' }],
    ['Can you explain that?', { mode: 'explanation' }],
    ['What led us to decide on this?', { mode: 'explanation' }],
    ['Could you draft a follow-up?', { mode: 'draft' }],
    ['Help me write a short message', { mode: 'draft' }],
    ['What should we do next?', { mode: 'advice' }],
    ['What should we clarify next?', { mode: 'advice' }],
    ['Suggest next steps', { mode: 'advice' }],
    ['Write a follow-up with the decisions', { mode: 'draft' }],
  ])('honors the requested answer shape for %s', (query, route) => {
    expect(routeMeetingAskPlutoAssistance(query)).toEqual(route);
  });
});
