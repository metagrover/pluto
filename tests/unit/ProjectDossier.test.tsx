// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectDossier } from '../../src/components/features/projects/ProjectDossier';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ProjectDossier', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders main execution column and intelligence sidebar', () => {
    const handleBack = vi.fn();
    act(() => {
      root.render(
        <ProjectDossier
          projectId="proj-1"
          projectName="Project Aurora"
          onBack={handleBack}
        />,
      );
    });

    // Main column elements
    expect(container.textContent).toContain('Project Aurora');
    expect(container.textContent).toContain('Quick Overview');
    expect(container.textContent).toContain('Status Update');

    // Intelligence sidebar elements
    expect(container.textContent).toContain("Pluto's Insights");
    expect(container.textContent).toContain('No insights generated yet.');

    // Back button
    const backButton = container.querySelector('button');
    expect(backButton).not.toBeNull();
    expect(backButton?.textContent).toContain('Back');

    act(() => {
      backButton?.click();
    });
    expect(handleBack).toHaveBeenCalledOnce();
  });

  it('renders fallback title when projectName is not provided', () => {
    act(() => {
      root.render(<ProjectDossier projectId="proj-1" onBack={vi.fn()} />);
    });

    expect(container.textContent).toContain('Loading project...');
  });
});
