// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as knowledgeGraphApi from '../../src/api/knowledgeGraph';
import { RecordingMeetingRail } from '../../src/components/features/RecordingMeetingRail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enterText = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('RecordingMeetingRail Participants Dropdown', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockPeople = [
    { id: 'person-1', name: 'Avery Chen', aliases: ['Aves'] },
    { id: 'person-2', name: 'Maya Ortiz' },
    { id: 'person-3', name: 'Jordan Lee' },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders SearchSelect with placeholder "Add a person"', async () => {
    await act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Sprint Review"
          onTitleChange={() => {}}
          participants={[]}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
          people={mockPeople}
        />,
      );
    });

    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Add a person');
    expect(input.getAttribute('aria-label')).toBe('Add participant');
  });

  it('suggests eligible people from dictionary and excludes already added participants', async () => {
    await act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Sprint Review"
          onTitleChange={() => {}}
          participants={['Avery Chen']}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
          people={mockPeople}
        />,
      );
    });

    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
    });

    // Avery Chen is already added, so only Maya and Jordan should be suggested
    expect(document.body.textContent).toContain('Maya Ortiz');
    expect(document.body.textContent).toContain('Jordan Lee');
    expect(
      document.querySelector('[role="listbox"]')?.textContent,
    ).not.toContain('Avery Chen');
  });

  it('selects an existing person and calls onAddParticipant, clearing the input', async () => {
    const onAddParticipant = vi.fn();
    await act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Sprint Review"
          onTitleChange={() => {}}
          participants={[]}
          onAddParticipant={onAddParticipant}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
          people={mockPeople}
        />,
      );
    });

    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      enterText(input, 'Maya');
    });

    expect(document.body.textContent).toContain('Maya Ortiz');

    const optionButton = document.querySelector(
      '[role="option"][data-value="person-2"]',
    ) as HTMLButtonElement;
    expect(optionButton).not.toBeNull();

    await act(async () => {
      optionButton.click();
    });

    expect(onAddParticipant).toHaveBeenCalledWith('Maya Ortiz');
    expect(input.value).toBe('');
  });

  it('shows create option for a new person and creates person entity on click', async () => {
    const onAddParticipant = vi.fn();
    const upsertSpy = vi
      .spyOn(knowledgeGraphApi, 'upsertEntity')
      .mockResolvedValue({
        id: 'person-new',
        type: 'person',
        name: 'Samira Khan',
        normalized_name: 'samira khan',
        status: 'active',
        due_date: null,
        assigned_to: null,
        metadata: null,
        saliency_score: 1,
        domain_tag: 'work',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    await act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Sprint Review"
          onTitleChange={() => {}}
          participants={[]}
          onAddParticipant={onAddParticipant}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
          people={mockPeople}
        />,
      );
    });

    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      enterText(input, 'Samira Khan');
    });

    expect(document.body.textContent).toContain('Create “Samira Khan”');
    expect(document.body.textContent).toContain('New person');

    const createButton = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((el) =>
      el.textContent?.includes('Create “Samira Khan”'),
    ) as HTMLButtonElement;
    expect(createButton).not.toBeNull();

    await act(async () => {
      createButton.click();
    });

    expect(onAddParticipant).toHaveBeenCalledWith('Samira Khan');
    expect(upsertSpy).toHaveBeenCalledWith({
      type: 'person',
      name: 'Samira Khan',
      status: 'active',
    });
    expect(input.value).toBe('');
  });

  it('creates new person on Enter keypress and clears the input', async () => {
    const onAddParticipant = vi.fn();
    const upsertSpy = vi
      .spyOn(knowledgeGraphApi, 'upsertEntity')
      .mockResolvedValue({
        id: 'person-alex',
        type: 'person',
        name: 'Alex Rivera',
        normalized_name: 'alex rivera',
        status: 'active',
        due_date: null,
        assigned_to: null,
        metadata: null,
        saliency_score: 1,
        domain_tag: 'work',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    await act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Sprint Review"
          onTitleChange={() => {}}
          participants={[]}
          onAddParticipant={onAddParticipant}
          onRemoveParticipant={() => {}}
          notes=""
          onNotesChange={() => {}}
          people={mockPeople}
        />,
      );
    });

    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      enterText(input, 'Alex Rivera');
    });

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    expect(onAddParticipant).toHaveBeenCalledWith('Alex Rivera');
    expect(upsertSpy).toHaveBeenCalledWith({
      type: 'person',
      name: 'Alex Rivera',
      status: 'active',
    });
    expect(input.value).toBe('');
  });

  it('removes participant when remove chip button is clicked', async () => {
    const onRemoveParticipant = vi.fn();
    await act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Sprint Review"
          onTitleChange={() => {}}
          participants={['Avery Chen', 'Maya Ortiz']}
          onAddParticipant={() => {}}
          onRemoveParticipant={onRemoveParticipant}
          notes=""
          onNotesChange={() => {}}
          people={mockPeople}
        />,
      );
    });

    const removeMayaButton = container.querySelector(
      'button[aria-label="Remove Maya Ortiz"]',
    ) as HTMLButtonElement;
    expect(removeMayaButton).not.toBeNull();

    await act(async () => {
      removeMayaButton.click();
    });

    expect(onRemoveParticipant).toHaveBeenCalledWith(1);
  });
});

describe('RecordingMeetingRail note suggestion', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
      invoke: vi.fn(async (channel: string) =>
        channel === 'NOTES_LIST'
          ? [
              {
                id: 'vendor',
                title: 'Vendor eval',
                content: '- [ ] Data residency',
                noteType: 'general',
                targetName: 'Dana Ortiz',
                pinned: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ]
          : [],
      ),
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    (window as unknown as { ipcRenderer?: unknown }).ipcRenderer = undefined;
    vi.restoreAllMocks();
  });

  const render = (onNotesChange: (value: string) => void, notes = '') =>
    act(async () => {
      root.render(
        <RecordingMeetingRail
          title="Acme call"
          onTitleChange={() => {}}
          participants={['Dana Ortiz']}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          notes={notes}
          onNotesChange={onNotesChange}
          people={[]}
        />,
      );
    });

  it('offers a recent note about someone in the meeting and uses it', async () => {
    const onNotesChange = vi.fn();
    await render(onNotesChange, 'Intro');
    expect(container.textContent).toContain(
      'Use your “Vendor eval” note for this meeting?',
    );
    const use = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Use it',
    )!;
    await act(async () => use.click());
    expect(onNotesChange).toHaveBeenCalledWith('Intro\n\n- [ ] Data residency');
    expect(container.textContent).not.toContain('Use your “Vendor eval”');
  });

  it('goes away with Not now', async () => {
    const onNotesChange = vi.fn();
    await render(onNotesChange);
    const skip = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Not now',
    )!;
    await act(async () => skip.click());
    expect(container.textContent).not.toContain('Use your');
    expect(onNotesChange).not.toHaveBeenCalled();
  });
});
