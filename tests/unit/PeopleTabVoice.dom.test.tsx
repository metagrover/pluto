// @vitest-environment happy-dom

import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPeopleBriefingSummaries: vi.fn(),
  getPersonBriefing: vi.fn(),
  updatePersonName: vi.fn(),
  mergePerson: vi.fn(),
  restorePersonMerge: vi.fn(),
  resolvePersonCommitmentOwner: vi.fn(),
  getEntityAliasSuggestions: vi.fn(),
  triggerDreamingNow: vi.fn(),
  getPendingDreamingProposals: vi.fn(),
  acceptDreamingProposal: vi.fn(),
  rejectDreamingProposal: vi.fn(),
  recordEntityCorrection: vi.fn(),
}));

const voiceApi = vi.hoisted(() => ({
  getSpeakerVoiceProfileOverview: vi.fn(),
  getSpeakerVoiceProfiles: vi.fn(),
  setSpeakerVoiceProfileStatus: vi.fn(),
  deleteSpeakerVoiceProfile: vi.fn(),
  getVoiceReferenceSample: vi.fn(),
}));

vi.mock('../../src/api/knowledgeGraph', () => api);
vi.mock('../../src/api/speakerVoice', () => voiceApi);

import { PeopleTab } from '../../src/components/KnowledgeGraph/PeopleTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const entity = (id: string, name: string) => ({
  id,
  type: 'person' as const,
  name,
  normalized_name: name.toLowerCase(),
  status: 'active' as const,
  due_date: null,
  assigned_to: null,
  metadata: null,
  saliency_score: 1,
  domain_tag: 'work',
  created_at: '2026-08-01T12:00:00.000Z',
  updated_at: '2026-08-20T12:00:00.000Z',
});

const summary = (id: string, name: string) => ({
  id,
  name,
  role: 'Known from conversations',
  meetingCount: 2,
  mentionCount: 3,
  latestMeetingId: 'meeting-1',
  latestMeetingTitle: 'Product review',
  latestMeetingAt: '2026-08-20T12:00:00.000Z',
  context: null,
  openCommitmentCount: 0,
  candidateCommitmentCount: 0,
  briefHeadline: null,
  briefStatus: null,
  briefUpdatedAt: null,
  possibleDuplicateCount: 0,
});

const detail = (
  id: string,
  name: string,
  mergedPeople: Array<{ id: string; name: string }> = [],
) => ({
  person: entity(id, name),
  meetings: [],
  commitments: { open: [], delivered: [], candidates: [] },
  isSelf: false,
  knowledgeDoc: null,
  workingMemorySnapshot: null,
  mergedPeople,
});

