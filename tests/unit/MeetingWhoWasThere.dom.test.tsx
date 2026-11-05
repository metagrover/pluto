// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const kg = vi.hoisted(() => ({
  addMeetingEntity: vi.fn(),
  getEntitiesByType: vi.fn(),
  upsertEntity: vi.fn(),
}));
vi.mock('../../src/api/knowledgeGraph', () => kg);

import { MeetingWhoWasThere } from '../../src/components/features/MeetingWhoWasThere';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  kg.getEntitiesByType.mockResolvedValue([{ id: 'p1', name: 'Lee Chen' }]);
  kg.addMeetingEntity.mockResolvedValue({});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('asks who the meeting was with and adds the chosen person as a participant', async () => {
  const onAdded = vi.fn();
  await act(async () =>
    root.render(<MeetingWhoWasThere meetingId="m1" onAdded={onAdded} />),
  );
  const ask = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Who was this with?',
  )!;
  await act(async () => ask.click());
  const trigger = host.querySelector<HTMLElement>(
    '[aria-label="Who was this meeting with"]',
  )!;
  await act(async () => trigger.click());
  const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
    o.textContent?.includes('Lee Chen'),
  ) as HTMLElement;
  expect(option).toBeTruthy();
  await act(async () => option.click());
  expect(kg.addMeetingEntity).toHaveBeenCalledWith({
    meeting_id: 'm1',
    entity_id: 'p1',
    mention_count: 1,
    context: 'Manual participant',
  });
  expect(onAdded).toHaveBeenCalled();
});
