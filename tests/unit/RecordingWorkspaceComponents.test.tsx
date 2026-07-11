import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveTranscript } from '../../src/components/features/LiveTranscript';
import { RecordingCaptureBar } from '../../src/components/features/RecordingCaptureBar';
import { RecordingMeetingRail } from '../../src/components/features/RecordingMeetingRail';

describe('recording workspace components', () => {
  it('renders one explicit capture status and finish action', () => {
    const html = renderToStaticMarkup(
      <RecordingCaptureBar
        status="recording"
        elapsedLabel="03:12"
        statusMessage="Capture is healthy"
        microphone="healthy"
        systemAudio="healthy"
        title="Weekly review"
        onTitleChange={() => {}}
        onFinish={() => {}}
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Microphone');
    expect(html).toContain('System audio');
    expect(html).toContain('Finish recording');
    expect(html).toContain('03:12');
  });

  it('renders transcript entries as a continuous conversation', () => {
    const html = renderToStaticMarkup(
      <LiveTranscript
        segments={[
          {
            id: '1',
            speaker: 'Me',
            text: 'Let’s ship it.',
            timestampMs: 12_000,
            confirmed: true,
          },
        ]}
        interimText="Tomorrow morning"
      />,
    );
    expect(html).toContain('Live transcript');
    expect(html).toContain('Let’s ship it.');
    expect(html).toContain('Tomorrow morning');
    expect(html).not.toContain('No transcript');
  });

  it('keeps notes and participants in a labeled secondary rail', () => {
    const html = renderToStaticMarkup(
      <RecordingMeetingRail
        participants={['Avery']}
        participantInput=""
        onParticipantInputChange={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        notes=""
        onNotesChange={() => {}}
      />,
    );
    expect(html).toContain('Meeting details');
    expect(html).toContain('Notes');
    expect(html).toContain('Remove Avery');
  });
});
