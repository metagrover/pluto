import { describe, expect, it } from 'vitest';

import {
  applyAskPlutoPlan,
  buildAskPlutoPlanPrompt,
  parseAskPlutoPlan,
} from '../../electron/intelligence/askPlutoPlanner';

const plan = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    route: 'meetings',
    relation: 'follow_up',
    task: 'lookup',
    question: 'Who owns the next step of the fictional pilot migration?',
    people: [],
    meeting: 'none',
    one_on_one: false,
    timeframe: '',
    reply: '',
    ...overrides,
  });

const legacy = {
  relation: 'new_topic' as const,
  task: 'lookup' as const,
  turnMode: 'lookup' as const,
  retrievalPolicy: 'fresh' as const,
  retrievalQuery: 'who owns the next step?',
  answerQuery: 'who owns the next step?',
  priorQuestion: 'What did we decide about the fictional pilot migration?',
};

describe('Ask Pluto planner prompt', () => {
  it('puts static instructions before the dialogue and latest message', () => {
    const prompt = buildAskPlutoPlanPrompt({
      question: 'tell me more?',
      turns: [
        { role: 'user', content: 'what can you help with?' },
        { role: 'assistant', content: 'I can search your meeting notes.' },
      ],
      now: new Date('2026-11-03T12:00:00Z'),
    });
    expect(prompt.indexOf('Routes:')).toBeLessThan(prompt.indexOf('Today:'));
    expect(prompt).toContain('Pluto: I can search your meeting notes.');
    expect(prompt.trim().endsWith('Latest message: tell me more?\nJSON:')).toBe(
      true,
    );
  });
});

describe('parseAskPlutoPlan', () => {
  it('accepts a complete plan, including fenced output', () => {
    expect(parseAskPlutoPlan(plan())?.route).toBe('meetings');
    expect(
      parseAskPlutoPlan(`\`\`\`json\n${plan()}\n\`\`\``)?.question,
    ).toContain('fictional pilot');
  });

  it('rejects malformed plans so routing falls back', () => {
    expect(parseAskPlutoPlan('not json')).toBeNull();
    expect(parseAskPlutoPlan(plan({ route: 'web_search' }))).toBeNull();
    expect(parseAskPlutoPlan(plan({ extra: true }))).toBeNull();
    expect(parseAskPlutoPlan(plan({ question: '' }))).toBeNull();
  });

  it('routes drafts through meeting evidence even if marked as a task action', () => {
    expect(
      parseAskPlutoPlan(plan({ route: 'task_action', task: 'draft' })),
    ).toMatchObject({ route: 'meetings', task: 'draft' });
  });

  it('keeps the discussion scope for a draft addressed to a recipient', () => {
    const draft = plan({
      route: 'task_action',
      task: 'draft',
      meeting: 'last',
      one_on_one: true,
      people: ['Sam'],
    });
    expect(
      parseAskPlutoPlan(draft, 'Draft a Slack update to Sam about it.'),
    ).toMatchObject({ meeting: 'none', one_on_one: false });
    expect(
      parseAskPlutoPlan(draft, 'Draft a recap of my last 1:1 with Sam.'),
    ).toMatchObject({ meeting: 'last', one_on_one: true });
  });

  it('requires a reply for conversation and help routes', () => {
    expect(
      parseAskPlutoPlan(plan({ route: 'conversation', relation: 'expansion' })),
    ).toBeNull();
    expect(
      parseAskPlutoPlan(
        plan({
          route: 'conversation',
          relation: 'expansion',
          reply: 'I can also count meetings and read your calendar.',
        }),
      )?.reply,
    ).toContain('calendar');
  });
});

describe('applyAskPlutoPlan', () => {
  it('uses the standalone question for retrieval and answering', () => {
    const resolved = applyAskPlutoPlan(
      legacy,
      parseAskPlutoPlan(plan())!,
      true,
    );
    expect(resolved).toMatchObject({
      relation: 'follow_up',
      retrievalPolicy: 'fresh',
      retrievalQuery:
        'Who owns the next step of the fictional pilot migration?',
      priorQuestion: legacy.priorQuestion,
    });
  });

  it('maps drafts, expansions and conversation turns to their modes', () => {
    expect(
      applyAskPlutoPlan(
        legacy,
        parseAskPlutoPlan(plan({ task: 'draft' }))!,
        true,
      ).turnMode,
    ).toBe('draft');
    expect(
      applyAskPlutoPlan(
        legacy,
        parseAskPlutoPlan(plan({ relation: 'expansion' }))!,
        true,
      ),
    ).toMatchObject({ turnMode: 'expand', retrievalPolicy: 'reuse' });
    expect(
      applyAskPlutoPlan(
        legacy,
        parseAskPlutoPlan(plan({ route: 'conversation', reply: 'Hi.' }))!,
        true,
      ),
    ).toMatchObject({ turnMode: 'social', retrievalPolicy: 'none' });
  });

  it('reuses discussion evidence for a follow-up draft without a new meeting', () => {
    const draft = parseAskPlutoPlan(plan({ task: 'draft' }))!;
    expect(applyAskPlutoPlan(legacy, draft, true).retrievalPolicy).toBe(
      'reuse',
    );
    expect(
      applyAskPlutoPlan(legacy, { ...draft, meeting: 'last' }, true)
        .retrievalPolicy,
    ).toBe('fresh');
  });

  it('treats the first turn as a new topic whatever the model says', () => {
    expect(
      applyAskPlutoPlan(legacy, parseAskPlutoPlan(plan())!, false).relation,
    ).toBe('new_topic');
  });

  it('keeps specialised flows on the existing resolution', () => {
    const omission = { ...legacy, relation: 'omission_follow_up' as const };
    expect(applyAskPlutoPlan(omission, parseAskPlutoPlan(plan())!, true)).toBe(
      omission,
    );
    const revision = {
      ...legacy,
      answerQuery: 'Revise the previous draft and return it.',
    };
    expect(applyAskPlutoPlan(revision, parseAskPlutoPlan(plan())!, true)).toBe(
      revision,
    );
  });
});
