// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonBriefingDetail } from '../../src/api/knowledgeGraph';
import {
  PeopleTab,
  PersonDossier,
} from '../../src/components/KnowledgeGraph/PeopleTab';
import type { Note } from '../../src/types/notes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const personDetail: PersonBriefingDetail = {
  person: {
    id: 'person-alice',
    type: 'person',
    name: 'Alice Smith',
    metadata: null,
  },
  isSelf: false,
  meetings: [],
  commitments: { open: [], delivered: [], candidates: [] },
  recentActivity: [],
  knowledgeDoc: null,
  workingMemorySnapshot: null,
} as unknown as PersonBriefingDetail;

const sampleNotes: Note[] = [
  {
    id: 'note-alice-1',
    title: '1:1 with Alice',
    content: '- [ ] Review quarterly performance\n- [ ] Plan hiring goals',
    noteType: 'person',
    pinned: false,
    targetId: 'person-alice',
    targetName: 'Alice Smith',
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
  },
];

describe('PeopleTab Running 1:1 Notes Integration', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    invoke = vi.fn(async (channel: string, payload: any) => {
      if (channel === 'NOTES_FOR_ENTITY') {
        if (payload === 'person-alice') return sampleNotes;
        return [];
      }
      if (channel === 'NOTES_SAVE') {
        return {
          id: 'note-alice-new',
          title: payload.title || '1:1 with Alice Smith',
          content: payload.content || '',
          noteType: 'person',
          targetId: payload.targetId || 'person-alice',
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      return null;
    });

    (window as any).ipcRenderer = {
      invoke,
      on: vi.fn(() => () => {}),
      removeListener: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('lists 1:1 notes with title and snippet in the person timeline', async () => {
    const onOpenNote = vi.fn();

    await act(async () => {
      root.render(
        <PersonDossier
          detail={personDetail}
          personNotes={sampleNotes}
          onBack={() => {}}
          onOpenMeeting={() => {}}
          onOpenNote={onOpenNote}
        />,
      );
    });

    expect(container.textContent).toContain('Meetings and notes');
    expect(container.textContent).toContain('1:1 with Alice');
    expect(container.textContent).toContain(
      'Note · Review quarterly performance · Plan hiring goals',
    );

    const openBtn = container.querySelector(
      'button[aria-label="Open note 1:1 with Alice"]',
    ) as HTMLButtonElement;
    expect(openBtn).not.toBeNull();

    await act(async () => {
      openBtn.click();
    });

    expect(onOpenNote).toHaveBeenCalledWith('note-alice-1');
  });

  it('calls onOpenNote with existing note when "+ 1:1 Note" is clicked and notes exist', async () => {
    const onOpenNote = vi.fn();

    await act(async () => {
      root.render(
        <PersonDossier
          detail={personDetail}
          personNotes={sampleNotes}
          onBack={() => {}}
          onOpenMeeting={() => {}}
          onOpenNote={onOpenNote}
        />,
      );
    });

    const addNoteBtn = container.querySelector(
      'button[aria-label="New 1:1 note for Alice Smith"]',
    ) as HTMLButtonElement;
    expect(addNoteBtn).not.toBeNull();

    await act(async () => {
      addNoteBtn.click();
    });

    expect(onOpenNote).toHaveBeenCalledWith('note-alice-1');
  });

  it('creates and opens a new 1:1 note when no notes exist and "+ 1:1 Note" is clicked', async () => {
    const onOpenNote = vi.fn();

    await act(async () => {
      root.render(
        <PersonDossier
          detail={personDetail}
          personNotes={[]}
          onBack={() => {}}
          onOpenMeeting={() => {}}
          onOpenNote={onOpenNote}
        />,
      );
    });

    expect(container.textContent).toContain('No meetings or notes yet');

    const addNoteBtn = container.querySelector(
      'button[aria-label="New 1:1 note for Alice Smith"]',
    ) as HTMLButtonElement;
    expect(addNoteBtn).not.toBeNull();

    await act(async () => {
      addNoteBtn.click();
    });

    expect(invoke).toHaveBeenCalledWith(
      'NOTES_SAVE',
      expect.objectContaining({
        noteType: 'person',
        targetId: 'person-alice',
      }),
    );
    expect(onOpenNote).toHaveBeenCalledWith('note-alice-new');
  });

  it('interleaves meetings and notes newest first', async () => {
    await act(async () => {
      root.render(
        <PersonDossier
          detail={{
            ...personDetail,
            meetings: [
              {
                id: 'm-new',
                title: 'Alice / me 1:1',
                started_at: '2026-10-30T10:00:00.000Z',
                created_at: null,
                duration_seconds: 1800,
                context: null,
                evidence: 'confirmed',
              },
              {
                id: 'm-old',
                title: 'Kickoff',
                started_at: '2026-10-01T10:00:00.000Z',
                created_at: null,
                duration_seconds: 1800,
                context: null,
                evidence: 'confirmed',
              },
            ],
          }}
          personNotes={sampleNotes}
          onBack={() => {}}
          onOpenMeeting={() => {}}
          onOpenNote={() => {}}
        />,
      );
    });
    const rows = [
      ...container.querySelectorAll(
        '#person-meetings .person-dossier__meetings > button',
      ),
    ].map((row) => row.querySelector('strong')?.textContent);
    expect(rows).toEqual(['Alice / me 1:1', '1:1 with Alice', 'Kickoff']);
  });
});
