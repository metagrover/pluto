// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LiveNotesEditor } from '../../src/components/features/LiveNotesEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latest = '';
let setOutside: (value: string) => void = () => {};

const Harness = ({ initial }: { initial: string }) => {
  const [value, setValue] = useState(initial);
  setOutside = setValue;
  latest = value;
  return (
    <LiveNotesEditor
      idPrefix="live-"
      value={value}
      onChange={setValue}
      placeholder="Start typing"
    />
  );
};

const area = (index: number) =>
  host.querySelector(`#live-${index}`) as HTMLTextAreaElement;
const type = (index: number, text: string) => {
  const element = area(index);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(element, text);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const press = (index: number, key: string, caret?: number) => {
  const element = area(index);
  const at = caret ?? element.value.length;
  element.setSelectionRange(at, at);
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('turns "[] " into a checkbox and continues the list on Enter', async () => {
  await act(async () => root.render(<Harness initial="" />));
  expect(area(0).placeholder).toBe('Start typing');
  await act(async () => type(0, '[] Ask about budget'));
  expect(
    host.querySelector('input[type="checkbox"], button[role="checkbox"]'),
  ).not.toBeNull();
  expect(area(0).value).toBe('Ask about budget');
  expect(latest).toBe('- [ ] Ask about budget');
  await act(async () => press(0, 'Enter'));
  await act(async () => type(1, 'Hiring plan'));
  expect(latest).toBe('- [ ] Ask about budget\n- [ ] Hiring plan');
  // Enter on an empty item ends the list.
  await act(async () => press(1, 'Enter'));
  await act(async () => press(2, 'Enter'));
  await act(async () => type(2, 'Plain line'));
  expect(latest).toBe('- [ ] Ask about budget\n- [ ] Hiring plan\nPlain line');
});

it('keeps notes set from outside, and Backspace undoes a list item first', async () => {
  await act(async () => root.render(<Harness initial="" />));
  await act(async () => setOutside('- [ ] Data residency\nFollow up'));
  expect(area(0).value).toBe('Data residency');
  expect(area(1).value).toBe('Follow up');
  await act(async () => press(1, 'Backspace', 0));
  expect(latest).toBe('- [ ] Data residencyFollow up');
  await act(async () => press(0, 'Backspace', 0));
  expect(latest).toBe('Data residencyFollow up');
});

it('splits pasted lines into their own items', async () => {
  await act(async () => root.render(<Harness initial="" />));
  await act(async () => type(0, '- [ ] One\n- [ ] Two\nThree'));
  expect(latest).toBe('- [ ] One\n- [ ] Two\nThree');
  expect(area(2).value).toBe('Three');
});
