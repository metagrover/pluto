import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  MeetingView,
  TranscriptIntegrityPanel,
  canGenerateMeetingIntelligence,
} from '../../src/components/features/MeetingView';
import { Sidebar } from '../../src/components/layout/Sidebar';
import { canDeleteMeeting } from '../../src/utils/recordingFinalization';

describe('MeetingView transcript integrity', () => {
  it('does not render the send-ready follow-up draft panel for analyzed meetings', () => {
    const validatedAt = '2026-07-30T20:00:00.000Z';
    const markup = renderToStaticMarkup(
      <MeetingView
        selectedMeeting={{
          id: 'meeting-follow-up-removal',
          title: 'Launch review',
          meeting_type: 'Recording',
          created_at: '2026-07-30T19:00:00.000Z',
          started_at: '2026-07-30T19:00:00.000Z',
          transcript_status: 'validated',
          transcript_validated_at: validatedAt,
          transcript_json: JSON.stringify({
            lifecycleStatus: 'validated',
            segments: [
              {
                speaker: 'Maya',
                text: 'Launch remains on track.',
                startTime: 0,
                endTime: 1,
              },
            ],
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
          analysis_json: JSON.stringify({
            analysis_schema_version: 3,
            overview: 'Launch remains on track.',
            topics: [],
            all_action_items: [{ text: 'Publish release notes' }],
            all_decisions: [{ text: 'Use a staged rollout' }],
            meeting_type: 'general',
            quality: {
              format_pass: true,
              retry_count: 0,
              fallback_used: false,
              issues: [],
            },
          }),
        }}
        editingTitle={false}
        setEditingTitle={vi.fn()}
        titleValue="Launch review"
        setTitleValue={vi.fn()}
        fetchMeetings={vi.fn()}
        handleCopySummary={vi.fn()}
        copySuccess={false}
        handleDeleteMeeting={vi.fn()}
        highlightEntities={(text) => text}
        transcriptVisible={false}
        setTranscriptVisible={vi.fn()}
      />,
    );

    expect(markup).not.toContain('Ready to send');
    expect(markup).not.toContain('Follow-up format');
    expect(markup).not.toContain('Email follow-up draft');
  });

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

  it('labels analyzed capture gaps as partial instead of a retry error', () => {
    const markup = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        integrityJson={JSON.stringify({
          schemaVersion: 2,
          state: 'needs_attention',
          causes: [{ code: 'capture_gap_detected', sourceScope: 'mic' }],
          evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
          recovery: {
            source: 'capture_journal',
            gapDetected: true,
            sourceScope: 'mic',
            acknowledgedChunkCount: 4,
            recoveredChunkCount: 3,
          },
        })}
        transcriptJson={JSON.stringify({
          lifecycleStatus: 'needs_attention',
          segments: [{ speaker: 'Me', text: 'Synthetic' }],
        })}
        hasExistingAnalysis
      />,
    );

    expect(markup).toContain('Partial transcript');
    expect(markup).toContain('Analysis uses the available transcript');
    expect(markup).not.toContain('Transcript needs attention');
    expect(markup).not.toContain('Retry transcript validation');
  });

  it('does not expose internal validation work for recovered recordings', () => {
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

    expect(markup).toBe('');
    expect(markup).not.toContain('could not account for all captured speech');
    expect(markup).not.toMatch(/validat|needs attention|retry|recovery/i);
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

  it('describes a terminal recording failure without pipeline vocabulary', () => {
    const markup = renderToStaticMarkup(
      <TranscriptIntegrityPanel
        status="needs_attention"
        finalizationStatus="recovery_required"
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('Recording saved');
    expect(markup).toContain('finish the transcript');
    expect(markup).toContain('Your recording is safe.');
    expect(markup).not.toMatch(/validat|needs attention|retry|recovery/i);
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
        onOpenSearch={vi.fn()}
        handleDeleteMeeting={vi.fn()}
        setSettingsVisible={vi.fn()}
        theme="light"
        setTheme={vi.fn()}
      />,
    );

    expect(markup).not.toContain('Delete Session');
  });

  it('keeps ordinary retry stages out of the product surface', () => {
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

    expect(validating).toBe('');
    expect(timedOut).toBe('');
  });

  it('shows transcript content while analysis uses a layout skeleton', () => {
    const markup = renderToStaticMarkup(
      <MeetingView
        selectedMeeting={{
          id: 'meeting-progressive',
          title: 'Design review',
          meeting_type: 'Recording',
          created_at: '2026-08-17T18:00:00.000Z',
          started_at: '2026-08-17T18:00:00.000Z',
          transcript_status: 'validating',
          finalization_status: 'finalized',
          transcript_json: JSON.stringify({
            lifecycleStatus: 'validating',
            segments: [
              {
                speaker: 'Me',
                text: 'The transcript is already useful.',
                startTime: 0,
                endTime: 2,
              },
            ],
          }),
        }}
        editingTitle={false}
        setEditingTitle={vi.fn()}
        titleValue="Design review"
        setTitleValue={vi.fn()}
        fetchMeetings={vi.fn()}
        handleCopySummary={vi.fn()}
        copySuccess={false}
        handleDeleteMeeting={vi.fn()}
        highlightEntities={(text) => text}
        transcriptVisible
        setTranscriptVisible={vi.fn()}
      />,
    );

    expect(markup).toContain('data-meeting-artifact="analysis"');
    expect(markup).toContain('data-state="loading"');
    expect(markup).toContain('data-meeting-skeleton="analysis"');
    expect(markup).toContain('The transcript is already useful.');
    expect(markup).toContain('data-meeting-artifact="transcript"');
    expect(markup).not.toMatch(
      /analysis not ready|validat|needs attention|retry transcript|recovery required/i,
    );
  });

  it('shows an independent transcript skeleton until transcript content exists', () => {
    const markup = renderToStaticMarkup(
      <MeetingView
        selectedMeeting={{
          id: 'meeting-loading-transcript',
          title: 'Meeting',
          meeting_type: 'Recording',
          created_at: '2026-08-17T18:00:00.000Z',
          started_at: '2026-08-17T18:00:00.000Z',
          transcript_status: 'provisional',
          finalization_status: 'finalized',
          transcript_json: JSON.stringify({
            lifecycleStatus: 'provisional',
            segments: [],
          }),
        }}
        editingTitle={false}
        setEditingTitle={vi.fn()}
        titleValue="Meeting"
        setTitleValue={vi.fn()}
        fetchMeetings={vi.fn()}
        handleCopySummary={vi.fn()}
        copySuccess={false}
        handleDeleteMeeting={vi.fn()}
        highlightEntities={(text) => text}
        transcriptVisible
        setTranscriptVisible={vi.fn()}
      />,
    );

    expect(markup).toContain('data-meeting-skeleton="analysis"');
    expect(markup).toContain('data-meeting-skeleton="transcript"');
    expect(markup).not.toContain('No Content Recorded');
    expect(markup).not.toContain('No biometric voice data found');
  });

  it('does not offer regeneration while the transcript is still being prepared', () => {
    const markup = renderToStaticMarkup(
      <MeetingView
        selectedMeeting={{
          id: 'meeting-analysis-with-internal-work',
          title: 'Design review',
          meeting_type: 'Recording',
          created_at: '2026-08-17T18:00:00.000Z',
          started_at: '2026-08-17T18:00:00.000Z',
          transcript_status: 'needs_attention',
          finalization_status: 'finalized',
          transcript_json: JSON.stringify({
            lifecycleStatus: 'needs_attention',
            segments: [
              {
                speaker: 'Me',
                text: 'Existing transcript content.',
                startTime: 0,
                endTime: 2,
              },
            ],
          }),
          analysis_json: JSON.stringify({
            analysis_schema_version: 3,
            overview: 'Existing analysis content.',
            topics: [],
            all_action_items: [],
            all_decisions: [],
            meeting_type: 'general',
            quality: {
              format_pass: true,
              retry_count: 0,
              fallback_used: false,
              issues: [],
            },
          }),
        }}
        editingTitle={false}
        setEditingTitle={vi.fn()}
        titleValue="Design review"
        setTitleValue={vi.fn()}
        fetchMeetings={vi.fn()}
        handleCopySummary={vi.fn()}
        copySuccess={false}
        handleDeleteMeeting={vi.fn()}
        highlightEntities={(text) => text}
        transcriptVisible={false}
        setTranscriptVisible={vi.fn()}
      />,
    );

    expect(markup).not.toContain('Regenerate Enhanced Notes');
    expect(markup).not.toMatch(/validat|needs attention|retry transcript/i);
  });
});
