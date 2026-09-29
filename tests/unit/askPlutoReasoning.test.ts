import { describe, expect, it } from 'vitest';

import {
  getCrossMeetingCandidateLimit,
  queryReferencesPriorTurn,
  resolveAskPlutoReasoningMode,
  shouldIncludePriorConversation,
  shouldRestrictToCurrentMeetingEvidence,
  shouldRestrictToPinnedCurrentComparison,
  shouldRestrictToPriorConversationEvidence,
} from '../../electron/intelligence/askPlutoReasoning';

describe('resolveAskPlutoReasoningMode', () => {
  it('keeps straightforward retrieval on the fast path', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Who owns the migration checklist?',
        intent: 'factual',
      }),
    ).toBe('fast');
  });

  it('uses deep reasoning for comparisons, change, conflict, risk, and advice', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Compare the current meeting with the last one',
        intent: 'comparative',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'What changed and what risks should I consider?',
        intent: 'factual',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Could I have handled these meetings better?',
        intent: 'factual',
        task: 'analysis',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Draft a follow-up email.',
        intent: 'factual',
        task: 'draft',
      }),
    ).toBe('fast');
  });

  it('keeps detail retrieval fast without downgrading new analysis', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Tell me more about the Project Atlas pipeline.',
        intent: 'factual',
        task: 'analysis',
        relation: 'expansion',
      }),
    ).toBe('fast');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Give me feedback on how I handled this.',
        intent: 'factual',
        task: 'analysis',
        relation: 'new_topic',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'What do you think I should focus on?',
        intent: 'factual',
        task: 'analysis',
        relation: 'new_topic',
      }),
    ).toBe('fast');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'What do you think will satisfy Alpha Contact?',
        intent: 'factual',
        task: 'analysis',
        relation: 'new_topic',
      }),
    ).toBe('fast');
  });

  it('uses deep synthesis for multi-meeting summaries and breakdowns', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Show me a breakdown of my recent meetings',
        intent: 'factual',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: "Summarize today's meetings",
        intent: 'temporal',
      }),
    ).toBe('deep');
  });

  it('honors an explicit user override', () => {
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Who owns this?',
        intent: 'factual',
        override: 'deep',
      }),
    ).toBe('deep');
    expect(
      resolveAskPlutoReasoningMode({
        query: 'Compare these meetings',
        intent: 'comparative',
        override: 'fast',
      }),
    ).toBe('fast');
  });

  it('recognizes follow-up references that need prior cited meetings', () => {
    expect(queryReferencesPriorTurn('Why did you suggest it?')).toBe(true);
    expect(
      queryReferencesPriorTurn('Compare that with the current meeting'),
    ).toBe(true);
    expect(
      queryReferencesPriorTurn('What did Riley decide about pricing?'),
    ).toBe(false);
  });

  it('keeps history for follow-ups but excludes it from a new explicit scope', () => {
    expect(
      shouldIncludePriorConversation(
        "What action items came out of Friday's Live Transcript Diagnosis?",
        true,
      ),
    ).toBe(false);
    expect(shouldIncludePriorConversation('Why did that happen?', true)).toBe(
      true,
    );
    expect(shouldIncludePriorConversation('Who owns pricing?', false)).toBe(
      true,
    );
    expect(
      shouldIncludePriorConversation('Who owns pricing?', false, 'new_topic'),
    ).toBe(false);
    expect(
      shouldIncludePriorConversation('Tell me more', false, 'expansion'),
    ).toBe(true);
    expect(
      shouldIncludePriorConversation('Tell me more', true, 'expansion'),
    ).toBe(true);
  });

  it('selects bounded historical anchors for current-meeting comparisons', () => {
    expect(
      getCrossMeetingCandidateLimit(
        'Compare the current meeting with the last one',
        'comparative',
      ),
    ).toBe(1);
    expect(
      getCrossMeetingCandidateLimit(
        'What patterns changed across meetings?',
        'comparative',
      ),
    ).toBe(3);
    expect(getCrossMeetingCandidateLimit('What was decided?', 'factual')).toBe(
      0,
    );
  });

  it('keeps a direct current-meeting lookup scoped to that meeting', () => {
    expect(
      shouldRestrictToCurrentMeetingEvidence({
        currentMeetingRequested: true,
        historicalCandidateLimit: 0,
        priorPinnedCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldRestrictToCurrentMeetingEvidence({
        currentMeetingRequested: true,
        historicalCandidateLimit: 1,
        priorPinnedCount: 0,
      }),
    ).toBe(false);
  });

  it('keeps a factual follow-up scoped to its cited meetings', () => {
    expect(
      shouldRestrictToPriorConversationEvidence({
        currentMeetingRequested: false,
        intent: 'factual',
        priorPinnedCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldRestrictToPriorConversationEvidence({
        currentMeetingRequested: false,
        intent: 'comparative',
        priorPinnedCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldRestrictToPriorConversationEvidence({
        currentMeetingRequested: false,
        intent: 'factual',
        priorPinnedCount: 1,
        task: 'analysis',
      }),
    ).toBe(false);
    expect(
      shouldRestrictToPriorConversationEvidence({
        currentMeetingRequested: false,
        intent: 'factual',
        priorPinnedCount: 1,
        task: 'analysis',
        relation: 'follow_up',
      }),
    ).toBe(true);
    expect(
      shouldRestrictToPriorConversationEvidence({
        currentMeetingRequested: false,
        intent: 'factual',
        priorPinnedCount: 1,
        task: 'analysis',
        retrievalPolicy: 'reuse',
      }),
    ).toBe(true);
    expect(
      shouldRestrictToPriorConversationEvidence({
        currentMeetingRequested: false,
        intent: 'factual',
        priorPinnedCount: 1,
        retrievalPolicy: 'fresh',
      }),
    ).toBe(false);
    expect(
      shouldRestrictToPriorConversationEvidence({
        currentMeetingRequested: false,
        intent: 'factual',
        priorPinnedCount: 1,
        task: 'draft',
      }),
    ).toBe(true);
  });

  it('uses only the frozen pair for current-versus-previous comparisons', () => {
    expect(
      shouldRestrictToPinnedCurrentComparison({
        currentMeetingRequested: true,
        historicalCandidateLimit: 1,
      }),
    ).toBe(true);
    expect(
      shouldRestrictToPinnedCurrentComparison({
        currentMeetingRequested: true,
        historicalCandidateLimit: 3,
      }),
    ).toBe(false);
  });
});
