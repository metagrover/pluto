import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  TranscriptIntegrityPanel,
  canGenerateMeetingIntelligence,
} from '../../src/components/features/MeetingView';
import { Sidebar } from '../../src/components/layout/Sidebar';
import { canDeleteMeeting } from '../../src/utils/recordingFinalization';

describe('MeetingView transcript integrity', () => {
  it('keeps the standard analysis page primary when analysis already exists', () => {
    const markup = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        integrityJson={JSON.stringify({
          schemaVersion: 2,
          state: 'needs_attention',
          causes: [{ code: 'recovered_awaiting_validation' }],
          evidenceProvenance: { kind: 'stored_capture_activity_v1' },
        })}
        transcriptJson={JSON.stringify({
          lifecycleStatus: 'needs_attention',
          segments: [],
        })}
        hasExistingAnalysis
      />,
    );

    expect(markup).toBe('');
  });

  it('shows recovered recordings without claiming speech loss', () => {
    const markup = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        integrityJson={JSON.stringify({
          schemaVersion: 2,
          state: 'needs_attention',
          causes: [{ code: 'recovered_awaiting_validation' }],
          evidenceProvenance: { kind: 'missing' },
          activityEvidence: {
            windows: [
              { speaker: 'Me', startTime: 0, endTime: 2 },
              { speaker: 'Them', startTime: 0, endTime: 2 },
            ],
          },
          recovery: {
            source: 'capture_journal',
            gapDetected: false,
            sourceScope: 'multiple',
            acknowledgedChunkCount: 4,
            recoveredChunkCount: 4,
          },
        })}
        transcriptJson={JSON.stringify({
          lifecycleStatus: 'needs_attention',
          segments: [],
        })}
        audioPath="/synthetic/mic.wav"
        systemAudioPath="/synthetic/system.wav"
        activityEvidenceAvailable
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('Transcript needs attention');
    expect(markup).toContain(
      'Recording recovered. Validate the transcript before creating intelligence.',
    );
    expect(markup).not.toContain('could not account for all captured speech');
    expect(markup).toContain('Validate transcript');
  });

  it('blocks derived intelligence until validation succeeds', () => {
    expect(
      canGenerateMeetingIntelligence({
        transcript_status: 'needs_attention',
        finalization_status: 'finalized',
      }),
    ).toBe(false);
    expect(
      canGenerateMeetingIntelligence({
        transcript_status: 'validating',
        finalization_status: 'finalized',
      }),
    ).toBe(false);
    expect(
      canGenerateMeetingIntelligence({
        transcript_status: 'validated',
        finalization_status: 'finalized',
      }),
    ).toBe(false);
    const validatedAt = '2026-07-30T20:00:00.000Z';
    expect(
      canGenerateMeetingIntelligence({
        transcript_status: 'validated',
        transcript_validated_at: validatedAt,
        transcript_json: JSON.stringify({
          lifecycleStatus: 'validated',
          segments: [{ text: 'Synthetic', startTime: 0, endTime: 1 }],
        }),
        transcript_integrity_json: JSON.stringify({
          schemaVersion: 2,
          state: 'validated',
          causes: [],
          evidenceProvenance: { kind: 'stored_capture_activity_v1' },
          validationProof: {
            gateVersion: 'canonical_integrity_v1',
            validatedAt,
          },
        }),
        finalization_status: 'finalized',
      }),
    ).toBe(true);
    expect(canGenerateMeetingIntelligence({})).toBe(false);
    expect(
      canGenerateMeetingIntelligence({
        transcript_status: 'validated',
        finalization_status: 'recovery_required',
      }),
    ).toBe(false);
  });

  it('shows a recovery-required meeting without offering transcript retry', () => {
    const markup = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        finalizationStatus="recovery_required"
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('Recording saved');
    expect(markup).toContain(
      'Processing needs recovery before this meeting is complete.',
    );
    expect(markup).not.toContain('Retry transcript validation');
  });

  it('does not offer deletion for a recovery-required meeting', () => {
    expect(canDeleteMeeting('recovery_required')).toBe(false);
    expect(canDeleteMeeting('finalized')).toBe(true);

    const markup = renderToStaticMarkup(
      <Sidebar
        sidebarVisible
        activeTab="hub"
        setActiveTab={vi.fn()}
        selectedMeetingId={null}
        setSelectedMeetingId={vi.fn()}
        safeMeetings={[
          {
            id: 'meeting-recovery',
            title: 'Meeting',
            meeting_type: 'Recording',
            started_at: '2026-07-22T20:00:00.000Z',
            finalization_status: 'recovery_required',
          },
        ]}
        onStartRecording={vi.fn()}
        handleDeleteMeeting={vi.fn()}
        setSettingsVisible={vi.fn()}
        theme="light"
        setTheme={vi.fn()}
      />,
    );

    expect(markup).not.toContain('Delete Session');
  });

  it('renders durable retry stage and recoverable timeout state', () => {
    const validating = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="validating"
        integrityJson={JSON.stringify({ retry: { stage: 'transcribing' } })}
      />,
    );
    const timedOut = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        integrityJson={JSON.stringify({ retryFailure: 'retry_timeout' })}
      />,
    );

    expect(validating).toContain('Transcribing the preserved recording.');
    expect(timedOut).toContain('stopped after its safety deadline');
  });
});
