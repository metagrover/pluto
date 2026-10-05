// @vitest-environment happy-dom

import { act, createRef } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailsMenu } from '../../src/components/ui/DetailsMenu';
import { SearchSelect } from '../../src/components/ui/SearchSelect';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const renderMenu = () => {
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <DetailsMenu>
        <summary>More</summary>
        <button type="button">Action</button>
        <SearchSelect
          ariaLabel="Template"
          value="default"
          onValueChange={onSelect}
          searchable={false}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </DetailsMenu>,
    ),
  );
  const details = host.querySelector('details')!;
  const summary = host.querySelector('summary')!;
  act(() => summary.click());
  expect(details.open).toBe(true);
  return { details, summary, onSelect };
};

describe('DetailsMenu dismissal', () => {
  it.each(['pointerdown', 'click'])(
    'closes on an outside %s without moving focus',
    (eventType) => {
      const { details, summary } = renderMenu();
      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();
      act(() =>
        outside.dispatchEvent(new MouseEvent(eventType, { bubbles: true })),
      );
      expect(details.open).toBe(false);
      expect(document.activeElement).toBe(outside);
      act(() => summary.click());
      expect(details.open).toBe(true);
      outside.remove();
    },
  );

  it('closes on Escape from within the menu and returns focus to the trigger', () => {
    const { details, summary } = renderMenu();
    const action = host.querySelector('button')!;
    action.focus();
    act(() =>
      action.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('also closes on Escape when focus is elsewhere', () => {
    const { details } = renderMenu();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(details.open).toBe(false);
  });

  it('keeps internal actions and portaled template selections inside the menu', async () => {
    const { details, onSelect } = renderMenu();
    act(() => host.querySelector('button')!.click());
    expect(details.open).toBe(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Template"]')!.click(),
    );
    const option = document.querySelector<HTMLButtonElement>(
      '[data-value="custom"]',
    )!;
    expect(details.contains(option)).toBe(false);
    act(() => {
      option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      option.click();
    });
    expect(onSelect).toHaveBeenCalledWith('custom');
    expect(details.open).toBe(true);
  });

  it('lets a nested picker handle Escape before closing the parent menu', async () => {
    const { details } = renderMenu();
    const picker = host.querySelector<HTMLButtonElement>(
      '[aria-label="Template"]',
    )!;
    await act(async () => picker.click());
    act(() =>
      picker.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(details.open).toBe(true);
    act(() =>
      picker.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(details.open).toBe(false);
  });

  it('preserves native ref access used by project actions', () => {
    const ref = createRef<HTMLDetailsElement>();
    act(() =>
      root.render(
        <DetailsMenu ref={ref}>
          <summary>More</summary>
        </DetailsMenu>,
      ),
    );
    expect(ref.current).toBe(host.querySelector('details'));
    act(() => {
      ref.current!.open = true;
    });
    act(() => {
      ref.current!.open = false;
    });
    expect(host.querySelector('details')!.open).toBe(false);
  });
});
