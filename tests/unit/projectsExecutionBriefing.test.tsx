import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/api/knowledgeGraph';
import {
  buildProjectsBriefing,
  sortExecutionTasksForDisplay,
} from '../../src/components/KnowledgeGraph/ProjectsExecutionTab';

const task = (
  id: string,
  status: Entity['status'],
  dueDate: string | null = null,
): Entity => ({
  id,
  type: 'action_item',
  name: id,
  normalized_name: id,
  status,
  due_date: dueDate,
  assigned_to: null,
  metadata: null,
  saliency_score: 0,
  domain_tag: 'work',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
});

describe('buildProjectsBriefing', () => {
  it('separates active attention from completed history', () => {
    const result = buildProjectsBriefing(
      [
        task('overdue', 'active', '2026-07-01T00:00:00.000Z'),
        task('done', 'completed'),
      ],
      new Date('2026-07-14T00:00:00.000Z').getTime(),
    );

    expect(result.active.map((item) => item.id)).toEqual(['overdue']);
    expect(result.overdue.map((item) => item.id)).toEqual(['overdue']);
    expect(result.completed.map((item) => item.id)).toEqual(['done']);
  });

  it('does not call a project on track when it has no active work', () => {
    const result = buildProjectsBriefing([task('done', 'completed')]);
    expect(result.health).toBe('complete');
  });
});

describe('sortExecutionTasksForDisplay', () => {
  it('prioritizes overdue work ahead of routine active items', () => {
    const result = sortExecutionTasksForDisplay([
      task('active-newer', 'active'),
      task('overdue-older', 'overdue'),
      task('active-older', 'active'),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      'overdue-older',
      'active-newer',
      'active-older',
    ]);
  });
});
