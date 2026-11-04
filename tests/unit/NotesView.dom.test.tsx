// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotesView,
  extractNoteTitleAndBlocks,
} from '../../src/components/features/notes/NotesView';
import type { Note } from '../../src/types/notes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialNotes: Note[] = [
  {
    id: 'note-scratchpad',
    title: 'Daily Scratchpad',
    content: '# Daily Scratchpad\n\nJot down thoughts here.',
    noteType: 'scratchpad',
    pinned: true,
    targetId: null,
    targetName: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  },
  {
    id: 'note-person',
    title: '1:1 with Sarah',
    content: '[task: Review Q4 goals]\n- [ ] Discuss project timeline',
    noteType: 'person',
    pinned: false,
    targetId: 'person-1',
    targetName: 'Sarah Connor',
    createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
  },
];

describe('NotesView workspace', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;
  let notes: Note[];

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    notes = JSON.parse(JSON.stringify(initialNotes));

    invoke = vi.fn(async (channel: string, payload: any) => {
      // Like real IPC, every list call returns a fresh array.
      if (channel === 'NOTES_LIST') return notes.map((n) => ({ ...n }));
      if (channel === 'NOTES_GET')
        return notes.find((n) => n.id === payload) || null;
      if (channel === 'NOTES_SAVE') {
        const id = payload.id || `note-${Date.now()}`;
        const existingIdx = notes.findIndex((n) => n.id === id);
        const updated: Note = {
          id,
          title: payload.title || 'Untitled',
          content: payload.content || '',
          noteType: payload.noteType || 'general',
          targetId: payload.targetId || null,
          targetName: null,
          pinned: !!payload.pinned,
          createdAt:
            existingIdx >= 0
              ? notes[existingIdx].createdAt
              : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (existingIdx >= 0) notes[existingIdx] = updated;
        else notes.unshift(updated);
        return updated;
      }
      if (channel === 'NOTES_DELETE') {
        notes = notes.filter((n) => n.id !== payload);
        return true;
      }
      if (channel === 'GET_ENTITIES_BY_TYPE') {
        if (payload === 'person')
          return [{ id: 'person-1', name: 'Sarah Connor' }];
        if (payload === 'project') return [{ id: 'proj-1', name: 'Pluto App' }];
        return [];
      }
      if (channel === 'CALENDAR_LIST_DAY') return [];
      if (channel === 'TASKS_LIST') return { tasks: [] };
      if (channel === 'TASKS_SAVE') return 'task-new-1';
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

  it('renders notes list and selects the first note by default', async () => {
    await act(async () => {
      root.render(<NotesView />);
    });

    expect(container.textContent).toContain('Daily Scratchpad');
    expect(container.textContent).toContain('1:1 with Sarah');

    const titleInput = container.querySelector(
      'textarea[aria-label="Note title"]',
    ) as HTMLTextAreaElement;
    expect(titleInput).not.toBeNull();
    expect(titleInput.value).toBe('Daily Scratchpad');
  });

  it('switches notes on click in the sidebar', async () => {
    await act(async () => {
      root.render(<NotesView />);
    });

    const personItem = [
      ...container.querySelectorAll('.note-sidebar-item'),
    ].find((el) => el.textContent?.includes('1:1 with Sarah')) as HTMLElement;

    expect(personItem).toBeDefined();

    await act(async () => {
      personItem.click();
    });

    const titleInput = container.querySelector(
      'textarea[aria-label="Note title"]',
    ) as HTMLTextAreaElement;
    expect(titleInput.value).toBe('1:1 with Sarah');

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('Review Q4 goals');
  });

  it('creates a new note when clicking the "+ Note" button', async () => {
    await act(async () => {
      root.render(<NotesView />);
    });

    const newBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Note'),
    ) as HTMLButtonElement;

    expect(newBtn).toBeDefined();

    await act(async () => {
      newBtn.click();
    });

    expect(invoke).toHaveBeenCalledWith('NOTES_SAVE', expect.any(Object));
  });

  it('filters notes via search input', async () => {
    await act(async () => {
      root.render(<NotesView />);
    });

    const searchInput = container.querySelector(
      'input[aria-label="Search notes"]',
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeInputValueSetter?.call(searchInput, 'Sarah');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const sidebarItems = container.querySelectorAll('.note-sidebar-item');
    expect(sidebarItems.length).toBe(1);
    expect(sidebarItems[0].textContent).toContain('1:1 with Sarah');
  });

  it('avoids clutter by omitting Saved indicator, Sync Tasks button, and redundant breadcrumb title', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });

    // Verify "Sync Tasks" button and "Saved" status are completely avoided
    const syncBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Sync Tasks'),
    );
    expect(syncBtn).toBeUndefined();
    expect(container.textContent).not.toContain('Saved');

    // Breadcrumb header shows "Notes" without repeating "/ Daily Scratchpad"
    const breadcrumb = container.querySelector('main .h-12');
    expect(breadcrumb?.textContent).toContain('Notes');
    expect(breadcrumb?.textContent).not.toContain('/ Daily Scratchpad');

    // Link person and project button is present with clean styling
    const linkBtn = container.querySelector(
      'button[aria-label="Link note to person or project"]',
    ) as HTMLButtonElement;
    expect(linkBtn).not.toBeNull();
    expect(linkBtn.textContent).toContain('Link person or project');

    // Clicking opens the improved searchable picker popover
    await act(async () => {
      linkBtn.click();
    });

    const picker = container.querySelector(
      'div[role="menu"][aria-label="Select entity to link"]',
    );
    expect(picker).not.toBeNull();
    expect(
      picker?.querySelector('input[placeholder="Search people & projects..."]'),
    ).not.toBeNull();
    expect(picker?.textContent).toContain('People');
    expect(picker?.textContent).toContain('Projects');
  });

  it('does not create tasks for standard - [ ] checklist items, but syncs explicit [task: ...] items', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<NotesView initialNoteId="note-scratchpad" />);
      });

      const editBtn = container.querySelector(
        'button[aria-label="Edit note content"]',
      ) as HTMLButtonElement;
      if (editBtn) {
        await act(async () => {
          editBtn.click();
        });
      }

      const textarea = container.querySelector(
        '#note-textarea-editor',
      ) as HTMLTextAreaElement;
      expect(textarea).not.toBeNull();

      invoke.mockClear();

      await act(async () => {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        nativeSetter?.call(
          textarea,
          '# Daily Scratchpad\n\n- [ ] My local checklist item\n[task: Synced ledger task]',
        );
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // Fast forward past auto-save debounce (400ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(650);
      });

      // NOTES_SAVE is called with both
      expect(invoke).toHaveBeenCalledWith(
        'NOTES_SAVE',
        expect.objectContaining({
          id: 'note-scratchpad',
          content: expect.stringContaining('- [ ] My local checklist item'),
        }),
      );

      // TASKS_SAVE is ONLY called for the explicit task item, NOT for the - [ ] checklist
      expect(invoke).toHaveBeenCalledWith(
        'TASKS_SAVE',
        expect.objectContaining({
          title: 'Synced ledger task',
          sourceNoteId: 'note-scratchpad',
          sourceNoteLineId: 'note-scratchpad:line:3',
          status: 'active',
        }),
      );

      const tasksSaveCalls = invoke.mock.calls.filter(
        (call: any[]) => call[0] === 'TASKS_SAVE',
      );
      expect(tasksSaveCalls.length).toBe(1);
      expect(
        tasksSaveCalls.some(
          (c: any[]) => c[1].title === 'My local checklist item',
        ),
      ).toBe(false);

      // Does NOT show distracting "Synced X tasks" message
      expect(container.textContent).not.toContain('Synced 1 task');
    } finally {
      vi.useRealTimers();
    }
  });

  it('automatically syncs completed status to Tasks when toggling an explicit task item', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    invoke.mockClear();

    const toggleBtn = container.querySelector(
      '[data-block-type="task"] input[aria-label="Mark task complete"]',
    ) as HTMLInputElement;
    expect(toggleBtn).not.toBeNull();

    await act(async () => {
      toggleBtn.click();
    });

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('[task:done: Review Q4 goals]');

    // Automatically synced to TASKS_SAVE with completed status
    expect(invoke).toHaveBeenCalledWith(
      'TASKS_SAVE',
      expect.objectContaining({
        title: 'Review Q4 goals',
        sourceNoteId: 'note-person',
        sourceNoteLineId: 'note-person:line:0',
        status: 'completed',
      }),
    );
  });

  it('toggles checkboxes for checklist items without creating tasks in Tasks ledger', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    invoke.mockClear();

    // Plain checklist items (- [ ]) render as square checklist checkboxes,
    // outside the synced task group.
    const checklistCheckbox = container.querySelector(
      'input[type="checkbox"][aria-label="Mark checklist item complete"]',
    ) as HTMLInputElement;
    expect(checklistCheckbox).not.toBeNull();
    expect(checklistCheckbox.closest('.note-task-group')).toBeNull();

    // The explicit task sits inside the synced task group
    expect(
      container.querySelector(
        '.note-task-group input[aria-label="Mark task complete"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      checklistCheckbox.click();
    });

    // Does NOT call TASKS_SAVE
    const tasksSaveCalls = invoke.mock.calls.filter(
      (call: any[]) => call[0] === 'TASKS_SAVE',
    );
    expect(
      tasksSaveCalls.some(
        (c: any[]) => c[1].title === 'Discuss project timeline',
      ),
    ).toBe(false);
  });

  it('toggles checkboxes via Cmd+Enter keyboard shortcut in textarea', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    textarea.selectionStart = textarea.selectionEnd = 2; // on "- [ ] Review Q4 goals"

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true,
        }),
      );
    });

    expect(textarea.value).toContain('[task:done: Review Q4 goals]');
  });

  it('toggles checkboxes by clicking directly on the checkbox in the textarea', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    textarea.selectionStart = textarea.selectionEnd = 3; // on [ ]

    await act(async () => {
      textarea.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(textarea.value).toContain('[task:done: Review Q4 goals]');
  });

  it('requires confirmation before deleting a note', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    const deleteBtn = container.querySelector(
      'button[aria-label="Delete note 1:1 with Sarah"]',
    ) as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      deleteBtn.click();
    });

    // Should now show confirmation prompt "Delete?"
    expect(container.textContent).toContain('Delete?');
    const confirmBtn = container.querySelector(
      'button[aria-label="Confirm delete note"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn.click();
    });

    expect(invoke).toHaveBeenCalledWith('NOTES_DELETE', 'note-person');
  });

  it('triggers new note creation via Cmd+N keyboard shortcut', async () => {
    await act(async () => {
      root.render(<NotesView />);
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
    });

    expect(invoke).toHaveBeenCalledWith('NOTES_SAVE', expect.any(Object));
  });

  it('renders rich markdown preview with rendered headings and checkboxes', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // In preview mode (default), note-markdown-render is present
    const markdownPreview = container.querySelector('.note-markdown-render');
    expect(markdownPreview).not.toBeNull();

    // Checkboxes are rendered inside the preview
    const previewCheckboxes = markdownPreview?.querySelectorAll(
      'input[type="checkbox"]',
    );
    expect(previewCheckboxes?.length).toBe(2);

    // List items are rendered
    const listItems = markdownPreview?.querySelectorAll('li');
    expect(listItems?.length).toBe(2);
  });

  it('toggles task in preview mode by clicking the rendered markdown checkbox', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const markdownPreview = container.querySelector('.note-markdown-render');
    const firstCheckbox = markdownPreview?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(firstCheckbox).not.toBeNull();
    expect(firstCheckbox.checked).toBe(false);

    await act(async () => {
      firstCheckbox.click();
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('[task:done: Review Q4 goals]');
  });

  it('renders live canvas directly without raw markdown mode or toolbar noise', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    // The canvas is directly rendered and interactive
    expect(container.querySelector('.note-markdown-render')).not.toBeNull();

    // Raw markdown mode button, toolbar, and edit toggle are eliminated
    expect(
      container.querySelector('button[aria-label="Edit note content"]'),
    ).toBeNull();
    expect(container.querySelector('div[role="toolbar"]')).toBeNull();

    // Blocks are directly editable textareas
    const blockTextarea = container.querySelector(
      '#note-block-0',
    ) as HTMLTextAreaElement;
    expect(blockTextarea).not.toBeNull();
  });

  it('deletes note from header toolbar with confirmation', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    const toolbarDeleteBtn = container.querySelector(
      'button[aria-label="Delete note"]',
    ) as HTMLButtonElement;
    expect(toolbarDeleteBtn).not.toBeNull();

    await act(async () => {
      toolbarDeleteBtn.click();
    });

    expect(container.textContent).toContain('Delete?');
    const confirmBtn = container.querySelector(
      'button[aria-label="Confirm delete active note"]',
    ) as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn.click();
    });

    expect(invoke).toHaveBeenCalledWith('NOTES_DELETE', 'note-person');
  });

  it('keeps document canvas calm without mode switching on double click', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    const markdownPreview = container.querySelector(
      '.note-markdown-render',
    ) as HTMLDivElement;
    expect(markdownPreview).not.toBeNull();

    await act(async () => {
      markdownPreview.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true }),
      );
    });

    // Remains clean and calm without raw toolbar
    const toolbar = container.querySelector('div[role="toolbar"]');
    expect(toolbar).toBeNull();
  });

  it('does not toggle into raw editor mode on Cmd+E', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    expect(container.querySelector('.note-markdown-render')).not.toBeNull();

    // Press Cmd+E
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'e', metaKey: true }),
      );
    });

    // Remains live canvas, no toolbar
    expect(container.querySelector('div[role="toolbar"]')).toBeNull();
    expect(container.querySelector('.note-markdown-render')).not.toBeNull();
  });

  it('transforms block into a task checklist item when typing /task', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });

    // In canvas view, find the first block textarea
    const firstBlockTextarea = container.querySelector(
      '#note-block-0',
    ) as HTMLTextAreaElement;
    expect(firstBlockTextarea).not.toBeNull();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(
        firstBlockTextarea,
        '/task Ship Notion writing feature',
      );
      firstBlockTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The block should now be transformed into a todo block
    const todoCheckbox = container.querySelector(
      'input[aria-label="Mark task complete"]',
    );
    expect(todoCheckbox).not.toBeNull();

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('[task: Ship Notion writing feature]');

    // And it auto-syncs to TASKS_SAVE
    expect(invoke).toHaveBeenCalledWith(
      'TASKS_SAVE',
      expect.objectContaining({
        title: 'Ship Notion writing feature',
        sourceNoteId: 'note-scratchpad',
      }),
    );
  });

  it('refers person via /person and embeds @Name into note', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });

    const firstBlockTextarea = container.querySelector(
      '#note-block-0',
    ) as HTMLTextAreaElement;
    expect(firstBlockTextarea).not.toBeNull();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(firstBlockTextarea, '/person Sarah');
      firstBlockTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('@Sarah Connor');
  });

  it('refers project via /project and embeds #Name into note', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });

    const firstBlockTextarea = container.querySelector(
      '#note-block-0',
    ) as HTMLTextAreaElement;
    expect(firstBlockTextarea).not.toBeNull();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(firstBlockTextarea, '/project Pluto');
      firstBlockTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('#Pluto App');
  });

  it('transforms /task, /person, /project in textarea input', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });

    const textarea = container.querySelector(
      '#note-textarea-editor',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    // Type /task item
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(
        textarea,
        '# Notes\n/task Follow up with team\n/todo Buy coffee\n/person Sarah\n/project Pluto',
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(textarea.value).toContain('[task: Follow up with team]');
    expect(textarea.value).toContain('- [ ] Buy coffee');
    expect(textarea.value).toContain('@Sarah Connor');
    expect(textarea.value).toContain('#Pluto App');
  });

  it('opens slash command menu on typing / and executes /task on Enter', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });

    const firstBlockTextarea = container.querySelector(
      '#note-block-0',
    ) as HTMLTextAreaElement;
    expect(firstBlockTextarea).not.toBeNull();

    // Type "/" to open slash menu
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(firstBlockTextarea, '/');
      firstBlockTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Slash menu is rendered
    const menu = container.querySelector('.slash-command-menu');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Task');
    expect(menu?.textContent).toContain('Person');
    expect(menu?.textContent).toContain('Project');

    // Press Enter to execute the first command (/task)
    await act(async () => {
      firstBlockTextarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    // Slash menu closes and block becomes a todo
    expect(container.querySelector('.slash-command-menu')).toBeNull();
    expect(
      container.querySelector('input[aria-label="Mark task complete"]'),
    ).not.toBeNull();
  });

  it('updates task checkbox live when task status changes in Tasks ledger', async () => {
    let taskStatus: 'active' | 'completed' = 'active';
    const mockInvoke = vi.fn(async (channel: string, payload: any) => {
      if (channel === 'NOTES_LIST') return notes;
      if (channel === 'NOTES_GET')
        return notes.find((n) => n.id === payload) || null;
      if (channel === 'GET_ENTITIES_BY_TYPE') return [];
      if (channel === 'CALENDAR_LIST_DAY') return [];
      if (channel === 'TASKS_LIST') {
        return {
          tasks: [
            {
              entity: {
                id: 'task-q4',
                name: 'Review Q4 goals',
                status: taskStatus,
              },
            },
          ],
        };
      }
      return null;
    });

    (window as any).ipcRenderer.invoke = mockInvoke;

    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    // Note begins in rendered mode: has task checkbox for "Review Q4 goals"
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);

    // External task completion occurs in Tasks ledger (e.g. Dashboard or TasksView)
    taskStatus = 'completed';
    await act(async () => {
      window.dispatchEvent(new Event('pluto:tasks-changed'));
    });

    // Checkbox in note updates to checked automatically
    expect(checkbox.checked).toBe(true);
  });

  it('extractNoteTitleAndBlocks dedupes leading H1 title from body content', () => {
    // 1. Matches existing title -> strips H1
    const res1 = extractNoteTitleAndBlocks(
      'Daily Scratchpad',
      '# Daily Scratchpad\n\nJot down thoughts here.',
      'scratchpad',
    );
    expect(res1.title).toBe('Daily Scratchpad');
    expect(res1.blocks[0].text).toBe('Jot down thoughts here.');
    expect(res1.blocks.some((b) => b.type === 'h1')).toBe(false);

    // 2. Empty title -> promotes H1 to title and strips from body
    const res2 = extractNoteTitleAndBlocks(
      '',
      '# Project Roadmap\n\n- [ ] Q1 Goals',
      'general',
    );
    expect(res2.title).toBe('Project Roadmap');
    expect(res2.blocks[0].text).toBe('Q1 Goals');

    // 3. Scratchpad noteType with H1 "daily scratchpad"
    const res3 = extractNoteTitleAndBlocks(
      'Scratchpad',
      '# Daily Scratchpad\n\nFirst line',
      'scratchpad',
    );
    expect(res3.blocks[0].text).toBe('First line');
  });

  it('links and unlinks a person or project using the improved entity picker', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });

    // Initially unlinked
    const linkBtn = container.querySelector(
      'button[aria-label="Link note to person or project"]',
    ) as HTMLButtonElement;
    expect(linkBtn).not.toBeNull();

    // Open popover
    await act(async () => {
      linkBtn.click();
    });

    const searchInput = container.querySelector(
      'input[placeholder="Search people & projects..."]',
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    // Search for Sarah
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(searchInput, 'Sarah');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Select Sarah Connor
    const sarahBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Sarah Connor'),
    ) as HTMLButtonElement;
    expect(sarahBtn).toBeDefined();

    await act(async () => {
      sarahBtn.click();
    });

    // Linked badge should now be visible
    expect(container.textContent).toContain('Sarah Connor');
    expect(container.textContent).toContain('person');

    // Click unlink button
    const unlinkBtn = container.querySelector(
      'button[aria-label="Unlink Sarah Connor"]',
    ) as HTMLButtonElement;
    expect(unlinkBtn).not.toBeNull();

    await act(async () => {
      unlinkBtn.click();
    });

    // Returns to unlinked state
    expect(
      container.querySelector(
        'button[aria-label="Link note to person or project"]',
      ),
    ).not.toBeNull();
  });

  it('wraps tasks in their own container, separate from checklists', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });

    const taskRow = container.querySelector('[data-block-type="task"]');
    const todoRow = container.querySelector('[data-block-type="todo"]');
    expect(taskRow?.getAttribute('data-task-run')).toBe('single');
    expect(taskRow?.classList.contains('note-task-group')).toBe(true);
    expect(taskRow?.textContent).toContain('Tasks');
    expect(todoRow?.hasAttribute('data-task-run')).toBe(false);
    expect(todoRow?.classList.contains('note-task-group')).toBe(false);
    // Tasks show once, inline; there is no duplicate summary list below.
    expect(
      container.querySelector('[aria-label="Interactive checklist"]'),
    ).toBeNull();
  });

  it('keeps the title on one line and moves into the note on Enter', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    const title = container.querySelector(
      'textarea[aria-label="Note title"]',
    ) as HTMLTextAreaElement;
    title.focus();

    await act(async () => {
      title.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(title.value).not.toContain('\n');
    expect(document.activeElement?.id).toBe('note-block-0');
  });

  it('hides the context rail when there is nothing to show', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });
    expect(
      container.querySelector(
        'aside[aria-label="Context & Upcoming Meetings"]',
      ),
    ).toBeNull();
  });

  it('opens the block menu from the handle and duplicates or moves blocks', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    const content = () =>
      (container.querySelector('#note-textarea-editor') as HTMLTextAreaElement)
        .value;

    const handle = container.querySelector(
      'button[aria-label="Block actions"]',
    ) as HTMLButtonElement;
    await act(async () => {
      handle.click();
    });
    const menu = container.querySelector(
      '[aria-label="Block actions"][role="menu"]',
    );
    expect(menu?.textContent).toContain('Turn into');

    const duplicate = Array.from(menu!.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('Duplicate'),
    ) as HTMLButtonElement;
    await act(async () => {
      duplicate.click();
    });
    expect(content()).toBe(
      '[task: Review Q4 goals]\n[task: Review Q4 goals]\n- [ ] Discuss project timeline',
    );

    // Cmd+Shift+Up moves the checklist item to the top
    const last = container.querySelector(
      '#note-block-2',
    ) as HTMLTextAreaElement;
    await act(async () => {
      last.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(content().split('\n')[1]).toBe('- [ ] Discuss project timeline');
  });

  const typeInto = async (el: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('keeps the focused block mounted through autosave and the notes refresh', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    const first = container.querySelector(
      '#note-block-1',
    ) as HTMLTextAreaElement;
    first.focus();
    first.setSelectionRange(first.value.length, first.value.length);
    // Enter creates a brand-new block, then the user keeps typing in it.
    await act(async () => {
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    const editor = container.querySelector(
      '#note-block-2',
    ) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);
    await typeInto(editor, 'Share the budget');

    // Let the debounced autosave run; it fires a notes-changed refresh.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(invoke).toHaveBeenCalledWith(
      'NOTES_SAVE',
      expect.objectContaining({
        content:
          '[task: Review Q4 goals]\n- [ ] Discuss project timeline\n- [ ] Share the budget',
      }),
    );

    expect(container.querySelector('#note-block-2')).toBe(editor);
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('Share the budget');
  });

  it('merges outside note changes without remounting the editors', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    const editor = container.querySelector(
      '#note-block-1',
    ) as HTMLTextAreaElement;

    // e.g. the task was completed from the Tasks view
    notes = notes.map((n) =>
      n.id === 'note-person'
        ? {
            ...n,
            content:
              '[task:done: Review Q4 goals]\n- [ ] Discuss project timeline',
          }
        : n,
    );
    await act(async () => {
      window.dispatchEvent(new Event('pluto:notes-changed'));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container.querySelector('#note-block-1')).toBe(editor);
    expect(
      container.querySelector('input[aria-label="Mark task incomplete"]'),
    ).not.toBeNull();
  });

  it('moves focus to the new block as soon as Enter is handled', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    const editor = container.querySelector(
      '#note-block-1',
    ) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    // No timers have run yet: focus must already be on the new block.
    expect(document.activeElement?.id).toBe('note-block-2');
  });

  it('keeps the selection when bolding with Cmd+B', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    const editor = container.querySelector(
      '#note-block-1',
    ) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 7);
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'b',
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(editor.value).toBe('**Discuss** project timeline');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 9]);
  });

  it('keeps focus when a block changes type', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-person" />);
    });
    const first = container.querySelector(
      '#note-block-1',
    ) as HTMLTextAreaElement;
    first.focus();
    first.setSelectionRange(first.value.length, first.value.length);
    await act(async () => {
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    // Enter on the new, empty checklist item turns it into plain text.
    const empty = document.activeElement as HTMLTextAreaElement;
    expect(empty.id).toBe('note-block-2');
    await act(async () => {
      empty.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(
      container.querySelector('[data-block-type="paragraph"] #note-block-2'),
    ).not.toBeNull();
    expect(document.activeElement?.id).toBe('note-block-2');

    // Typing "- " turns plain text into a bullet without losing the caret.
    const para = document.activeElement as HTMLTextAreaElement;
    await typeInto(para, '- ');
    expect(
      container.querySelector('[data-block-type="bullet"] #note-block-2'),
    ).not.toBeNull();
    expect(document.activeElement?.id).toBe('note-block-2');
  });

  describe('Ask Pluto in a note', () => {
    const answerWith = (response: unknown) => {
      const base = invoke.getMockImplementation();
      invoke.mockImplementation(async (channel: string, payload: any) =>
        channel === 'intelligence:note-chat'
          ? response
          : base?.(channel, payload),
      );
    };
    const content = () =>
      (container.querySelector('#note-textarea-editor') as HTMLTextAreaElement)
        .value;
    const buttonByText = (text: string) =>
      [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes(text),
      ) as HTMLButtonElement;

    it('suggests tasks and adds only the approved ones as synced tasks', async () => {
      answerWith({
        status: 'answered',
        answer: '- Send recap\n- Book review',
        suggestedTasks: ['Send recap', 'Book review'],
      });
      await act(async () => {
        root.render(<NotesView initialNoteId="note-person" />);
      });
      await act(async () => {
        (
          container.querySelector(
            'button[aria-label="Ask Pluto about this note"]',
          ) as HTMLButtonElement
        ).click();
      });
      expect(
        container.querySelector(
          'aside[aria-label="Ask Pluto about this note"]',
        ),
      ).not.toBeNull();

      await act(async () => {
        buttonByText('Pull out tasks').click();
      });
      expect(invoke).toHaveBeenCalledWith(
        'intelligence:note-chat',
        expect.objectContaining({ noteId: 'note-person', intent: 'tasks' }),
      );

      // Both suggestions start approved; the user unticks one.
      const bookReview = [
        ...container.querySelectorAll<HTMLInputElement>(
          '.note-ask-panel__suggestions input',
        ),
      ].find((input) =>
        input.closest('label')?.textContent?.includes('Book review'),
      ) as HTMLInputElement;
      await act(async () => {
        bookReview.click();
      });
      await act(async () => {
        buttonByText('Add 1 task to note').click();
      });

      expect(content()).toContain('[task: Send recap]');
      expect(content()).not.toContain('Book review');
      expect(container.textContent).toContain(
        'Added to the note and your Tasks list',
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
      expect(invoke).toHaveBeenCalledWith(
        'TASKS_SAVE',
        expect.objectContaining({
          title: 'Send recap',
          sourceNoteId: 'note-person',
        }),
      );
    });

    it('asks about selected text with ⌘J and inserts the answer below it', async () => {
      answerWith({ status: 'answered', answer: '**Owner:** Sarah' });
      await act(async () => {
        root.render(<NotesView initialNoteId="note-person" />);
      });
      const first = container.querySelector(
        '#note-block-0',
      ) as HTMLTextAreaElement;
      await act(async () => {
        first.focus();
        first.setSelectionRange(0, 6);
      });
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'j',
            metaKey: true,
            bubbles: true,
          }),
        );
      });
      expect(container.textContent).toContain('Asking about your selection');

      const composer = container.querySelector(
        'textarea[aria-label="Ask about this note"]',
      ) as HTMLTextAreaElement;
      expect(document.activeElement).toBe(composer);
      await typeInto(composer, 'Who owns this?');
      await act(async () => {
        composer.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(invoke).toHaveBeenCalledWith(
        'intelligence:note-chat',
        expect.objectContaining({
          intent: 'ask',
          query: 'Who owns this?',
          selection: 'Review',
        }),
      );

      await act(async () => {
        buttonByText('Insert into note').click();
      });
      expect(content().split('\n').slice(0, 2)).toEqual([
        '[task: Review Q4 goals]',
        '**Owner:** Sarah',
      ]);
      expect(buttonByText('Inserted')).toBeDefined();

      // Escape closes the panel.
      const composerAgain = container.querySelector(
        'textarea[aria-label="Ask about this note"]',
      ) as HTMLTextAreaElement;
      await act(async () => {
        composerAgain.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(
        container.querySelector(
          'aside[aria-label="Ask Pluto about this note"]',
        ),
      ).toBeNull();
    });

    it('says when a smaller model answered because memory was low', async () => {
      answerWith({
        status: 'answered',
        answer: 'Short summary.',
        fallbackModel: 'llama3.2:3b',
      });
      await act(async () => {
        root.render(<NotesView initialNoteId="note-person" />);
      });
      await act(async () => {
        (
          container.querySelector(
            'button[aria-label="Ask Pluto about this note"]',
          ) as HTMLButtonElement
        ).click();
      });
      await act(async () => {
        buttonByText('Summarize').click();
      });
      expect(container.textContent).toContain('Short summary.');
      expect(container.textContent).toContain(
        'Answered by the smaller llama3.2:3b model',
      );
    });

    it('shows the error and lets the user try again', async () => {
      answerWith({
        status: 'unavailable',
        answer: '',
        error: 'Pluto could not reach your AI model.',
        detail: 'TypeError: fetch failed',
      });
      await act(async () => {
        root.render(<NotesView initialNoteId="note-person" />);
      });
      await act(async () => {
        (
          container.querySelector(
            'button[aria-label="Ask Pluto about this note"]',
          ) as HTMLButtonElement
        ).click();
      });
      await act(async () => {
        buttonByText('Summarize').click();
      });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'Pluto could not reach your AI model.',
      );
      expect(
        container.querySelector('[role="alert"] details code')?.textContent,
      ).toBe('TypeError: fetch failed');

      answerWith({ status: 'answered', answer: 'Short summary.' });
      await act(async () => {
        buttonByText('Try again').click();
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain('Short summary.');
      // The retried question appears once, not twice.
      expect(
        container.querySelectorAll('.note-ask-panel__question'),
      ).toHaveLength(1);
    });
  });

  it('moves the slash menu highlight with the arrow keys and keeps it visible', async () => {
    await act(async () => {
      root.render(<NotesView initialNoteId="note-scratchpad" />);
    });
    const block = [
      ...container.querySelectorAll<HTMLTextAreaElement>(
        '[data-block-type="paragraph"] textarea',
      ),
    ].at(-1) as HTMLTextAreaElement;
    block.focus();
    await typeInto(block, '/');
    const menu = container.querySelector(
      '[role="menu"][aria-label="Slash commands"]',
    ) as HTMLElement;
    expect(menu).not.toBeNull();
    const scrolls: number[] = [];
    const items = () => [
      ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    // Pretend the menu shows ~3 items so later ones sit below the fold.
    menu.getBoundingClientRect = () =>
      ({ top: 0, bottom: 120, height: 120 }) as DOMRect;
    items().forEach((item, i) => {
      item.getBoundingClientRect = () =>
        ({
          top: i * 40 - menu.scrollTop,
          bottom: i * 40 + 40 - menu.scrollTop,
          height: 40,
        }) as DOMRect;
    });
    Object.defineProperty(menu, 'scrollTop', {
      configurable: true,
      get: () => scrolls.at(-1) ?? 0,
      set: (value: number) => scrolls.push(value),
    });

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        block.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }

    const selected = menu.querySelectorAll('[data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(items().indexOf(selected[0] as HTMLElement)).toBe(5);
    // Item 5 spans 200-240px, so the menu scrolls to show its bottom edge.
    expect(menu.scrollTop).toBe(126);
  });

  describe('selecting several blocks', () => {
    const renderMulti = async (content = 'One\nTwo\nThree\nFour') => {
      notes.push({
        id: 'note-multi',
        title: 'Multi',
        content,
        noteType: 'general',
        pinned: false,
        targetId: null,
        targetName: null,
        createdAt: '2026-10-21T10:00:00.000Z',
        updatedAt: '2026-10-21T10:00:00.000Z',
      });
      await act(async () => {
        root.render(<NotesView initialNoteId="note-multi" />);
      });
    };
    const canvas = () =>
      container.querySelector('.note-block-canvas') as HTMLDivElement;
    const content = () =>
      (container.querySelector('#note-textarea-editor') as HTMLTextAreaElement)
        .value;
    const selectedTexts = () =>
      [...container.querySelectorAll('.note-block-row.is-selected')].map(
        (row) => (row.querySelector('textarea') as HTMLTextAreaElement).value,
      );
    const press = async (
      target: Element,
      key: string,
      init: KeyboardEventInit = {},
    ) => {
      await act(async () => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      });
    };
    const clipboard = async (type: 'copy' | 'cut' | 'paste', text = '') => {
      const store: Record<string, string> = { 'text/plain': text };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        clipboardData: {
          setData: (format: string, value: string) => {
            store[format] = value;
          },
          getData: (format: string) => store[format] ?? '',
        },
      });
      await act(async () => {
        canvas().dispatchEvent(event);
      });
      return store['text/plain'];
    };

    it('extends from a block with Shift+Arrow and deletes the selection', async () => {
      await renderMulti();
      const first = container.querySelector(
        '#note-block-0',
      ) as HTMLTextAreaElement;
      first.focus();
      first.setSelectionRange(3, 3);
      await press(first, 'ArrowDown', { shiftKey: true });
      expect(selectedTexts()).toEqual(['One', 'Two']);
      expect(document.activeElement).toBe(canvas());

      await press(canvas(), 'ArrowDown', { shiftKey: true });
      expect(selectedTexts()).toEqual(['One', 'Two', 'Three']);
      await press(canvas(), 'ArrowUp', { shiftKey: true });
      expect(selectedTexts()).toEqual(['One', 'Two']);

      await press(canvas(), 'Backspace');
      expect(content()).toBe('Three\nFour');
      expect(selectedTexts()).toEqual([]);
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(document.activeElement?.id).toBe('note-block-0');
    });

    it('copies, cuts and pastes selected blocks as Markdown', async () => {
      await renderMulti('# Plan\n- Ship it\n[task: Send recap]\nLast');
      const second = container.querySelector(
        '#note-block-1',
      ) as HTMLTextAreaElement;
      second.focus();
      await press(second, 'Escape');
      await press(canvas(), 'ArrowDown', { shiftKey: true });
      expect(await clipboard('copy')).toBe('- Ship it\n[task: Send recap]');

      expect(await clipboard('cut')).toBe('- Ship it\n[task: Send recap]');
      expect(content()).toBe('# Plan\nLast');

      // Esc on the last block, then paste two lines over it.
      const last = container.querySelector(
        '#note-block-1',
      ) as HTMLTextAreaElement;
      last.focus();
      await press(last, 'Escape');
      await clipboard('paste', '- [ ] One\n- [ ] Two\n');
      expect(content()).toBe('# Plan\n- [ ] One\n- [ ] Two');
    });

    it('selects everything with a second ⌘A, and moves or duplicates the selection', async () => {
      await renderMulti();
      const first = container.querySelector(
        '#note-block-0',
      ) as HTMLTextAreaElement;
      first.focus();
      first.setSelectionRange(0, 3);
      await press(first, 'a', { metaKey: true });
      expect(selectedTexts()).toEqual(['One', 'Two', 'Three', 'Four']);

      await press(canvas(), 'Escape');
      expect(selectedTexts()).toEqual([]);

      const second = container.querySelector(
        '#note-block-1',
      ) as HTMLTextAreaElement;
      second.focus();
      await press(second, 'Escape');
      await press(canvas(), 'ArrowDown', { shiftKey: true });
      await press(canvas(), 'ArrowDown', { metaKey: true, shiftKey: true });
      expect(content()).toBe('One\nFour\nTwo\nThree');
      expect(selectedTexts()).toEqual(['Two', 'Three']);

      await press(canvas(), 'd', { metaKey: true });
      expect(content()).toBe('One\nFour\nTwo\nThree\nTwo\nThree');
      expect(
        [...container.querySelectorAll('.note-block-row.is-selected')].map(
          (row) => row.getAttribute('data-block-index'),
        ),
      ).toEqual(['4', '5']);
    });

    it('selects blocks by dragging from one block into another', async () => {
      await renderMulti();
      const rows = [
        ...container.querySelectorAll<HTMLElement>('.note-block-row'),
      ];
      rows.forEach((row, i) => {
        row.getBoundingClientRect = () =>
          ({ top: i * 30, bottom: i * 30 + 30, height: 30 }) as DOMRect;
      });
      const first = container.querySelector(
        '#note-block-0',
      ) as HTMLTextAreaElement;
      await act(async () => {
        first.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
            buttons: 1,
            clientY: 10,
          }),
        );
      });
      // Moving within the first block keeps normal text selection.
      await act(async () => {
        window.dispatchEvent(
          new MouseEvent('mousemove', { buttons: 1, clientY: 20 }),
        );
      });
      expect(selectedTexts()).toEqual([]);

      await act(async () => {
        window.dispatchEvent(
          new MouseEvent('mousemove', { buttons: 1, clientY: 75 }),
        );
      });
      expect(selectedTexts()).toEqual(['One', 'Two', 'Three']);
      await act(async () => {
        window.dispatchEvent(new MouseEvent('mouseup', {}));
      });
      expect(document.activeElement).toBe(canvas());
      expect(container.textContent).toContain('3 blocks selected');
    });

    it('asks Pluto about the selected blocks', async () => {
      const base = invoke.getMockImplementation();
      invoke.mockImplementation(async (channel: string, payload: any) =>
        channel === 'intelligence:note-chat'
          ? { status: 'answered', answer: 'Two things.' }
          : base?.(channel, payload),
      );
      await renderMulti();
      const second = container.querySelector(
        '#note-block-1',
      ) as HTMLTextAreaElement;
      second.focus();
      await press(second, 'Escape');
      await press(canvas(), 'ArrowDown', { shiftKey: true });
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'j',
            metaKey: true,
            bubbles: true,
          }),
        );
      });
      expect(container.textContent).toContain('Asking about 2 selected blocks');
      const summarize = [...container.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Summarize'),
      ) as HTMLButtonElement;
      await act(async () => {
        summarize.click();
      });
      expect(invoke).toHaveBeenCalledWith(
        'intelligence:note-chat',
        expect.objectContaining({ selection: 'Two\nThree' }),
      );
    });
  });

  describe('undo and redo', () => {
    const renderNote = async (content: string, id = 'note-undo') => {
      notes.push({
        id,
        title: 'Undo',
        content,
        noteType: 'general',
        pinned: false,
        targetId: null,
        targetName: null,
        createdAt: '2026-10-21T10:00:00.000Z',
        updatedAt: '2026-10-21T10:00:00.000Z',
      });
      await act(async () => {
        root.render(<NotesView initialNoteId={id} />);
      });
    };
    const content = () =>
      (container.querySelector('#note-textarea-editor') as HTMLTextAreaElement)
        .value;
    const block = (i: number) =>
      container.querySelector(`#note-block-${i}`) as HTMLTextAreaElement;
    const press = async (
      target: Element,
      key: string,
      init: KeyboardEventInit = {},
    ) => {
      await act(async () => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      });
    };
    const nextFrame = () =>
      act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

    it('undoes a burst of typing in one step and redoes it', async () => {
      await renderNote('Hello\nSecond');
      const first = block(0);
      first.focus();
      first.setSelectionRange(5, 5);
      await typeInto(first, 'Hello w');
      await typeInto(first, 'Hello wo');
      await typeInto(first, 'Hello world');
      expect(content()).toBe('Hello world\nSecond');

      await press(first, 'z', { metaKey: true });
      expect(content()).toBe('Hello\nSecond');
      await nextFrame();
      expect(document.activeElement).toBe(block(0));
      expect(block(0).selectionStart).toBe(5);

      await press(block(0), 'z', { metaKey: true, shiftKey: true });
      expect(content()).toBe('Hello world\nSecond');
      await press(block(0), 'z', { metaKey: true });
      await press(block(0), 'y', { metaKey: true });
      expect(content()).toBe('Hello world\nSecond');
    });

    it('undoes splitting a block with Enter and puts the cursor back', async () => {
      await renderNote('OneTwo\nThree');
      const first = block(0);
      first.focus();
      first.setSelectionRange(3, 3);
      await press(first, 'Enter');
      expect(content()).toBe('One\nTwo\nThree');

      await nextFrame();
      await press(document.activeElement as Element, 'z', { metaKey: true });
      expect(content()).toBe('OneTwo\nThree');
      await nextFrame();
      expect(document.activeElement).toBe(block(0));
      expect([block(0).selectionStart, block(0).selectionEnd]).toEqual([3, 3]);
    });

    it('brings back deleted blocks', async () => {
      await renderNote('One\nTwo\nThree');
      const second = block(1);
      second.focus();
      await press(second, 'Escape');
      const canvas = container.querySelector(
        '.note-block-canvas',
      ) as HTMLDivElement;
      await press(canvas, 'ArrowDown', { shiftKey: true });
      await press(canvas, 'Backspace');
      expect(content()).toBe('One');

      await nextFrame();
      await press(document.activeElement as Element, 'z', { metaKey: true });
      expect(content()).toBe('One\nTwo\nThree');
    });

    it('handles Undo from the app’s Edit menu', async () => {
      await renderNote('Draft');
      const first = block(0);
      first.focus();
      first.setSelectionRange(5, 5);
      await typeInto(first, 'Draft two');
      const event = new Event('beforeinput', {
        bubbles: true,
        cancelable: true,
      });
      Object.assign(event, { inputType: 'historyUndo' });
      await act(async () => {
        first.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(content()).toBe('Draft');
    });

    it('starts each note with its own history', async () => {
      await renderNote('First note');
      const first = block(0);
      first.focus();
      await typeInto(first, 'First note edited');

      const other = [...container.querySelectorAll('.note-sidebar-item')].find(
        (el) => el.textContent?.includes('1:1 with Sarah'),
      ) as HTMLElement;
      await act(async () => {
        other.click();
      });
      const target = block(0);
      target.focus();
      await press(target, 'z', { metaKey: true });
      expect(content()).toContain('Review Q4 goals');
      expect(content()).not.toContain('First note');
    });
  });
});
