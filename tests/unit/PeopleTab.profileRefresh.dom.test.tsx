// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { PersonBriefingDetail } from '../../src/api/knowledgeGraph';

const api = vi.hoisted(() => ({
  getPersonBriefing: vi.fn(),
  updateEntityStatus: vi.fn(),
  refreshKnowledgeDoc: vi.fn(),
}));
vi.mock('../../src/api/knowledgeGraph', () => ({ ...api }));
vi.mock('../../src/api/knowledgeDocs', () => ({
  refreshKnowledgeDoc: api.refreshKnowledgeDoc,
}));
import { PersonDossier } from '../../src/components/KnowledgeGraph/PeopleTab';

it('keeps a deferred refresh queued and displays the completed profile when polling finishes', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const quote = 'Avery reviewed the launch handoff.';
  const detail = {
    person: {
      id: 'person-profile',
      type: 'person',
      name: 'Avery Chen',
      metadata: null,
    },
    isSelf: false,
    meetings: [
      {
        id: 'meeting-profile',
        title: 'Launch review',
        evidence: 'confirmed',
        started_at: '2026-09-20T12:00:00.000Z',
      },
    ],
    commitments: { open: [], delivered: [], candidates: [] },
    recentActivity: [
      {
        meetingId: 'meeting-profile',
        meetingTitle: 'Launch review',
        occurredAt: '2026-09-20T12:00:00.000Z',
        text: quote,
      },
    ],
    knowledgeDoc: {
      id: 'doc-profile',
      scope_type: 'person_context',
      scope_key: 'person-profile',
      status: 'stale',
      config: JSON.stringify({ synthesis_version: 14 }),
      structured_json: '{}',
      last_synthesized_at: '2026-09-20T12:00:00.000Z',
      updated_at: '2026-09-20T12:00:00.000Z',
    },
    workingMemorySnapshot: null,
  } as unknown as PersonBriefingDetail;
  api.refreshKnowledgeDoc.mockResolvedValue(detail.knowledgeDoc);
  api.getPersonBriefing.mockResolvedValue({
    ...detail,
    knowledgeDoc: {
      ...detail.knowledgeDoc,
      status: 'up_to_date',
      config: JSON.stringify({ synthesis_version: 15 }),
      updated_at: '2026-09-21T12:00:00.000Z',
      structured_json: JSON.stringify({
        person_profile: [
          {
            section: 'overview',
            title: '',
            summary: 'Avery contributed to the launch handoff review.',
            citations: [{ meeting_id: 'meeting-profile', quote }],
          },
        ],
        evidence_index: [{ meeting_id: 'meeting-profile', quote }],
      }),
    },
  });
  try {
    await act(async () =>
      root.render(
        <PersonDossier
          detail={detail}
          onBack={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );
    expect(host.textContent).toContain('Profile refresh queued');
    expect(host.textContent).not.toContain('Preparation failed');
    expect(host.textContent).not.toContain('is being prepared');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(host.textContent).toContain(
      'Avery contributed to the launch handoff review.',
    );
    expect(
      host.querySelector('nav[aria-label="Profile sections"]'),
    ).not.toBeNull();
    expect(host.textContent).not.toContain('Profile refresh queued');
    expect(host.textContent).not.toContain('Preparation failed');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});

it('marks a peer commitment done in one click, preserves it on failure, and allows reopening', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  const root = createRoot(host);
  const item = {
    id: 'peer-task',
    text: 'Send the launch checklist',
    status: 'active',
    sourceMeetingId: 'launch-review',
    sourceMeetingTitle: 'Launch review',
  };
  const detail = {
    person: { id: 'peer', type: 'person', name: 'Avery', metadata: null },
    isSelf: false,
    meetings: [],
    recentActivity: [],
    commitments: { open: [item], delivered: [], candidates: [] },
    knowledgeDoc: null,
    workingMemorySnapshot: null,
  } as unknown as PersonBriefingDetail;
  const onOpenMeeting = vi.fn();
  api.updateEntityStatus
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  const click = async (label: string) => {
    const button = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}: ${item.text}"]`,
    )!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
  };
  try {
    await act(async () =>
      root.render(
        <PersonDossier
          detail={detail}
          onBack={() => {}}
          onOpenMeeting={onOpenMeeting}
        />,
      ),
    );
    await click('Mark done');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not update',
    );
    expect(
      host.querySelector('button[aria-label^="Mark done:"]'),
    ).not.toBeNull();
    await click('Mark done');
    expect(api.updateEntityStatus).toHaveBeenLastCalledWith(
      'peer-task',
      'completed',
    );
    expect(host.querySelector('button[aria-label^="Mark done:"]')).toBeNull();
    expect(host.textContent).toContain('Delivered');
    await click('Reopen');
    expect(api.updateEntityStatus).toHaveBeenLastCalledWith(
      'peer-task',
      'active',
    );
    expect(
      host.querySelector('button[aria-label^="Mark done:"]'),
    ).not.toBeNull();
    expect(onOpenMeeting).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
