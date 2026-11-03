import { describe, expect, it } from 'vitest';

import {
  buildAttentionAnswer,
  isAttentionQuestion,
} from '../../electron/intelligence/askPlutoAttention';

const now = new Date(2026, 10, 2, 21, 0);

describe('attention questions', () => {
  it('recognizes overdue and slipping questions only', () => {
    expect(isAttentionQuestion("What's overdue or slipping right now?")).toBe(
      true,
    );
    expect(isAttentionQuestion('What is due this week?')).toBe(true);
    expect(isAttentionQuestion('What did Vrinda say about pricing?')).toBe(
      false,
    );
  });

  it('groups overdue, upcoming, others and long-open work from task records', () => {
    const { answer, cited } = buildAttentionAnswer({
      now,
      mine: [
        {
          id: 't1',
          title: 'Send pilot report',
          dueDate: '2026-10-28',
          createdAt: '2026-10-01T00:00:00Z',
          sourceMeetingTitle: 'Adam: 1-1',
        },
        {
          id: 't2',
          title: 'Review dashboard',
          dueDate: '2026-11-05',
          createdAt: '2026-10-30T00:00:00Z',
        },
        {
          id: 't3',
          title: 'Draft roadmap',
          dueDate: null,
          createdAt: '2026-09-20T00:00:00Z',
        },
        {
          id: 't4',
          title: 'Fresh idea',
          dueDate: null,
          createdAt: '2026-11-01T00:00:00Z',
        },
        {
          id: 't5',
          title: 'Later item',
          dueDate: '2026-12-20',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      others: [
        {
          id: 'o1',
          title: 'Share data export',
          dueDate: '2026-10-20',
          createdAt: null,
          owner: 'Ayush',
        },
        {
          id: 'o2',
          title: 'Not yet due',
          dueDate: '2026-11-20',
          createdAt: null,
          owner: 'Adam',
        },
      ],
    });
    expect(answer).toContain(
      '**Your overdue tasks**\n- Send pilot report (was due Oct 28) · from “Adam: 1-1”',
    );
    expect(answer).toContain(
      '**Due in the next 7 days**\n- Review dashboard (due Nov 5)',
    );
    expect(answer).toContain(
      "**Others' overdue commitments**\n- Share data export — Ayush (was due Oct 20)",
    );
    expect(answer).toContain('- Draft roadmap (open 43 days)');
    expect(answer).not.toContain('Fresh idea');
    expect(answer).not.toContain('Later item');
    expect(answer).not.toContain('Not yet due');
    expect(cited.map((item) => item.id)).toEqual(['t1', 't2', 'o1', 't3']);
  });

  it('says plainly when nothing needs attention', () => {
    expect(
      buildAttentionAnswer({ now, mine: [], others: [] }).answer,
    ).toContain('Nothing is overdue');
  });
});