describe('PeopleTab Voice Profile integration', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    api.getPeopleBriefingSummaries.mockResolvedValue([
      summary('person-1', 'Avery Chen'),
      summary('person-2', 'Bob Smith'),
    ]);
    api.getPersonBriefing.mockImplementation((id: string) =>
      Promise.resolve(
        detail(id, id === 'person-1' ? 'Avery Chen' : 'Bob Smith'),
      ),
    );

    voiceApi.getSpeakerVoiceProfiles.mockResolvedValue([
      {
        canonicalPersonId: 'person-1',
        personName: 'Avery Chen',
        sampleCount: 2,
        cleanDurationSeconds: 7.2,
        isActive: true,
        referenceInterval: {
          startTime: 1.0,
          endTime: 4.0,
          excerpt: 'Hello there',
          sourceMeetingId: 'meeting-sample-1',
        },
      },
    ]);
    voiceApi.getSpeakerVoiceProfileOverview.mockImplementation(async () => ({
      profiles: await voiceApi.getSpeakerVoiceProfiles(),
      optedOutPersonIds: [],
    }));
    voiceApi.setSpeakerVoiceProfileStatus.mockResolvedValue({ success: true });
    voiceApi.deleteSpeakerVoiceProfile.mockResolvedValue({ success: true });
    voiceApi.getVoiceReferenceSample.mockResolvedValue({
      bytes: new Uint8Array([0, 1, 2]),
      mimeType: 'audio/wav',
      durationSeconds: 3.0,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const renderTab = async (selectedPersonId = 'person-1') => {
    await act(async () => {
      root.render(
        <PeopleTab
          selectedPersonId={selectedPersonId}
          onSelectPerson={() => {}}
        />,
      );
    });
    // flush microtasks
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('renders voice profile card with active status, sample count, and clean speech duration', async () => {
    await renderTab();

    expect(host.textContent).toContain('Voice Profile');
    expect(host.textContent).toContain('Remembered voice (Active)');
    expect(host.textContent).toContain('2 samples (7s speech)');
    expect(host.textContent).toContain('Play reference sample');
    expect(host.textContent).toContain('Disable voice recognition');

    const deleteBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete voice profile',
    );
    expect(deleteBtn).toBeDefined();
    expect(deleteBtn?.disabled).toBe(false);
  });

  it('toggles voice profile status between active and disabled', async () => {
    await renderTab();

    const toggleBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Disable voice recognition',
    );
    expect(toggleBtn).toBeDefined();

    await act(async () => {
      toggleBtn?.click();
    });

    expect(voiceApi.setSpeakerVoiceProfileStatus).toHaveBeenCalledWith(
      'person-1',
      false,
    );
    expect(host.textContent).toContain('Disabled');
    expect(host.textContent).toContain('Enable voice recognition');
  });

  it('plays reference sample when button is clicked', async () => {
    await renderTab();

    const playBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Play reference sample'),
    );
    expect(playBtn).toBeDefined();

    await act(async () => {
      playBtn?.click();
    });

    expect(voiceApi.getVoiceReferenceSample).toHaveBeenCalledWith(
      'meeting-sample-1',
      1.0,
      4.0,
    );
  });

  it('disables permanent delete and displays disclosure for merged family', async () => {
    api.getPersonBriefing.mockImplementation((id: string) =>
      Promise.resolve(
        detail('person-1', 'Avery Chen', [
          { id: 'person-merged', name: 'Avery C.' },
        ]),
      ),
    );

    await renderTab('person-1');

    const deleteBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete voice profile',
    );
    expect(deleteBtn).toBeDefined();
    expect(deleteBtn?.disabled).toBe(true);
    expect(deleteBtn?.getAttribute('title')).toBe(
      'Restore this person merge before permanently deleting voice samples.',
    );
    expect(host.textContent).toContain(
      'Restore this person merge before permanently deleting voice samples.',
    );
  });

  it('deletes voice profile when person is not part of an active merge', async () => {
    await renderTab();

    const deleteBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete voice profile',
    );
    expect(deleteBtn).toBeDefined();

    await act(async () => {
      deleteBtn?.click();
    });

    expect(voiceApi.deleteSpeakerVoiceProfile).toHaveBeenCalledWith('person-1');
    expect(host.textContent).toContain('Voice profile deleted');
  });

  it('does not misreport a profile-loading failure as no enrollment', async () => {
    voiceApi.getSpeakerVoiceProfileOverview.mockRejectedValueOnce(
      new Error('profile read failed'),
    );

    await renderTab();

    expect(host.textContent).toContain('Voice profile could not be loaded.');
    expect(host.textContent).not.toContain(
      'No voice profile enrolled for this person.',
    );
  });

  it('lets a person explicitly allow future voice enrollment after deletion', async () => {
    voiceApi.getSpeakerVoiceProfileOverview.mockResolvedValueOnce({
      profiles: [],
      optedOutPersonIds: ['person-1'],
    });

    await renderTab();
    expect(host.textContent).toContain('Voice profile deleted');
    const allowButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Allow voice enrollment',
    );
    expect(allowButton).toBeDefined();

    await act(async () => {
      allowButton?.click();
    });

    expect(voiceApi.setSpeakerVoiceProfileStatus).toHaveBeenCalledWith(
      'person-1',
      true,
    );
    expect(host.textContent).toContain(
      'No voice profile enrolled for this person.',
    );
  });
});
