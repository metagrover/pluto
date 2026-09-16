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
  it('quarantines legacy one-meeting auto-discoveries as suggestions', () => {
    const legacy = {
      ...entry('Generated guess', 'qualified'),
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'review',
          reason: 'Generated from one meeting',
          assessedAt: '2026-08-28',
        },
        projectInitiativeDiscovery: { version: 12, sourceMeetingId: 'm1' },
      }),
      meeting_count: 1,
    };
    const result = buildProjectPortfolio([legacy]);
    expect(result.current).toEqual([]);
    expect(result.suggested.map((project) => project.id)).toEqual([
      'Generated guess',
    ]);
  });
  it('keeps cross-conversation synthesized themes in the main portfolio', () => {
    const theme = {
      ...entry('Durable theme', 'qualified'),
      meeting_count: 3,
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'review',
          reason: 'Supported across conversations',
          assessedAt: '2026-08-28',
        },
        projectThemeSynthesis: { version: 1, sourceMeetingIds: ['m1', 'm2'] },
      }),
    };
    expect(buildProjectPortfolio([theme]).current).toHaveLength(1);
  });
  it('keeps dismissed suggestions out of the active review surface', () => {
    const dismissed = {
      ...entry('Dismissed guess', 'subordinate'),
      metadata: JSON.stringify({
        projectPortfolioDisposition: 'dismissed',
        projectQualification: {
          version: 1,
          state: 'subordinate',
          source: 'user',
          reason: 'Dismissed by the user',
          assessedAt: '2026-08-28',
        },
      }),
    };
    const result = buildProjectPortfolio([dismissed]);
    expect(result.current).toEqual([]);
    expect(result.suggested).toEqual([]);
    expect(result.other).toEqual([]);
    expect(result.dismissed).toHaveLength(1);
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

  it('partitions active from dormant initiatives based on 30-day inactivity threshold', () => {
    const baseDate = Date.parse('2026-09-15T12:00:00Z');
    const recentInitiative = entry('Active Project', 'qualified', '2026-09-10'); // 5 days ago
    const olderInitiative = entry('Dormant Project', 'qualified', '2026-07-15'); // ~62 days ago
    const moderateInitiative = entry('Aging Project', 'qualified', '2026-08-05'); // 41 days ago
    const baseStarred = entry('Starred Old', 'qualified', '2026-06-01');
    const starredOld = {
      ...baseStarred,
      metadata: JSON.stringify({
        ...JSON.parse(baseStarred.metadata!),
        projectStarred: true,
      }),
    };

    const result = buildProjectPortfolio(
      [recentInitiative, olderInitiative, moderateInitiative, starredOld],
      '',
      baseDate,
    );

    // Starred stays in starred
    expect(result.starred.map((p) => p.id)).toEqual(['Starred Old']);

    // Unstarred active (<= 30d)
    expect(result.activeSide.map((p) => p.id)).toEqual(['Active Project']);
    expect(result.activeSide[0].activity_state).toBe('active');
    expect(result.activeSide[0].activity_label).toBe('Active 5d ago');

    // Unstarred dormant (> 30d)
    expect(result.dormant.map((p) => p.id)).toEqual([
      'Aging Project',
      'Dormant Project',
    ]);
    expect(result.dormant[0].activity_state).toBe('dormant');
    expect(result.dormant[0].activity_label).toContain('Inactive for');
    expect(result.dormant[1].activity_state).toBe('stale');
    expect(result.dormant[1].activity_label).toContain('Dormant · 2 months ago');
  });

  it('adjusts dormancy thresholds based on configured project cadence', () => {
    const baseDate = Date.parse('2026-09-15T12:00:00Z');
    // 45 days ago: dormant by default (30d threshold), but active if cadence is 'monthly' (60d threshold)
    const monthlyEntry = entry('Monthly Project', 'qualified', '2026-08-01');
    monthlyEntry.metadata = JSON.stringify({
      ...JSON.parse(monthlyEntry.metadata!),
      projectCadence: 'monthly',
    });

    // 20 days ago: active by default (30d threshold), but dormant if cadence is 'weekly' (14d threshold)
    const weeklyEntry = entry('Weekly Project', 'qualified', '2026-08-26');
    weeklyEntry.metadata = JSON.stringify({
      ...JSON.parse(weeklyEntry.metadata!),
      projectCadence: 'weekly',
    });

    // 80 days ago: dormant/stale by default, but active if cadence is 'quarterly' (120d threshold)
    const quarterlyEntry = entry('Quarterly Project', 'qualified', '2026-06-27');
    quarterlyEntry.metadata = JSON.stringify({
      ...JSON.parse(quarterlyEntry.metadata!),
      projectCadence: 'quarterly',
    });

    const result = buildProjectPortfolio(
      [monthlyEntry, weeklyEntry, quarterlyEntry],
      '',
      baseDate,
    );

    // Monthly Project and Quarterly Project remain in activeSide because of their cadences
    expect(result.activeSide.map((p) => p.id)).toContain('Monthly Project');
    expect(result.activeSide.map((p) => p.id)).toContain('Quarterly Project');

    // Weekly Project is dormant because 20 days > 14 days
    expect(result.dormant.map((p) => p.id)).toContain('Weekly Project');
  });
});
