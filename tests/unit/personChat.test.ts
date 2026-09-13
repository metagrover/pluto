import { describe, expect, it } from 'vitest';
import type { PersistedMeeting, PersonBriefingDetail } from '../../electron/db';
import {
  buildPersonChatContext,
  buildPersonChatPrompt,
  isExplicitPersonChatWebRequest,
  routePersonChatIntent,
  shouldAutomaticallyResearchPersonChat,
} from '../../electron/intelligence/personChat';

const detail = {
  person: { id: 'maya', name: 'Maya' },
  meetings: [
    {
      id: 'confirmed',
      title: 'Weekly sync',
      started_at: '2026-09-10T10:00:00Z',
      created_at: '2026-09-10T10:00:00Z',
      duration_seconds: 1200,
      context: null,
      evidence: 'confirmed',
    },
    {
      id: 'mentioned',
      title: 'Planning',
      started_at: '2026-09-09T10:00:00Z',
      created_at: '2026-09-09T10:00:00Z',
      duration_seconds: 1200,
      context: 'Maya was mentioned as a possible reviewer.',
      evidence: 'mentioned',
    },
  ],
  commitments: { open: [], delivered: [], candidates: [] },
  isSelf: false,
  knowledgeDoc: null,
  workingMemorySnapshot: null,
  mergedPeople: [],
} as unknown as PersonBriefingDetail;

describe('person chat intelligence', () => {
  it('routes common conversational intents without a model call', () => {
    expect(routePersonChatIntent('Draft a warmer note')).toBe('draft');
    expect(routePersonChatIntent('Role-play how they might respond')).toBe(
      'role_play',
    );
    expect(routePersonChatIntent('What do I owe them?')).toBe('commitments');
    expect(isExplicitPersonChatWebRequest('Find sources online')).toBe(true);
    expect(
      shouldAutomaticallyResearchPersonChat('Recommend a feedback framework'),
    ).toBe(true);
  });

  it('only includes statements attributed to a bound speaker', () => {
    const meetings: Record<string, PersistedMeeting> = {
      confirmed: {
        id: 'confirmed',
        title: 'Weekly sync',
        enhanced_notes: 'The team reviewed the launch.',
        transcript_json: JSON.stringify({
          segments: [
            { speaker: 'Maya Voice', text: 'I will send the draft tomorrow.' },
            {
              speaker: 'Someone Else',
              text: 'Maya definitely dislikes this project.',
            },
          ],
        }),
      },
    };
    const context = buildPersonChatContext({
      detail,
      query: 'What did Maya say about the draft?',
      getMeeting: (id) => meetings[id],
      getBoundSpeakers: () => ['Maya Voice'],
    });

    expect(context.evidence).toContain('I will send the draft tomorrow.');
    expect(context.evidence).not.toContain('definitely dislikes');
    expect(context.evidence).toContain('Mention only');
  });

  it('keeps person evidence, general guidance, web, and history separated', () => {
    const context = buildPersonChatContext({
      detail,
      query: 'Help me prepare',
      getMeeting: () => undefined,
      getBoundSpeakers: () => [],
    });
    const prompt = buildPersonChatPrompt({
      query: 'Help me prepare',
      context,
      messages: [],
    });
    expect(prompt).toContain('PERSON EVIDENCE');
    expect(prompt).toContain('GENERAL GUIDANCE');
    expect(prompt).toContain('WEB CONTEXT');
    expect(prompt).toContain('CONVERSATION HISTORY');
    expect(prompt).toContain('never establish facts about Maya');
  });
});
