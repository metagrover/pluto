import { describe, expect, it, vi } from 'vitest';

import type { LiveTranscriptSegment } from '../../src/components/features/recordingWorkspaceModel';
import { createConfirmedSegmentIngestionSession } from '../../src/services/meetingContext/confirmedSegmentIngestionSession';

const live = (
  overrides: Partial<LiveTranscriptSegment> = {},
): LiveTranscriptSegment => ({
  id: 'segment-1',
  speaker: 'Speaker',
  text: 'We decided to launch Monday.',
  timestampMs: 42_000,
  confirmed: true,
  ...overrides,
});

describe('confirmed meeting context ingestion', () => {
  it('submits only unseen confirmed valid segments', () => {
    const submit = vi.fn(() => Promise.resolve());
    const session = createConfirmedSegmentIngestionSession({
      meetingId: 'meeting-1',
      submit,
      onError: vi.fn(),
    });

    session.accept([
      live({ id: 'confirmed-1', confirmed: true }),
      live({ id: 'tentative', confirmed: false }),
    ]);
    session.accept([live({ id: 'confirmed-1', confirmed: true })]);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      segments: [
        expect.objectContaining({ id: 'confirmed-1', confirmed: true }),
      ],
    });
  });

  it('returns before asynchronous submission settles', () => {
    let resolve!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const session = createConfirmedSegmentIngestionSession({
      meetingId: 'meeting-1',
      submit,
      onError: vi.fn(),
    });

    session.accept([live()]);

    expect(submit).toHaveBeenCalledOnce();
    resolve();
  });

  it('allows a failed batch to retry on the next projection', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const session = createConfirmedSegmentIngestionSession({
      meetingId: 'meeting-1',
      submit,
      onError,
    });

    session.accept([live({ id: 'segment-1' })]);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    session.accept([live({ id: 'segment-1' })]);

    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('contains a synchronous submission failure and permits retry', () => {
    const submit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('ipc unavailable');
      })
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const session = createConfirmedSegmentIngestionSession({
      meetingId: 'meeting-1',
      submit,
      onError,
    });

    expect(() => session.accept([live()])).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    session.accept([live()]);

    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('ignores all rows after close', () => {
    const submit = vi.fn(() => Promise.resolve());
    const session = createConfirmedSegmentIngestionSession({
      meetingId: 'meeting-1',
      submit,
      onError: vi.fn(),
    });

    session.close();
    session.accept([live()]);

    expect(submit).not.toHaveBeenCalled();
  });

  it('filters malformed confirmed rows before submission', () => {
    const submit = vi.fn(() => Promise.resolve());
    const session = createConfirmedSegmentIngestionSession({
      meetingId: 'meeting-1',
      submit,
      onError: vi.fn(),
    });

    session.accept([
      live({ id: '' }),
      live({ id: 'empty', text: '  ' }),
      live({ id: 'negative', timestampMs: -1 }),
      live({ id: 'oversized', text: 'x'.repeat(12_001) }),
    ]);

    expect(submit).not.toHaveBeenCalled();
  });

  it('bounds each submission and leaves overflow for the next projection', () => {
    const submit = vi.fn(() => Promise.resolve());
    const session = createConfirmedSegmentIngestionSession({
      meetingId: 'meeting-1',
      submit,
      onError: vi.fn(),
    });
    const segments = Array.from({ length: 25 }, (_, index) =>
      live({ id: `segment-${index}` }),
    );

    session.accept(segments);
    session.accept(segments);

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0].segments).toHaveLength(24);
    expect(submit.mock.calls[1][0].segments).toHaveLength(1);
  });
});
