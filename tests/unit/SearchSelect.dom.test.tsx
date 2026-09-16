// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSelect } from '../../src/components/ui/SearchSelect';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enterText = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('SearchSelect', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
  });

  it('filters options and selects with the keyboard', async () => {
    const onValueChange = vi.fn();
    await act(async () => {
      root.render(
        <SearchSelect
          ariaLabel="Person"
          value=""
          onValueChange={onValueChange}
          options={[
            { value: 'ada', label: 'Ada Lovelace' },
            { value: 'grace', label: 'Grace Hopper' },
          ]}
        />,
      );
    });
    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      enterText(input, 'Grace');
    });
    expect(document.body.textContent).toContain('Grace Hopper');
    expect(document.body.textContent).not.toContain('Ada Lovelace');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(onValueChange).toHaveBeenCalledWith('grace');
  });

  it('keeps editable values while offering suggestions', async () => {
    const onValueChange = vi.fn();
    await act(async () => {
      root.render(
        <SearchSelect
          ariaLabel="Industry"
          value="Technology"
          allowCustomValue
          onValueChange={onValueChange}
          options={[{ value: 'Technology', label: 'Technology' }]}
        />,
      );
    });
    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      enterText(input, 'Aerospace');
    });
    expect(onValueChange).toHaveBeenLastCalledWith('Aerospace');
  });

  it('clears input upon selecting an option when clearOnSelect is true', async () => {
    const onValueChange = vi.fn();
    const onInputValueChange = vi.fn();
    await act(async () => {
      root.render(
        <SearchSelect
          ariaLabel="Person"
          value=""
          clearOnSelect
          onValueChange={onValueChange}
          onInputValueChange={onInputValueChange}
          options={[
            { value: 'ada', label: 'Ada Lovelace' },
            { value: 'grace', label: 'Grace Hopper' },
          ]}
        />,
      );
    });
    const input = container.querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.focus();
      enterText(input, 'Grace');
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(onValueChange).toHaveBeenCalledWith('grace');
    expect(onInputValueChange).toHaveBeenLastCalledWith('');
    expect(input.value).toBe('');
  });
});
