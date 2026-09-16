import type { ProjectCadence } from './projectPortfolio';

export type RhythmHealth =
  | 'in_rhythm'
  | 'due_soon'
  | 'slipping'
  | 'ad_hoc'
  | 'emerging'
  | 'none';

export interface DetectedProjectCadence {
  cadence: ProjectCadence | null;
  /** Human-readable rhythm name (e.g. "Weekly rhythm", "Bi-weekly cadence", "Ad-hoc / as needed", "Cadence emerging", "No regular schedule") */
  label: string;
  /** Grounded explanation of how this rhythm was determined */
  detail: string;
  /** Confidence level of the detection */
  confidence: 'strong' | 'moderate' | 'tentative' | 'none';
  /** Health status of the cadence */
  rhythmHealth: RhythmHealth;
  /** Short status label (e.g. "In rhythm", "Sync due soon", "Rhythm slipping", "Flexible", "Emerging", "No schedule") */
  rhythmStatusLabel: string;
  /** Days elapsed since the most recent meeting */
  daysSinceLastMeeting: number | null;
  /** Target interval in days for this cadence, if regular */
  expectedIntervalDays: number | null;
  /** Whether this reflects an explicit user preference */
  isOverridden?: boolean;
}

export function detectProjectCadence(options: {
  meetings?: Array<{
    started_at?: string | null;
    created_at?: string | null;
    title?: string;
  }>;
  recurringSeries?: Array<{
    cadence: string;
    meetingCount: number;
    title: string;
    lastMetAt?: string | null;
  }>;
  manualOverride?: ProjectCadence | null;
  now?: number;
}): DetectedProjectCadence {
  const {
    meetings = [],
    recurringSeries = [],
    manualOverride,
    now = Date.now(),
  } = options;

  // 1. Calculate timestamps and daysSinceLastMeeting
  const dates = meetings
    .map((m) => {
      const ts = m.started_at || m.created_at;
      if (!ts) return null;
      const parsed = Date.parse(ts);
      return Number.isNaN(parsed) ? null : parsed;
    })
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);

  const lastMeetingDate = dates.length > 0 ? dates[dates.length - 1] : null;
  const daysSinceLastMeeting =
    lastMeetingDate !== null
      ? Math.max(0, Math.floor((now - lastMeetingDate) / 86_400_000))
      : null;

  // Helper to evaluate rhythm health given expected interval in days
  const evaluateRhythmHealth = (
    expectedDays: number,
  ): { health: RhythmHealth; label: string } => {
    if (daysSinceLastMeeting === null) {
      return { health: 'none', label: 'No schedule' };
    }
    // Tolerance: within ~1.35x expected interval is in-rhythm
    const onTrackThreshold =
      expectedDays + Math.max(2, Math.round(expectedDays * 0.35));
    // Up to 2x expected interval is due soon
    const dueThreshold = expectedDays * 2;

    if (daysSinceLastMeeting <= onTrackThreshold) {
      return {
        health: 'in_rhythm',
        label:
          daysSinceLastMeeting <= 1
            ? 'In rhythm'
            : `In rhythm · Last met ${daysSinceLastMeeting}d ago`,
      };
    }
    if (daysSinceLastMeeting <= dueThreshold) {
      return {
        health: 'due_soon',
        label: `Sync due soon · Last met ${daysSinceLastMeeting}d ago`,
      };
    }
    const weeksOver = Math.max(2, Math.round(daysSinceLastMeeting / 7));
    return {
      health: 'slipping',
      label: `Rhythm slipping · ${weeksOver}w since sync`,
    };
  };

  // If manual override was supplied (e.g. from legacy metadata)
  if (manualOverride) {
    let expectedDays: number | null = null;
    let label = 'Custom cadence';
    if (manualOverride === 'weekly') {
      expectedDays = 7;
      label = 'Weekly rhythm';
    } else if (manualOverride === 'biweekly') {
      expectedDays = 14;
      label = 'Bi-weekly cadence';
    } else if (manualOverride === 'monthly') {
      expectedDays = 30;
      label = 'Monthly cadence';
    } else if (manualOverride === 'quarterly') {
      expectedDays = 90;
      label = 'Quarterly rhythm';
    } else if (manualOverride === 'adhoc') {
      label = 'Ad-hoc / as needed';
    }

    if (expectedDays !== null) {
      const healthInfo = evaluateRhythmHealth(expectedDays);
      return {
        cadence: manualOverride,
        label,
        detail: `Configured preference (${expectedDays}d target)`,
        confidence: 'strong',
        rhythmHealth: healthInfo.health,
        rhythmStatusLabel: healthInfo.label,
        daysSinceLastMeeting,
        expectedIntervalDays: expectedDays,
        isOverridden: true,
      };
    }
    return {
      cadence: manualOverride,
      label,
      detail: 'Configured ad-hoc schedule',
      confidence: 'strong',
      rhythmHealth: 'ad_hoc',
      rhythmStatusLabel:
        daysSinceLastMeeting !== null
          ? `Last met ${daysSinceLastMeeting}d ago`
          : 'Flexible',
      daysSinceLastMeeting,
      expectedIntervalDays: null,
      isOverridden: true,
    };
  }

  // 2. Automated detection
  // Signal A: Named recurring series
  if (recurringSeries.length > 0) {
    const topSeries = recurringSeries[0];
    const seriesCadence = topSeries.cadence?.toLocaleLowerCase() || '';

    let cadence: ProjectCadence = 'weekly';
    let expectedDays = 7;
    let label = 'Weekly rhythm';

    if (seriesCadence.includes('weekly') && !seriesCadence.includes('two')) {
      cadence = 'weekly';
      expectedDays = 7;
      label = 'Weekly rhythm';
    } else if (
      seriesCadence.includes('two') ||
      seriesCadence.includes('biweekly')
    ) {
      cadence = 'biweekly';
      expectedDays = 14;
      label = 'Bi-weekly cadence';
    } else if (seriesCadence.includes('monthly')) {
      cadence = 'monthly';
      expectedDays = 30;
      label = 'Monthly cadence';
    } else if (seriesCadence.includes('quarterly')) {
      cadence = 'quarterly';
      expectedDays = 90;
      label = 'Quarterly cadence';
    }

    const healthInfo = evaluateRhythmHealth(expectedDays);
    return {
      cadence,
      label,
      detail: `Detected from recurring “${topSeries.title}” (${topSeries.meetingCount} meetings)`,
      confidence: 'strong',
      rhythmHealth: healthInfo.health,
      rhythmStatusLabel: healthInfo.label,
      daysSinceLastMeeting,
      expectedIntervalDays: expectedDays,
      isOverridden: false,
    };
  }

  // Signal B: Consecutive meeting intervals
  if (dates.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const diff = (dates[i] - dates[i - 1]) / 86_400_000;
      if (diff >= 0 && Number.isFinite(diff)) {
        intervals.push(diff);
      }
    }

    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      const mid = Math.floor(intervals.length / 2);
      const medianInterval =
        intervals.length % 2 === 1
          ? intervals[mid]
          : Math.round((intervals[mid - 1] + intervals[mid]) / 2);

      let cadence: ProjectCadence = 'adhoc';
      let expectedDays: number | null = null;
      let label = 'Ad-hoc / as needed';
      let detail = `Meets as needed across ${dates.length} touchpoints`;

      if (medianInterval >= 5 && medianInterval <= 9) {
        cadence = 'weekly';
        expectedDays = 7;
        label = 'Weekly rhythm';
        detail = `Detected from meeting intervals (averages ~${Math.round(medianInterval)}d between sessions)`;
      } else if (medianInterval >= 10 && medianInterval <= 18) {
        cadence = 'biweekly';
        expectedDays = 14;
        label = 'Bi-weekly cadence';
        detail = `Detected from meeting intervals (averages ~${Math.round(medianInterval)}d between sessions)`;
      } else if (medianInterval >= 22 && medianInterval <= 40) {
        cadence = 'monthly';
        expectedDays = 30;
        label = 'Monthly cadence';
        detail = `Detected from meeting intervals (averages ~${Math.round(medianInterval)}d between sessions)`;
      } else if (medianInterval >= 60 && medianInterval <= 120) {
        cadence = 'quarterly';
        expectedDays = 90;
        label = 'Quarterly cadence';
        detail = `Detected from quarterly intervals (~${Math.round(medianInterval)}d between sessions)`;
      }

      if (expectedDays !== null) {
        const healthInfo = evaluateRhythmHealth(expectedDays);
        return {
          cadence,
          label,
          detail,
          confidence: dates.length >= 3 ? 'moderate' : 'tentative',
          rhythmHealth: healthInfo.health,
          rhythmStatusLabel: healthInfo.label,
          daysSinceLastMeeting,
          expectedIntervalDays: expectedDays,
          isOverridden: false,
        };
      }

      return {
        cadence: 'adhoc',
        label: 'Ad-hoc / as needed',
        detail,
        confidence: 'moderate',
        rhythmHealth: 'ad_hoc',
        rhythmStatusLabel:
          daysSinceLastMeeting !== null
            ? `Last met ${daysSinceLastMeeting}d ago`
            : 'Flexible',
        daysSinceLastMeeting,
        expectedIntervalDays: null,
        isOverridden: false,
      };
    }
  }

  // Signal C: Single meeting or 0 meetings
  if (dates.length === 1) {
    return {
      cadence: 'adhoc',
      label: 'No regular schedule',
      detail: 'Cadence emerging · single meeting recorded so far',
      confidence: 'none',
      rhythmHealth: 'emerging',
      rhythmStatusLabel:
        daysSinceLastMeeting !== null
          ? `First met ${daysSinceLastMeeting}d ago`
          : 'Cadence emerging',
      daysSinceLastMeeting,
      expectedIntervalDays: null,
      isOverridden: false,
    };
  }

  return {
    cadence: null,
    label: 'No regular schedule',
    detail: 'No meetings recorded yet',
    confidence: 'none',
    rhythmHealth: 'none',
    rhythmStatusLabel: 'No schedule',
    daysSinceLastMeeting: null,
    expectedIntervalDays: null,
    isOverridden: false,
  };
}
