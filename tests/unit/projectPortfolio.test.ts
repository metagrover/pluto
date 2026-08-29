import { describe, expect, it } from 'vitest';
import {
  type ProjectPortfolioEntry,
  buildProjectPortfolio,
} from '../../src/utils/projectPortfolio';
const entry = (
  id: string,
  state?: string,
  date = '2026-08-28',
): ProjectPortfolioEntry => ({
  id,
  name: id,
  type: 'project',
  status: null,
  normalized_name: id,
  metadata: state
    ? JSON.stringify({
        projectQualification: {
          version: 1,
          state,
          source: 'user',
          reason: 'Confirmed',
          assessedAt: '2026-08-28',
        },
        context: 'Existing context',
      })
    : null,
  created_at: date,
  updated_at: date,
  due_date: null,
  assigned_to: null,
  saliency_score: 1,
  domain_tag: 'work',
  meeting_count: 1,
  last_mentioned_at: date,
  latest_context: 'Discussed work',
});
describe('project portfolio', () => {
  it('never promotes legacy names or repetition alone', () => {
    const legacy = { ...entry('Routine configuration'), meeting_count: 100 };
    expect(buildProjectPortfolio([legacy]).current).toEqual([]);
    expect(buildProjectPortfolio([legacy]).other).toHaveLength(1);
  });
  it('keeps qualified projects with no tasks and does not infer completion', () => {
    expect(
      buildProjectPortfolio([entry('Aurora', 'qualified')]).current,
    ).toHaveLength(1);
  });
  it('sorts real activity and separates explicit project completion', () => {
    const rows = [
      entry('Older', 'qualified', '2026-08-01'),
      { ...entry('Finished', 'qualified'), status: 'completed' as const },
      entry('Recent', 'qualified'),
    ];
    expect(buildProjectPortfolio(rows).current.map((p) => p.id)).toEqual([
      'Recent',
      'Older',
    ]);
    expect(buildProjectPortfolio(rows).completed.map((p) => p.id)).toEqual([
      'Finished',
    ]);
  });
  it('searches retained unqualified entries without promoting them', () => {
    const result = buildProjectPortfolio(
      [
        entry('Aurora', 'qualified'),
        entry('Routine configuration', 'subordinate'),
      ],
      'configuration',
    );
    expect(result.current).toEqual([]);
    expect(result.other.map((p) => p.id)).toEqual(['Routine configuration']);
  });
});
