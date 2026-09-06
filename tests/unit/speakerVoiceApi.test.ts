import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteSpeakerVoiceProfile,
  enrollSpeakerVoice,
  getSpeakerVoiceProfileOverview,
  getSpeakerVoiceProfiles,
  getSpeakerVoiceSuggestions,
  getVoiceReferenceSample,
  rejectSpeakerVoiceSuggestion,
  setSpeakerVoiceProfileStatus,
} from '../../src/api/speakerVoice';

describe('speakerVoice API client', () => {
  const invokeMock = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    (global as any).window = {
      ipcRenderer: {
        invoke: invokeMock,
      },
    };
  });

  it('calls SPEAKER_VOICE_GET_SUGGESTIONS with meetingId', async () => {
    invokeMock.mockResolvedValueOnce({
      suggestions: {
        'Remote Speaker 1': {
          speaker: 'Remote Speaker 1',
          suggestedPersonId: 'person-1',
          suggestedPersonName: 'Robin',
          similarityScore: 0.95,
          confidenceTier: 'strong',
          isCalendarAttendee: true,
          candidateDigest: 'cand-digest-1',
          sourceRevision: 'gen-1',
        },
      },
    });

    const result = await getSpeakerVoiceSuggestions('m1', ['person-1']);
    expect(invokeMock).toHaveBeenCalledWith('SPEAKER_VOICE_GET_SUGGESTIONS', {
      meetingId: 'm1',
      calendarAttendeePersonIds: ['person-1'],
    });
    expect(result.suggestions['Remote Speaker 1'].suggestedPersonName).toBe(
      'Robin',
    );
    expect(result.candidates).toEqual({});
    expect(result.enrollmentAvailability).toEqual({});
  });

  it('calls SPEAKER_VOICE_ENROLL with enrollment params', async () => {
    invokeMock.mockResolvedValueOnce({ success: true, enrollmentId: 'e-1' });

    const result = await enrollSpeakerVoice({
      personId: 'person-1',
      sourceMeetingId: 'm1',
      sourceRevision: 'gen-1',
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-1',
      expectedRevision: 42,
    });

    expect(invokeMock).toHaveBeenCalledWith('SPEAKER_VOICE_ENROLL', {
      personId: 'person-1',
      sourceMeetingId: 'm1',
      sourceRevision: 'gen-1',
      speaker: 'Remote Speaker 1',
      candidateDigest: 'cand-digest-1',
      expectedRevision: 42,
    });
    expect(result.success).toBe(true);
  });

  it('calls SPEAKER_VOICE_REJECT with rejection params', async () => {
    invokeMock.mockResolvedValueOnce({ success: true });

    const result = await rejectSpeakerVoiceSuggestion({
      meetingId: 'm1',
      speaker: 'Remote Speaker 1',
      sourceRevision: 'gen-1',
      candidateDigest: 'cand-digest-1',
      personId: 'person-1',
    });

    expect(invokeMock).toHaveBeenCalledWith('SPEAKER_VOICE_REJECT', {
      meetingId: 'm1',
      speaker: 'Remote Speaker 1',
      sourceRevision: 'gen-1',
      candidateDigest: 'cand-digest-1',
      personId: 'person-1',
    });
    expect(result.success).toBe(true);
  });

  it('calls SPEAKER_VOICE_GET_PROFILES', async () => {
    invokeMock.mockResolvedValueOnce({
      profiles: [
        {
          canonicalPersonId: 'person-1',
          personName: 'Robin',
          sampleCount: 2,
          cleanDurationSeconds: 8.0,
          isActive: true,
        },
      ],
    });

    const profiles = await getSpeakerVoiceProfiles();
    expect(invokeMock).toHaveBeenCalledWith('SPEAKER_VOICE_GET_PROFILES', {});
    expect(profiles).toHaveLength(1);
    expect(profiles[0].personName).toBe('Robin');
  });

  it('returns profile opt-outs for People management', async () => {
    invokeMock.mockResolvedValueOnce({
      profiles: [],
      optedOutPersonIds: ['person-1'],
    });

    await expect(getSpeakerVoiceProfileOverview()).resolves.toEqual({
      profiles: [],
      optedOutPersonIds: ['person-1'],
    });
    expect(invokeMock).toHaveBeenCalledWith('SPEAKER_VOICE_GET_PROFILES', {});
  });

  it('calls SPEAKER_VOICE_SET_STATUS', async () => {
    invokeMock.mockResolvedValueOnce({ success: true });

    const result = await setSpeakerVoiceProfileStatus('person-1', false);
    expect(invokeMock).toHaveBeenCalledWith('SPEAKER_VOICE_SET_STATUS', {
      personId: 'person-1',
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  it('calls SPEAKER_VOICE_DELETE', async () => {
    invokeMock.mockResolvedValueOnce({ success: true });

    const result = await deleteSpeakerVoiceProfile('person-1');
    expect(invokeMock).toHaveBeenCalledWith('SPEAKER_VOICE_DELETE', {
      personId: 'person-1',
    });
    expect(result.success).toBe(true);
  });

  it('calls SPEAKER_VOICE_GET_REFERENCE_SAMPLE', async () => {
    invokeMock.mockResolvedValueOnce({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
      durationSeconds: 3.5,
    });

    const sample = await getVoiceReferenceSample('m1', 1.0, 4.5);
    expect(invokeMock).toHaveBeenCalledWith(
      'SPEAKER_VOICE_GET_REFERENCE_SAMPLE',
      {
        sourceMeetingId: 'm1',
        startTime: 1.0,
        endTime: 4.5,
      },
    );
    expect(sample?.durationSeconds).toBe(3.5);
  });
});
