import { describe, expect, it } from 'vitest';

import { createLiveMeetingContextIndex } from '../../electron/intelligence/liveMeetingContextIndex';
import { routeMeetingAskPlutoAssistance } from '../../electron/intelligence/meetingAskPlutoAssistance';
import { resolveMeetingAskPlutoConversation } from '../../electron/intelligence/meetingAskPlutoConversation';
import type { MeetingAskPlutoTurn } from '../../src/types/askPluto';

const exchange = (
  question: string,
  answer: string,
  evidenceHints: string[] = [],
): MeetingAskPlutoTurn[] => [
  { role: 'user', content: question },
  { role: 'assistant', content: answer, evidenceHints },
];

describe('meeting Ask Pluto conversational context', () => {
  it('rewrites a referential follow-up with grounded prior context', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'What should I do about that?',
      turns: exchange(
        'What is the main risk?',
        'Chris has not confirmed the case-study timeline.',
        ['Chris said the case-study timeline still needs confirmation.'],
      ),
    });

    expect(resolution.relation).toBe('follow_up');
    expect(resolution.retrievalQuery).toContain(
      'Current follow-up: What should I do about that?',
    );
    expect(resolution.retrievalQuery).toContain(
      'Prior user topic: What is the main risk?',
    );
    expect(resolution.retrievalQuery).toContain(
      'Previously cited meeting evidence: Chris said',
    );
    expect(resolution.priorEvidenceHintCount).toBe(1);
  });

  it('keeps a self-contained question independent from the prior answer', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'What did Riley say about pricing?',
      turns: exchange(
        'What is the main launch risk?',
        'The case-study timeline is uncertain.',
      ),
    });

    expect(resolution).toMatchObject({
      relation: 'new_topic',
      retrievalQuery: 'What did Riley say about pricing?',
      routingQuery: 'What did Riley say about pricing?',
      priorEvidenceHintCount: 0,
    });
  });

  it('honors an explicit topic switch even when it contains a reference', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'New question: what did they decide about pricing?',
      turns: exchange('How am I doing?', 'You could ask shorter questions.'),
    });

    expect(resolution.relation).toBe('new_topic');
  });

  it.each([
    'What about pricing?',
    'Summarize this meeting',
    'What was confusing in this exchange?',
  ])('treats a self-contained meeting question as a new topic: %s', (query) => {
    const resolution = resolveMeetingAskPlutoConversation({
      query,
      turns: exchange(
        'What is the main launch risk?',
        'The case-study timeline is uncertain.',
      ),
    });

    expect(resolution.relation).toBe('new_topic');
    expect(resolution.retrievalQuery).toBe(query);
  });

  it('marks a vague reference to a multi-point answer as ambiguous', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'Can you explain that?',
      turns: exchange(
        'What are the risks?',
        '- The timeline is unconfirmed.\n- Pricing is still unresolved.',
      ),
    });

    expect(resolution.relation).toBe('ambiguous');
  });

  it('resolves a numbered reference without marking it ambiguous', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'Explain the second point.',
      turns: exchange(
        'What are the risks?',
        '1. The timeline is unconfirmed.\n2. Pricing is unresolved.',
      ),
    });

    expect(resolution.relation).toBe('follow_up');
  });

  it('preserves coaching intent across a short follow-up', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'How can I improve that?',
      turns: exchange(
        'What could I do better in this conversation?',
        'Your questions sometimes combine several topics.',
      ),
    });

    expect(routeMeetingAskPlutoAssistance(resolution.routingQuery)).toEqual({
      mode: 'coaching',
    });
  });

  it('uses the prior grounded subject to retrieve live evidence', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest('meeting-1', [
      {
        id: 'timeline',
        speaker: 'Call audio',
        text: 'Chris has not confirmed the case-study timeline.',
        timestampMs: 1_000,
        confirmed: true,
      },
      {
        id: 'pricing',
        speaker: 'Call audio',
        text: 'Pricing will be reviewed next week.',
        timestampMs: 2_000,
        confirmed: true,
      },
    ]);
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'What should I do about that?',
      turns: exchange(
        'What is the main risk?',
        'Chris has not confirmed the case-study timeline.',
        ['Chris has not confirmed the case-study timeline.'],
      ),
    });

    expect(
      index
        .select('meeting-1', resolution.retrievalQuery, 2)
        .segments.map(({ id }) => id),
    ).toContain('timeline');
  });

  it('fails open when there is no completed assistant exchange', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'Why did you say that?',
      turns: [{ role: 'user', content: 'What is the risk?' }],
    });

    expect(resolution.relation).toBe('new_topic');
    expect(resolution.retrievalQuery).toBe('Why did you say that?');
  });

  it('does not anchor to an older answer after an interrupted question', () => {
    const resolution = resolveMeetingAskPlutoConversation({
      query: 'Why did you say that?',
      turns: [
        ...exchange('What is the main risk?', 'The timeline is uncertain.'),
        { role: 'user', content: 'What should I do next?' },
      ],
    });

    expect(resolution.relation).toBe('new_topic');
  });

  it('recognizes pronoun and participant role follow-ups across domains', () => {
    // Sales domain: pronoun follow-up
    const salesFollowUp = resolveMeetingAskPlutoConversation({
      query: 'What is she concerned about?',
      turns: exchange(
        'What did the prospect say about pricing?',
        'Sarah indicated budget approval is pending for Q4.',
        ['Sarah said budget approval is pending for Q4.'],
      ),
    });
    expect(salesFollowUp.relation).toBe('follow_up');
    expect(salesFollowUp.retrievalQuery).toContain(
      'Current follow-up: What is she concerned about?',
    );
    expect(salesFollowUp.retrievalQuery).toContain(
      'Prior user topic: What did the prospect say about pricing?',
    );

    // Recruiting domain: pronoun follow-up
    const candidateFollowUp = resolveMeetingAskPlutoConversation({
      query: 'What is he looking for?',
      turns: exchange(
        'How did the candidate interview go?',
        'Alex prefers remote work and wants to lead frontend architecture.',
      ),
    });
    expect(candidateFollowUp.relation).toBe('follow_up');

    // Generic meeting role follow-up
    const participantFollowUp = resolveMeetingAskPlutoConversation({
      query: 'What did the participant suggest?',
      turns: exchange(
        'Were there any blockers discussed?',
        'Yes, bandwidth constraints were raised on the roadmap.',
      ),
    });
    expect(participantFollowUp.relation).toBe('follow_up');
  });
});
