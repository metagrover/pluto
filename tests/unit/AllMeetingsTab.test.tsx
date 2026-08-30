import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AllMeetingsTab } from '../../src/components/features/AllMeetingsTab';
import type { Meeting } from '../../src/types';

const meetings: Meeting[] = [
  {
    id: 'meeting-readable-list',
    title: 'Architecture review',
    meeting_type: 'Recording',
    created_at: '2026-08-29T17:00:00.000Z',
    started_at: '2026-08-29T17:00:00.000Z',
    duration_seconds: 3_780,
    finalization_status: 'finalized',
  },
];

describe('AllMeetingsTab', () => {
  it('exposes a clear reading hierarchy for meeting chronology', () => {
    const markup = renderToStaticMarkup(
      <AllMeetingsTab
        meetings={meetings}
        onOpenMeeting={() => {}}
        handleDeleteMeeting={() => {}}
      />,
    );

    expect(markup).toContain('data-meetings-index="true"');
    expect(markup).toContain('meetings-index__group-label');
    expect(markup).toContain('meetings-index__row-title');
    expect(markup).toContain('meetings-index__row-duration');
    expect(markup).toContain('meetings-index__row-time');
    expect(markup).toContain('Architecture review');
    expect(markup).toContain('1h 3m');
  });

  it('uses the same calm surface for the empty state', () => {
    const markup = renderToStaticMarkup(
      <AllMeetingsTab
        meetings={[]}
        onOpenMeeting={() => {}}
        handleDeleteMeeting={() => {}}
      />,
    );

    expect(markup).toContain('data-meetings-index="true"');
    expect(markup).toContain('meetings-index__empty');
    expect(markup).toContain('Your meetings will appear here');
  });
});
