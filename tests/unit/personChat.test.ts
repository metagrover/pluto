import { describe, expect, it } from 'vitest';
import type { PersistedMeeting, PersonBriefingDetail } from '../../electron/db';
import {
  buildPersonChatContext,
  buildPersonChatPrompt,
  getPersonChatQuickReply,
  routePersonChatIntent,
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
  });

  it('answers brief polite closures without retrieving evidence or calling a model', () => {
    expect(getPersonChatQuickReply('nice, thank you')).toBe("You're welcome.");
    expect(getPersonChatQuickReply('Thanks, Pluto!')).toBe("You're welcome.");
    expect(getPersonChatQuickReply('Thank you, what should I send next?')).toBe(
      null,
    );
  });

  it('responds to praise using the prior answer rather than starting a search', () => {
    expect(
      getPersonChatQuickReply(
        'That is a great insight.',
        'The useful move is to make the next request concrete.',
      ),
    ).toContain('make the next request concrete');
  });

  it('only includes synthesized meeting notes, not raw transcript segments', () => {
    // Person chat uses only enhanced_notes/user_notes — raw transcript_json is never read.
    const meetings: Record<string, PersistedMeeting> = {
      confirmed: {
        id: 'confirmed',
        title: 'Weekly sync',
        enhanced_notes:
          'The team reviewed the launch. Maya will send the draft tomorrow.',
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
    });

    // Should surface synthesized notes, not raw transcript speaker lines
    expect(context.evidence).toContain('Maya will send the draft tomorrow.');
    // Should NOT surface raw transcript speaker quotes
    expect(context.evidence).not.toContain(
      'I will send the draft tomorrow.\nSomeone Else',
    );
    // Unconfirmed meeting entry should still say Mention only
    expect(context.evidence).toContain('Mention only');
  });

  it('keeps person evidence, general guidance, and history separated', () => {
    const context = buildPersonChatContext({
      detail,
      query: 'Help me prepare',
      getMeeting: () => undefined,
    });
    const prompt = buildPersonChatPrompt({
      query: 'Help me prepare',
      context,
      messages: [],
    });
    expect(prompt).toContain('PERSON EVIDENCE');
    expect(prompt).toContain('GENERAL GUIDANCE');
    expect(prompt).toContain('CONVERSATION HISTORY');
    expect(prompt).toContain('never establish facts about Maya');
  });

  it('keeps one useful clarification before returning a copy-ready draft', () => {
    const context = buildPersonChatContext({
      detail,
      query: 'Draft a message to Maya',
      getMeeting: () => undefined,
    });
    const prompt = buildPersonChatPrompt({
      query: 'Draft a message to Maya',
      context,
      messages: [],
    });

    expect(prompt).toContain('ask one concise clarifying question');
    expect(prompt).toContain('one copy-ready version first');
    expect(prompt).toContain('Keep it under 90 words');
    expect(prompt).toContain('never add one by habit');
    expect(prompt).not.toContain('Prefer 2-4 short paragraphs');
  });
});
