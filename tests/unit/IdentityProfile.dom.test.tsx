// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityState } from '../../src/api/identity';
import { SetupWizard } from '../../src/components/Setup/SetupWizard';
import { IdentityProfileForm } from '../../src/components/features/IdentityProfileForm';
import { IdentityProfileInvitation } from '../../src/components/features/IdentityProfileInvitation';
import { emptyIdentityProfile } from '../../src/types/identity';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const initial = (): IdentityState => ({
  selfPersonId: null,
  people: [],
  revision: 4,
  profile: emptyIdentityProfile(),
});
const readiness = {
  ready: true,
  details: {
    parakeetClient: true,
    parakeetModel: true,
    parakeetEouReady: true,
    audiocapExists: true,
    audiocapExecutable: true,
    micPermission: true,
    systemAudioPermission: true,
  },
};

describe('About you form and invitation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let invoke: ReturnType<typeof vi.fn>;
  let savedStep: string;
  let profileState: IdentityState;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    savedStep = '3';
    profileState = initial();
    invoke = vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'GET_SETTING')
        return payload === 'setup_step' ? savedStep : null;
      if (channel === 'GET_IDENTITY_STATE') return profileState;
      if (channel === 'SAVE_IDENTITY_PROFILE') {
        const data = payload as IdentityState['profile'];
        profileState = {
          ...profileState,
          revision: profileState.revision + 1,
          profile: {
            preferredName: data.preferredName,
            aliases: data.aliases,
            useCases: data.useCases,
            role: data.role,
            industry: data.industry,
            disposition: 'completed',
          },
        };
        return profileState;
      }
      if (channel === 'DISMISS_IDENTITY_PROFILE') {
        profileState = {
          ...profileState,
          revision: profileState.revision + 1,
          profile: { ...profileState.profile, disposition: 'dismissed' },
        };
        return profileState;
      }
      if (channel.startsWith('RECORDING_READINESS')) return readiness;
      return true;
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => {}) },
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (item) =>
        item.textContent?.trim() === label ||
        item.getAttribute('aria-label') === label,
    );
    expect(button, label).toBeTruthy();
    await act(async () => button?.click());
  };
  const text = async (label: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
    expect(input, label).toBeTruthy();
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('saves optional context and names through visible labelled fields', async () => {
    await act(async () =>
      root.render(<IdentityProfileForm initialState={initial()} />),
    );
    await text('Preferred name', 'Morgan');
    await text('Alternate name', 'Mo');
    await click('Add name');
    await click('Work');
    await click('Study');
    await text('Role or field', 'Engineering');
    await text('Industry', 'Education');
    await click('Save about you');
    expect(invoke).toHaveBeenCalledWith('SAVE_IDENTITY_PROFILE', {
      preferredName: 'Morgan',
      aliases: ['Mo'],
      useCases: ['work', 'study'],
      role: 'Engineering',
      industry: 'Education',
      expectedRevision: 4,
    });
    expect(container.textContent).toContain('Saved');
    expect(container.textContent).toContain('future terminology');
    expect(container.textContent).not.toContain('never leaves');
  });

  it('scopes light form colors to onboarding even when the workspace theme is dark', async () => {
    document.documentElement.classList.add('dark');
    try {
      await act(async () => root.render(<SetupWizard onComplete={vi.fn()} />));
      const section = container.querySelector<HTMLElement>(
        'section[aria-label="About you setup"]',
      );
      expect(section?.style.getPropertyValue('--pro-text-main')).toBe(
        '220 20% 20%',
      );
      expect(section?.style.getPropertyValue('--pro-bg')).toBe('45 25% 96%');
      expect(section?.style.getPropertyValue('--pro-surface')).toBe(
        '45 22% 93%',
      );
      expect(section?.style.getPropertyValue('--pro-border')).toBe(
        '45 12% 80%',
      );
      expect(section?.style.getPropertyValue('--pro-accent')).toBe(
        '212 80% 42%',
      );
      expect(section?.style.colorScheme).toBe('light');
      expect(
        document.documentElement.style.getPropertyValue('--pro-text-main'),
      ).toBe('');
      expect(container.querySelector('form .text-pro-text-muted')).toBeNull();
      expect(
        container
          .querySelector('form p')
          ?.classList.contains('text-pro-text-main/75'),
      ).toBe(true);
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('keeps the shared settings form theme-aware and uses readable helper tones', async () => {
    await act(async () =>
      root.render(<IdentityProfileForm initialState={initial()} />),
    );
    expect(container.querySelector('[style*="--pro-"]')).toBeNull();
    expect(container.querySelector('form .text-pro-text-muted')).toBeNull();
    expect(
      container
        .querySelector('form p')
        ?.classList.contains('text-pro-text-main/75'),
    ).toBe(true);
  });

  it('uses the readable helper tone on the returning invitation', async () => {
    await act(async () =>
      root.render(<IdentityProfileInvitation onOpenSettings={vi.fn()} />),
    );
    expect(
      container
        .querySelector('aside')
        ?.classList.contains('text-pro-text-main/75'),
    ).toBe(true);
  });

  it('makes clearing an existing identity explicit while retaining context', async () => {
    profileState = {
      ...initial(),
      selfPersonId: 'person-self',
      profile: {
        ...emptyIdentityProfile(),
        preferredName: 'Morgan',
        role: 'Research',
      },
    };
    await act(async () =>
      root.render(<IdentityProfileForm initialState={profileState} />),
    );
    await text('Preferred name', '');
    expect(container.textContent).toContain('clears your self identity');
    await click('Clear identity and save');
    expect(invoke).toHaveBeenCalledWith(
      'SAVE_IDENTITY_PROFILE',
      expect.objectContaining({ preferredName: '', role: 'Research' }),
    );
  });

  it('limits alternate names and exposes bounded bounds for all text fields', async () => {
    profileState.profile.aliases = Array.from(
      { length: 12 },
      (_, index) => `Name ${index}`,
    );
    await act(async () =>
      root.render(<IdentityProfileForm initialState={profileState} />),
    );
    await text('Alternate name', 'Another');
    await click('Add name');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'up to 12',
    );
    expect(
      container.querySelectorAll('ul[aria-label="Alternate names"] li'),
    ).toHaveLength(12);
    for (const label of ['Preferred name', 'Alternate name'])
      expect(
        container.querySelector<HTMLInputElement>(
          `input[aria-label="${label}"]`,
        )?.maxLength,
      ).toBe(200);
    for (const label of ['Role or field', 'Industry'])
      expect(
        container.querySelector<HTMLInputElement>(
          `input[aria-label="${label}"]`,
        )?.maxLength,
      ).toBe(160);
  });

  it('does not complete onboarding for a save response received after leaving the form', async () => {
    const complete = vi.fn();
    let resolve!: (value: IdentityState) => void;
    await act(async () =>
      root.render(
        <IdentityProfileForm initialState={initial()} onComplete={complete} />,
      ),
    );
    invoke.mockImplementationOnce(
      () =>
        new Promise<IdentityState>((done) => {
          resolve = done;
        }),
    );
    await click('Save and continue');
    await act(async () => root.render(<div>Different view</div>));
    await act(async () => resolve(initial()));
    expect(complete).not.toHaveBeenCalled();
  });

  it('silently hides an unsupported invitation without disrupting the app', async () => {
    invoke.mockRejectedValueOnce(
      new Error('No handler registered for GET_IDENTITY_STATE'),
    );
    await act(async () =>
      root.render(
        <>
          <IdentityProfileInvitation onOpenSettings={vi.fn()} />
          <p>Dashboard remains available</p>
        </>,
      ),
    );
    expect(container.textContent).toBe('Dashboard remains available');
  });

  it('keeps readiness visible when persisting the third step fails', async () => {
    savedStep = '2';
    await act(async () => root.render(<SetupWizard onComplete={vi.fn()} />));
    invoke.mockRejectedValueOnce(new Error('disk full'));
    await click('Continue');
    expect(container.textContent).toContain('Everything is ready.');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).not.toContain('A little about you');
  });

  it('adds alternate-name chips by keyboard, deduplicates them, and removes them accessibly', async () => {
    await act(async () =>
      root.render(<IdentityProfileForm initialState={initial()} />),
    );
    await text('Alternate name', ' Mo ');
    await act(async () =>
      container
        .querySelector('input[aria-label="Alternate name"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        ),
    );
    await text('Alternate name', 'mo');
    await click('Add name');
    expect(
      container.querySelectorAll('button[aria-label="Remove Mo"]'),
    ).toHaveLength(1);
    await click('Remove Mo');
    await click('Save about you');
    expect(invoke).toHaveBeenCalledWith(
      'SAVE_IDENTITY_PROFILE',
      expect.objectContaining({ preferredName: '', aliases: [] }),
    );
  });

  it('retains edits after a failed save without running completion', async () => {
    const complete = vi.fn();
    await act(async () =>
      root.render(
        <IdentityProfileForm initialState={initial()} onComplete={complete} />,
      ),
    );
    await text('Preferred name', 'Morgan');
    invoke.mockRejectedValueOnce(new Error('disk full'));
    await click('Save and continue');
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Preferred name"]',
      )?.value,
    ).toBe('Morgan');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it('reloads a stale revision without discarding the edited profile', async () => {
    await act(async () =>
      root.render(<IdentityProfileForm initialState={initial()} />),
    );
    await text('Preferred name', 'Morgan');
    invoke.mockRejectedValueOnce(new Error('identity_revision_stale'));
    profileState = { ...initial(), revision: 9 };
    await click('Save about you');
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Preferred name"]',
      )?.value,
    ).toBe('Morgan');
    await click('Save about you');
    expect(invoke).toHaveBeenLastCalledWith(
      'SAVE_IDENTITY_PROFILE',
      expect.objectContaining({ preferredName: 'Morgan', expectedRevision: 9 }),
    );
  });

  it('skips by persisting dismissal without overwriting a previous profile', async () => {
    profileState = {
      ...initial(),
      profile: {
        ...emptyIdentityProfile(),
        preferredName: 'Morgan',
        role: 'Research',
      },
    };
    const complete = vi.fn();
    await act(async () =>
      root.render(
        <IdentityProfileForm
          initialState={profileState}
          onComplete={complete}
        />,
      ),
    );
    await text('Preferred name', 'Unsaved edit');
    await click('Skip for now');
    expect(invoke).toHaveBeenCalledWith('DISMISS_IDENTITY_PROFILE', {
      expectedRevision: 4,
    });
    expect(profileState.profile.preferredName).toBe('Morgan');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('does not finish onboarding if dismissal cannot be saved', async () => {
    const complete = vi.fn();
    await act(async () =>
      root.render(
        <IdentityProfileForm initialState={initial()} onComplete={complete} />,
      ),
    );
    invoke.mockRejectedValueOnce(new Error('disk full'));
    await click('Skip for now');
    expect(complete).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('shows a dismissible invitation that opens Settings instead of onboarding', async () => {
    const open = vi.fn();
    await act(async () =>
      root.render(<IdentityProfileInvitation onOpenSettings={open} />),
    );
    await click('About you');
    expect(open).toHaveBeenCalledOnce();
    await click('Dismiss About you invitation');
    expect(invoke).toHaveBeenCalledWith('DISMISS_IDENTITY_PROFILE', {
      expectedRevision: 4,
    });
    expect(container.textContent).toBe('');
  });

  it.each(['completed', 'dismissed'] as const)(
    'suppresses the invitation after %s disposition',
    async (disposition) => {
      profileState.profile.disposition = disposition;
      await act(async () =>
        root.render(<IdentityProfileInvitation onOpenSettings={vi.fn()} />),
      );
      expect(container.textContent).toBe('');
    },
  );

  it('retains the invitation after a failed dismissal', async () => {
    await act(async () =>
      root.render(<IdentityProfileInvitation onOpenSettings={vi.fn()} />),
    );
    invoke.mockRejectedValueOnce(new Error('disk full'));
    await click('Dismiss About you invitation');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain('About you');
  });

  it('resumes the third onboarding step without rerunning recording preparation', async () => {
    const complete = vi.fn();
    await act(async () => root.render(<SetupWizard onComplete={complete} />));
    expect(container.textContent).toContain('A little about you');
    expect(invoke).not.toHaveBeenCalledWith('RECORDING_READINESS_PREPARE');
    await click('Skip for now');
    expect(invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'setup_complete',
      value: 'true',
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('persists the third step after readiness before showing the optional profile', async () => {
    savedStep = '2';
    await act(async () => root.render(<SetupWizard onComplete={vi.fn()} />));
    await click('Continue');
    expect(invoke).toHaveBeenCalledWith('SET_SETTING', {
      key: 'setup_step',
      value: '3',
    });
    expect(container.textContent).toContain('A little about you');
    expect(invoke).not.toHaveBeenCalledWith('SET_SETTING', {
      key: 'setup_complete',
      value: 'true',
    });
  });

  it('stays in onboarding if marking setup complete fails after saving the profile', async () => {
    const complete = vi.fn();
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (channel: string, payload: unknown) => {
      if (
        channel === 'SET_SETTING' &&
        (payload as { key: string }).key === 'setup_complete'
      )
        throw new Error('disk full');
      return original(channel, payload);
    });
    await act(async () => root.render(<SetupWizard onComplete={complete} />));
    await text('Preferred name', 'Morgan');
    await click('Save and continue');
    expect(complete).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Preferred name"]',
      )?.value,
    ).toBe('Morgan');
  });
});
