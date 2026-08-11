import { describe, expect, it, vi } from 'vitest';
import { createPostMeetingBackgroundActivity } from '../../electron/postMeetingBackgroundActivity';

describe('post-meeting background activity', () => {
  it('disables throttling until the final active run finishes', () => {
    const setBackgroundThrottling = vi.fn();
    const activity = createPostMeetingBackgroundActivity(
      setBackgroundThrottling,
    );

    activity.setActive('run-a', true);
    activity.setActive('run-a', true);
    activity.setActive('run-b', true);
    activity.setActive('run-a', false);

    expect(setBackgroundThrottling).toHaveBeenCalledTimes(1);
    expect(setBackgroundThrottling).toHaveBeenLastCalledWith(false);

    activity.setActive('run-b', false);
    expect(setBackgroundThrottling).toHaveBeenLastCalledWith(true);
  });

  it('restores throttling when the renderer reloads', () => {
    const setBackgroundThrottling = vi.fn();
    const activity = createPostMeetingBackgroundActivity(
      setBackgroundThrottling,
    );

    activity.setActive('run-a', true);
    activity.reset();

    expect(setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    expect(activity.activeCount()).toBe(0);
  });
});
