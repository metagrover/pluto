// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  saveTask: vi.fn(async () => 'task-1'),
  addToNextTime: vi.fn(async () => {}),
}));
vi.mock('../../src/api/tasks', () => ({ saveTask: api.saveTask }));
vi.mock('../../src/components/KnowledgeGraph/NextWithPerson', () => ({
  addToNextTime: api.addToNextTime,
}));

import {
  AnswerActions,
  answerItemDraft,
} from '../../src/components/features/AnswerActions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  )!;
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

it('extracts an actionable item without markup', () => {
  expect(
    answerItemDraft(
      'Two things:\n\n- **Send** the SSO numbers [Acme call]\n- Book QA',
    ),
  ).toBe('Send the SSO numbers');
  expect(answerItemDraft('Priya will send the deck. Then review.')).toBe(
    'Priya will send the deck',
  );
  expect(answerItemDraft('x '.repeat(200)).length).toBeLessThanOrEqual(161);
});

it('adds an edited to-do from an answer', async () => {
  await act(async () =>
    root.render(<AnswerActions answer="- Send the SSO numbers" />),
  );
  expect(host.textContent).not.toContain('Next time');
  await act(async () => button('Add as to-do').click());
  const input = host.querySelector('input') as HTMLInputElement;
  expect(input.value).toBe('Send the SSO numbers');
  await act(async () => type(input, 'Send the SSO numbers to Lee'));
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(api.saveTask).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Send the SSO numbers to Lee' }),
  );
  expect(host.textContent).toContain('Added to Tasks');
});

it('adds to Next time with the person, and Cancel adds nothing', async () => {
  const person = { id: 'p1', name: 'Priya Shah' };
  await act(async () =>
    root.render(<AnswerActions answer="Ask about hiring." person={person} />),
  );
  await act(async () => button('Add to Next time with Priya').click());
  await act(async () => button('Cancel').click());
  expect(api.addToNextTime).not.toHaveBeenCalled();
  await act(async () => button('Add to Next time with Priya').click());
  await act(async () => button('Add').click());
  expect(api.addToNextTime).toHaveBeenCalledWith(person, 'Ask about hiring');
  expect(host.textContent).toContain('Added to Next time with Priya');
});

it.each([
  'The team decided to use GraphQL for the API layer.',
  'Hello! How can I help?',
  'No new tasks.',
  '- No further action is needed.',
  'I could not prepare that change. Please specify the note or task.',
  'Review the proposed changes below. Nothing has been changed yet.',
  '- The deadline is Friday.',
  '- [x] Send the proposal',
  'Priya already sent the deck.',
])('does not offer a to-do for non-actionable reply: %s', async (answer) => {
  expect(answerItemDraft(answer)).toBe('');
  await act(async () =>
    root.render(
      <AnswerActions answer={answer} person={{ id: 'p1', name: 'Priya' }} />,
    ),
  );
  expect(host.querySelector('button')).toBeNull();
  expect(api.saveTask).not.toHaveBeenCalled();
});
it('skips facts and finds a concrete action later in the reply', () => {
  expect(
    answerItemDraft(
      'Summary:\n- Budget is approved.\n- Send the approved budget to Finance.',
    ),
  ).toBe('Send the approved budget to Finance');
});
