import { describe, expect, it } from 'vitest';
import {
  CAPTURE_SESSION_ALREADY_ACTIVE,
  createCaptureSessionLeaseRegistry,
} from '../../electron/captureSessionLease';

describe('capture session lease registry', () => {
  it('makes duplicate acquisition idempotent for the same meeting and owner', () => {
    const registry = createCaptureSessionLeaseRegistry();

    expect(registry.acquire('meeting-alpha', 11)).toMatchObject({
      status: 'acquired',
      lease: { meetingId: 'meeting-alpha', ownerId: 11 },
    });
    expect(registry.acquire('meeting-alpha', 11)).toMatchObject({
      status: 'already_owned',
      lease: { meetingId: 'meeting-alpha', ownerId: 11 },
    });
  });

  it('rejects another meeting after renderer-local state resets', () => {
    const registry = createCaptureSessionLeaseRegistry();
    registry.acquire('meeting-alpha', 11);

    expect(() => registry.acquire('meeting-beta', 11)).toThrow(
      CAPTURE_SESSION_ALREADY_ACTIVE,
    );
  });

  it('rejects a second renderer even when it presents the same meeting', () => {
    const registry = createCaptureSessionLeaseRegistry();
    registry.acquire('meeting-alpha', 11);

    expect(() => registry.acquire('meeting-alpha', 22)).toThrow(
      CAPTURE_SESSION_ALREADY_ACTIVE,
    );
  });

  it('releases only the matching meeting and owner', () => {
    const registry = createCaptureSessionLeaseRegistry();
    registry.acquire('meeting-alpha', 11);

    expect(registry.release('meeting-alpha', 22)).toBe(false);
    expect(registry.release('meeting-beta', 11)).toBe(false);
    expect(registry.activeForOwner(11)).toEqual({
      meetingId: 'meeting-alpha',
      ownerId: 11,
    });
    expect(registry.release('meeting-alpha', 11)).toBe(true);
    expect(registry.activeForOwner(11)).toBeNull();
    expect(registry.acquire('meeting-beta', 22).status).toBe('acquired');
  });

  it('releases the lease when its renderer owner is destroyed', () => {
    const registry = createCaptureSessionLeaseRegistry();
    registry.acquire('meeting-beta', 22);

    expect(registry.releaseOwner(11)).toBeNull();
    expect(registry.releaseOwner(22)).toEqual({
      meetingId: 'meeting-beta',
      ownerId: 22,
    });
    expect(registry.activeForOwner(22)).toBeNull();
  });
});
