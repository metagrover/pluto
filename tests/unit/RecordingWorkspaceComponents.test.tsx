// @vitest-environment happy-dom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { LiveTranscript } from '../../src/components/features/LiveTranscript';
import { RecordingCaptureBar } from '../../src/components/features/RecordingCaptureBar';
import { RecordingMeetingRail } from '../../src/components/features/RecordingMeetingRail';
import { RecordingNamePopover } from '../../src/components/features/RecordingNamePopover';
import { ZenMode } from '../../src/components/features/ZenMode';

describe('recording workspace components', () => {
  it('renders one explicit capture status and finish action', () => {
    const html = renderToStaticMarkup(
      <RecordingCaptureBar
        status="recording"
        elapsedLabel="03:12"
        statusMessage="Capture is healthy"
        microphone="healthy"
        systemAudio="healthy"
        liveTranscriptIntegrity="healthy"
        onBackHome={() => {}}
        onFinish={() => {}}
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('recording-capture-bar drag-region');
    expect(html).toContain('recording-capture-drag drag-region');
    expect(html).toContain('Back home');
    expect(html).toContain('aria-label="Back home"');
    expect(html).toContain('title="Back home"');
    expect(html).toContain('Microphone');
    expect(html).toContain('System audio');
    expect(html).toContain('Finish recording');
    expect(html).toContain('03:12');
    expect(html).not.toContain('Meeting title');
    expect(html).not.toContain('Weekly review');
  });

  it('announces live transcript lag without reporting capture failure', () => {
    const html = renderToStaticMarkup(
      <RecordingCaptureBar
        status="recording"
        elapsedLabel="04:10"
        statusMessage="Your audio is recording, but live transcription is falling behind"
        microphone="healthy"
        systemAudio="healthy"
        liveTranscriptIntegrity="lagging"
        onBackHome={() => {}}
        onFinish={() => {}}
      />,
    );

    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('live transcription is falling behind');
  });

  it('calls the back-home handler from the recording capture bar', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onBackHome = vi.fn();

    act(() => {
      root.render(
        <RecordingCaptureBar
          status="recording"
          elapsedLabel="04:10"
          statusMessage="Capture is healthy"
          microphone="healthy"
          systemAudio="healthy"
          liveTranscriptIntegrity="healthy"
          onBackHome={onBackHome}
          onFinish={() => {}}
        />,
      );
    });

    const backHome = container.querySelector<HTMLButtonElement>(
      'button.recording-back-home',
    );
    expect(backHome).not.toBeNull();
    expect(backHome?.className).toContain('no-drag');
    backHome?.click();

    expect(onBackHome).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('renders the active name popover with meeting fallback and status dot', () => {
    const html = renderToStaticMarkup(
      <RecordingNamePopover
        title=""
        voiceActivity="active"
        onExpand={() => {}}
      />,
    );

    expect(html).toContain('Active recording');
    expect(html).toContain('Voice input active');
    expect(html).toContain('recording-name-status-dot--active');
    expect(html).toContain('Meeting');
    expect(html).toContain('Expand note');
  });

  it('uses the current meeting title before falling back to Meeting', () => {
    const html = renderToStaticMarkup(
      <RecordingNamePopover
        title="Launch review"
        voiceActivity="idle"
        onExpand={() => {}}
      />,
    );

    expect(html).toContain('Launch review');
    expect(html).toContain('title="Launch review"');
    expect(html).not.toContain('<input');
  });

  it('calls the expand handler from the active name popover', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onExpand = vi.fn();

    act(() => {
      root.render(
        <RecordingNamePopover
          title="Launch review"
          voiceActivity="idle"
          onExpand={onExpand}
        />,
      );
    });

    const expand = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand note"]',
    );
    expect(expand).not.toBeNull();
    expect(expand?.className).toContain('no-drag');
    expand?.click();

    expect(onExpand).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('renders Zen View with an integrated back-home button and no active name popover', () => {
    const html = renderToStaticMarkup(
      <ZenMode
        isStarting={false}
        isProcessing={false}
        onEndMeeting={() => {}}
        onBackHome={() => {}}
        meetingTitle=""
        setMeetingTitle={() => {}}
        meetingParticipants={[]}
        setMeetingParticipants={() => {}}
        participantInput=""
        setParticipantInput={() => {}}
        currentNotes=""
        setCurrentNotes={() => {}}
        liveTranscript={[]}
        captureHealth={{
          microphone: 'healthy',
          systemAudio: 'healthy',
          captureDurability: 'healthy',
        }}
        liveTranscriptIntegrity="healthy"
        recordingStartedAtMs={null}
      />,
    );

    expect(html).toContain('Back home');
    expect(html).not.toContain('Active recording');
    expect(html).not.toContain('Expand note');
  });

  it('renders Ask Pluto in Zen View with live meeting context', () => {
    const html = renderToStaticMarkup(
      <ZenMode
        isProcessing={false}
        onEndMeeting={() => {}}
        onBackHome={() => {}}
        meetingTitle="Launch review"
        setMeetingTitle={() => {}}
        meetingParticipants={['Avery']}
        setMeetingParticipants={() => {}}
        participantInput=""
        setParticipantInput={() => {}}
        currentNotes="Remember to follow up on pricing."
        setCurrentNotes={() => {}}
        liveTranscript={[
          {
            id: 'segment-1',
            speaker: 'Me',
            text: 'We decided to launch on Friday.',
            timestampMs: 4_000,
            confirmed: true,
          },
        ]}
        interimText="Riley will draft the announcement"
        captureHealth={{
          microphone: 'healthy',
          systemAudio: 'healthy',
          captureDurability: 'healthy',
        }}
        liveTranscriptIntegrity="healthy"
        recordingStartedAtMs={Date.parse('2026-08-18T10:00:00.000Z')}
      />,
    );

    expect(html).toContain('Ask Pluto');
    expect(html).toContain('Ask about this meeting');
    expect(html).toContain('Launch review');
  });

  it('places Ask Pluto in the live transcript grid cell', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <ZenMode
        isStarting={false}
        isProcessing={false}
        onEndMeeting={() => {}}
        onBackHome={() => {}}
        meetingTitle="Launch review"
        setMeetingTitle={() => {}}
        meetingParticipants={['Avery']}
        setMeetingParticipants={() => {}}
        participantInput=""
        setParticipantInput={() => {}}
        currentNotes="Remember to follow up on pricing."
        setCurrentNotes={() => {}}
        liveTranscript={[]}
        captureHealth={{
          microphone: 'healthy',
          systemAudio: 'healthy',
          captureDurability: 'healthy',
        }}
        liveTranscriptIntegrity="healthy"
        recordingStartedAtMs={null}
      />,
    );

    const grid = container.querySelector('.recording-workspace-grid');
    const transcript = grid?.querySelector(':scope > [data-live-transcript]');
    const dock = grid?.querySelector(':scope > [aria-label="Ask Pluto"]');

    expect(transcript).not.toBeNull();
    expect(dock).not.toBeNull();
    expect(dock?.previousElementSibling).toBe(transcript);
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

  it('presents notes as the primary recording document', () => {
    const html = renderToStaticMarkup(
      <RecordingMeetingRail
        title="Launch review"
        onTitleChange={() => {}}
        participants={['Avery']}
        participantInput=""
        onParticipantInputChange={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        notes=""
        onNotesChange={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Meeting notes"');
    expect(html).toContain('Live note');
    expect(html).toContain('Saved locally');
    expect(html).toContain('Meeting title');
    expect(html).toContain('value="Launch review"');
    expect(html).toContain('Remove Avery');
    expect(html).toContain('Participants');
    expect(html).toContain('Add a person');
    expect(html).not.toContain('Meeting details');
    expect(html).not.toContain('Capture diagnostics');
    expect(html).not.toContain('<details');
  });

  it('offers matched Calendar context without replacing a typed title', async () => {
    const calendarEvent = {
      occurrenceKey: 'event-a',
      eventIdentifier: 'event-a',
      calendarIdentifier: 'calendar-a',
      title: 'Product review',
      start: '2026-08-30T17:30:00.000Z',
      end: '2026-08-30T18:30:00.000Z',
      isAllDay: false,
      isCancelled: false,
      availability: 'busy',
      organizer: { name: 'Alex', email: null },
      attendees: [{ name: 'Sam', email: null }],
      lastModified: null,
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    const onTitleChange = vi.fn();
    await act(async () =>
      root.render(
        <RecordingMeetingRail
          title=""
          onTitleChange={onTitleChange}
          calendarEvent={calendarEvent}
          participants={[]}
          participantInput=""
          onParticipantInputChange={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
        />,
      ),
    );
    expect(container.textContent).toContain('From Calendar');
    expect(container.textContent).toContain('Product review');
    expect(container.textContent).toContain('Alex · Sam');
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Use Product review as meeting title"]',
      )
      ?.click();
    expect(onTitleChange).toHaveBeenCalledWith('Product review');
    act(() => root.unmount());

    const titled = renderToStaticMarkup(
      <RecordingMeetingRail
        title="Customer escalation"
        onTitleChange={() => {}}
        calendarEvent={calendarEvent}
        participants={[]}
        participantInput=""
        onParticipantInputChange={() => {}}
        onAddParticipant={() => {}}
        onRemoveParticipant={() => {}}
        notes=""
        onNotesChange={() => {}}
      />,
    );
    expect(titled).not.toContain('Use Product review as meeting title');
  });

  it('saves live scratchpad text locally after typing pauses', async () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    const container = document.createElement('div');
    const root = createRoot(container);
    const onNotesChange = vi.fn();

    await act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Launch review"
          onTitleChange={() => {}}
          participants={[]}
          participantInput=""
          onParticipantInputChange={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          notes="Draft note"
          onNotesChange={onNotesChange}
        />,
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(window.localStorage.getItem('pluto.recording-scratchpad')).toBe(
      'Draft note',
    );
    expect(container.textContent).toContain('Saved locally');
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('places the scratchpad before the live transcript', () => {
    const html = renderToStaticMarkup(
      <ZenMode
        isStarting={false}
        isProcessing={false}
        onEndMeeting={() => {}}
        onBackHome={() => {}}
        meetingTitle="Launch review"
        setMeetingTitle={() => {}}
        meetingParticipants={[]}
        setMeetingParticipants={() => {}}
        participantInput=""
        setParticipantInput={() => {}}
        currentNotes=""
        setCurrentNotes={() => {}}
        liveTranscript={[]}
        captureHealth={{
          microphone: 'healthy',
          systemAudio: 'healthy',
          captureDurability: 'healthy',
        }}
        liveTranscriptIntegrity="healthy"
        recordingStartedAtMs={null}
      />,
    );

    expect(html.indexOf('data-recording-scratchpad')).toBeLessThan(
      html.indexOf('data-live-transcript'),
    );
  });

  it('updates the recording meeting title from the details rail', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onTitleChange = vi.fn();

    act(() => {
      root.render(
        <RecordingMeetingRail
          title=""
          onTitleChange={onTitleChange}
          participants={[]}
          participantInput=""
          onParticipantInputChange={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>('#recording-title');
    expect(title).not.toBeNull();
    expect(title?.placeholder).toBe('Meeting');
    expect(title?.maxLength).toBe(64);
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    act(() => {
      if (!title || !valueSetter) return;
      valueSetter.call(title, 'Roadmap sync');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onTitleChange).toHaveBeenCalledWith('Roadmap sync');
    act(() => root.unmount());
  });

  it('caps recording meeting titles at 64 characters', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onTitleChange = vi.fn();

    act(() => {
      root.render(
        <RecordingMeetingRail
          title=""
          onTitleChange={onTitleChange}
          participants={[]}
          participantInput=""
          onParticipantInputChange={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>('#recording-title');
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    const longTitle = 'A'.repeat(140);

    act(() => {
      if (!title || !valueSetter) return;
      valueSetter.call(title, longTitle);
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onTitleChange).toHaveBeenCalledWith('A'.repeat(64));
    act(() => root.unmount());
  });
});
