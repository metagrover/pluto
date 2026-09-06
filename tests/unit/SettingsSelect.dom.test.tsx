// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsSelect } from '../../src/components/ui/SettingsSelect';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const changed = vi.fn();
const options = [
  { value: '3', label: '3 minutes' },
  { value: '5', label: '5 minutes (Default)' },
  { value: '10', label: '10 minutes', disabled: true },
  { value: 'disabled', label: 'Disabled' },
];
function Harness(props: {
  searchable?: boolean;
  allowCustom?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('5');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        changed('submit');
      }}
    >
      <SettingsSelect
        label="Duration"
        options={options}
        value={value}
        onChange={(next) => {
          setValue(next);
          changed(next);
        }}
        {...props}
      />
      <button type="submit">Save</button>
    </form>
  );
}
const control = () => host.querySelector<HTMLElement>('[role=combobox]')!;
const key = (value: string) =>
  act(() => {
    control().dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true }),
    );
  });
const type = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(control(), value);
    control().dispatchEvent(new Event('input', { bubbles: true }));
  });
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  changed.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('selects with keyboard, skips disabled options and does not submit the form', () => {
  act(() => root.render(<Harness />));
  key('ArrowDown');
  expect(control().getAttribute('aria-expanded')).toBe('true');
  key('ArrowDown');
  expect(
    document.getElementById(control().getAttribute('aria-activedescendant')!)
      ?.textContent,
  ).toContain('Disabled');
  key('Enter');
  expect(changed.mock.calls).toEqual([['disabled']]);
  expect(control().textContent).toContain('Disabled');
  expect(document.querySelector('[role=listbox]')).toBeNull();
});
it('filters editable suggestions while preserving custom text on Escape', () => {
  act(() => root.render(<Harness searchable allowCustom />));
  type('minutes');
  expect(document.querySelectorAll('[role=option]')).toHaveLength(3);
  type('My custom duration');
  key('Escape');
  expect(changed).toHaveBeenLastCalledWith('My custom duration');
  expect((control() as HTMLInputElement).value).toBe('My custom duration');
});
it('searching does not change a fixed selection and Escape restores its label', () => {
  act(() => root.render(<Harness searchable />));
  act(() => control().focus());
  expect((control() as HTMLInputElement).selectionStart).toBe(0);
  expect((control() as HTMLInputElement).selectionEnd).toBe(
    '5 minutes (Default)'.length,
  );
  type('3');
  expect(changed).not.toHaveBeenCalled();
  key('Escape');
  expect((control() as HTMLInputElement).value).toBe('5 minutes (Default)');
  type('3');
  key('ArrowDown');
  key('Enter');
  expect(changed).toHaveBeenCalledWith('3');
});
it('dismisses on Tab and outside pointer interaction without committing', () => {
  act(() => root.render(<Harness />));
  key('ArrowDown');
  key('Tab');
  expect(document.querySelector('[role=listbox]')).toBeNull();
  key('ArrowDown');
  act(() =>
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    ),
  );
  expect(document.querySelector('[role=listbox]')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});
it('closes an open menu when disabled', () => {
  act(() => root.render(<Harness />));
  key('ArrowDown');
  act(() => root.render(<Harness disabled />));
  expect(document.querySelector('[role=listbox]')).toBeNull();
  expect(control().hasAttribute('disabled')).toBe(true);
});

it('moves up from an unhighlighted search to the last enabled result', () => {
  act(() => root.render(<Harness searchable />));
  type('minutes');
  key('ArrowUp');
  key('Enter');
  expect(changed).toHaveBeenCalledWith('5');
});

it('does not commit while an IME composition is being confirmed', () => {
  act(() => root.render(<Harness searchable />));
  key('ArrowDown');
  act(() =>
    control().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        isComposing: true,
      }),
    ),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(control().getAttribute('aria-expanded')).toBe('true');
});
