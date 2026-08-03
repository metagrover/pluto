import { describe, expect, it, vi } from 'vitest';

import {
  handleActionCommitmentReview,
  parseActionCommitmentReviewPayload,
} from '../../electron/actionCommitmentReviewIpc';

describe('action commitment review IPC validation', () => {
  it.each([
    null,
    undefined,
    'payload',
    [],
    {},
    { id: '', commitmentState: 'confirmed' },
    { id: '   ', commitmentState: 'confirmed' },
    { id: 42, commitmentState: 'confirmed' },
    { id: 'action-1' },
    { id: 'action-1', commitmentState: 'possible' },
    { id: 'action-1', commitmentState: 'invented-state' },
  ])('rejects invalid payload %j', (payload) => {
    expect(() => parseActionCommitmentReviewPayload(payload)).toThrow(
      'Invalid action commitment review payload',
    );
  });

  it.each(['confirmed', 'rejected'] as const)(
    'accepts a valid %s payload unchanged',
    (commitmentState) => {
      expect(
        parseActionCommitmentReviewPayload({
          id: 'action-1',
          commitmentState,
        }),
      ).toEqual({ id: 'action-1', commitmentState });
    },
  );

  it('does not mutate or queue refresh for invalid payloads', () => {
    const updateActionCommitmentState = vi.fn();
    const queueKnowledgeRefresh = vi.fn();

    expect(() =>
      handleActionCommitmentReview(
        { id: 'action-1', commitmentState: 'possible' },
        { updateActionCommitmentState, queueKnowledgeRefresh },
      ),
    ).toThrow('Invalid action commitment review payload');

    expect(updateActionCommitmentState).not.toHaveBeenCalled();
    expect(queueKnowledgeRefresh).not.toHaveBeenCalled();
  });

  it('updates before queueing refresh for valid payloads', () => {
    const calls: string[] = [];
    const entity = { id: 'action-1' };
    const updateActionCommitmentState = vi.fn(() => {
      calls.push('update');
      return entity;
    });
    const queueKnowledgeRefresh = vi.fn(() => {
      calls.push('refresh');
    });

    expect(
      handleActionCommitmentReview(
        { id: 'action-1', commitmentState: 'rejected' },
        { updateActionCommitmentState, queueKnowledgeRefresh },
      ),
    ).toBe(entity);
    expect(calls).toEqual(['update', 'refresh']);
  });
});
