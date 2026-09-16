import { describe, expect, it } from 'vitest';
import { detectProjectCadence } from '../../src/utils/projectCadence';

describe('detectProjectCadence', () => {
  it('detects weekly rhythm from recurring series', () => {
    const result = detectProjectCadence({
      meetings: [
        { started_at: '2026-09-01T10:00:00Z', title: 'Sprint sync' },
        { started_at: '2026-09-08T10:00:00Z', title: 'Sprint sync' },
        { started_at: '2026-09-15T10:00:00Z', title: 'Sprint sync' },
      ],
      recurringSeries: [
        {
          title: 'Sprint sync',
          cadence: 'Weekly pattern',
          meetingCount: 3,
        },
      ],
      now: Date.parse('2026-09-17T10:00:00Z'),
    });

    expect(result.cadence).toBe('weekly');
    expect(result.label).toBe('Weekly rhythm');
    expect(result.confidence).toBe('strong');
    expect(result.detail).toContain('Sprint sync');
    expect(result.rhythmHealth).toBe('in_rhythm');
    expect(result.rhythmStatusLabel).toContain('In rhythm');
  });

  it('detects biweekly cadence from recurring series', () => {
    const result = detectProjectCadence({
      recurringSeries: [
        {
          title: 'Architecture forum',
          cadence: 'Every two weeks',
          meetingCount: 4,
        },
      ],
      meetings: [{ started_at: '2026-09-01T10:00:00Z' }],
      now: Date.parse('2026-09-10T10:00:00Z'),
    });

    expect(result.cadence).toBe('biweekly');
    expect(result.label).toBe('Bi-weekly cadence');
    expect(result.rhythmHealth).toBe('in_rhythm');
  });

  it('detects weekly cadence from meeting intervals when titles differ', () => {
    const result = detectProjectCadence({
      meetings: [
        { started_at: '2026-08-01T10:00:00Z', title: 'Kickoff' },
        { started_at: '2026-08-08T10:00:00Z', title: 'Deep dive' },
        { started_at: '2026-08-15T10:00:00Z', title: 'Customer review' },
        { started_at: '2026-08-22T10:00:00Z', title: 'Follow-up' },
      ],
      now: Date.parse('2026-08-25T10:00:00Z'),
    });

    expect(result.cadence).toBe('weekly');
    expect(result.label).toBe('Weekly rhythm');
    expect(result.rhythmHealth).toBe('in_rhythm');
    expect(result.detail).toContain('Detected from meeting intervals');
  });

  it('detects rhythm slipping when meetings are past expected cadence', () => {
    const result = detectProjectCadence({
      meetings: [
        { started_at: '2026-08-01T10:00:00Z', title: 'Weekly sync' },
        { started_at: '2026-08-08T10:00:00Z', title: 'Weekly sync' },
      ],
      recurringSeries: [
        {
          title: 'Weekly sync',
          cadence: 'Weekly pattern',
          meetingCount: 2,
        },
      ],
      // 30 days later
      now: Date.parse('2026-09-07T10:00:00Z'),
    });

    expect(result.rhythmHealth).toBe('slipping');
    expect(result.rhythmStatusLabel).toContain('Rhythm slipping');
  });

  it('detects emerging cadence for a single meeting', () => {
    const result = detectProjectCadence({
      meetings: [{ started_at: '2026-09-01T10:00:00Z' }],
      now: Date.parse('2026-09-05T10:00:00Z'),
    });

    expect(result.label).toBe('No regular schedule');
    expect(result.detail).toContain('Cadence emerging');
    expect(result.rhythmHealth).toBe('emerging');
  });

  it('returns honest empty state when there are no meetings', () => {
    const result = detectProjectCadence({
      meetings: [],
    });

    expect(result.cadence).toBeNull();
    expect(result.label).toBe('No regular schedule');
    expect(result.detail).toBe('No meetings recorded yet');
    expect(result.rhythmHealth).toBe('none');
  });

  it('honors manual override if supplied', () => {
    const result = detectProjectCadence({
      meetings: [{ started_at: '2026-09-01T10:00:00Z' }],
      manualOverride: 'monthly',
      now: Date.parse('2026-09-10T10:00:00Z'),
    });

    expect(result.cadence).toBe('monthly');
    expect(result.isOverridden).toBe(true);
    expect(result.label).toBe('Monthly cadence');
    expect(result.rhythmHealth).toBe('in_rhythm');
  });
});
