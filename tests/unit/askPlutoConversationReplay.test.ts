import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-ask-replay-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import { getTemporalMeetings, saveMeeting } from '../../electron/db';
import {
  describePreviousConversationFailure,
  inheritConversationScope,
  isDiagnosticConversationFollowUp,
} from '../../electron/intelligence/askPlutoConversation';
import { parseQuery } from '../../electron/intelligence/queryEngine';
import type { AskPlutoConversationTurn } from '../../src/types/askPlutoQuery';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('Ask Pluto reported conversation replay', () => {
  it('keeps both today requests and the diagnostic follow-up out of old meetings', async () => {
    const now = new Date(2026, 7, 25, 17, 36);
    for (let index = 0; index < 20; index += 1) {
      saveMeeting({
        id: `today-${index}`,
        title: `Today ${index + 1}`,
        started_at: new Date(2026, 7, 25, 8, index).toISOString(),
        transcript_json: JSON.stringify({
          segments: [{ text: `Supported discussion ${index + 1}` }],
        }),
      });
    }
    for (const [id, title] of [
      ['old-architecture', 'Architecture Docs Review'],
      ['old-client', 'National Client - Initial Feedback'],
    ]) {
      saveMeeting({
        id,
        title,
        started_at: new Date(2026, 7, 6, 9).toISOString(),
        transcript_json: JSON.stringify({
          segments: [{ text: 'What went wrong here today?' }],
        }),
      });
    }

    const first = await parseQuery("Summarize today's meetings", {
      useModelClassification: false,
      now,
    });
    const second = await parseQuery("Analyze today's meetings, please", {
      useModelClassification: false,
      now,
    });
    for (const parsed of [first, second]) {
      const selected = getTemporalMeetings({
        from: parsed.temporal_range?.from,
        to: parsed.temporal_range?.to,
      });
      expect(selected).toHaveLength(20);
      expect(selected.every((meeting) => meeting.id.startsWith('today-'))).toBe(
        true,
      );
    }

    const priorTurns: AskPlutoConversationTurn[] = [
      { role: 'user', content: "Analyze today's meetings, please" },
      {
        role: 'assistant',
        content: 'A supported daily analysis.',
        outcome: 'answered',
        resolvedScope: {
          kind: 'temporal',
          meetingIds: Array.from(
            { length: 20 },
            (_, index) => `today-${index}`,
          ),
          temporalRange: {
            fromInclusive: second.temporal_range?.from || '',
            toExclusive: second.temporal_range?.to || '',
            label: 'today',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          resolvedAt: now.toISOString(),
          source: 'explicit',
        },
        retrievalSummary: {
          matchedMeetingCount: 20,
          includedMeetingCount: 20,
          preparedEvidenceCount: 0,
          transcriptOnlyCount: 20,
          omittedMeetingCount: 0,
        },
      },
    ];

    expect(isDiagnosticConversationFollowUp('What went wrong here?')).toBe(
      true,
    );
    expect(
      inheritConversationScope('What went wrong here?', priorTurns)?.meetingIds,
    ).toHaveLength(20);
    const explanation = describePreviousConversationFailure(priorTurns[1]);
    expect(explanation).not.toContain('Architecture Docs');
    expect(explanation).not.toContain('National Client');
  });
});
