export const CAPTURE_SESSION_ALREADY_ACTIVE = 'capture_session_already_active';
export const CAPTURE_SESSION_NOT_OWNED = 'capture_session_not_owned';

export type CaptureSessionLease = {
  meetingId: string;
  ownerId: number;
  phase: 'recording' | 'stopped';
};

export const createCaptureSessionLeaseRegistry = () => {
  let active: CaptureSessionLease | null = null;

  const requireOwner = (meetingId: string, ownerId: number) => {
    if (active?.meetingId !== meetingId || active.ownerId !== ownerId) {
      throw new Error(CAPTURE_SESSION_NOT_OWNED);
    }
    return active;
  };

  return {
    acquire(meetingId: string, ownerId: number) {
      if (!active) {
        active = { meetingId, ownerId, phase: 'recording' };
        return { status: 'acquired' as const, lease: { ...active } };
      }
      if (
        active.meetingId === meetingId &&
        active.ownerId === ownerId &&
        active.phase === 'recording'
      ) {
        return { status: 'already_owned' as const, lease: { ...active } };
      }
      throw new Error(CAPTURE_SESSION_ALREADY_ACTIVE);
    },

    activeForOwner(ownerId: number) {
      return active?.ownerId === ownerId ? { ...active } : null;
    },

    recordingForOwner(ownerId: number) {
      return active?.ownerId === ownerId && active.phase === 'recording'
        ? { ...active }
        : null;
    },

    requireRecordingOwner(meetingId: string, ownerId: number) {
      const owned = requireOwner(meetingId, ownerId);
      if (owned.phase !== 'recording') {
        throw new Error(CAPTURE_SESSION_NOT_OWNED);
      }
      return { ...owned };
    },

    markStopped(meetingId: string, ownerId: number) {
      const owned = requireOwner(meetingId, ownerId);
      if (owned.phase !== 'recording') {
        throw new Error(CAPTURE_SESSION_NOT_OWNED);
      }
      active = { ...owned, phase: 'stopped' };
      return { ...active };
    },

    requireStoppedOwner(meetingId: string, ownerId: number) {
      const owned = requireOwner(meetingId, ownerId);
      if (owned.phase !== 'stopped') {
        throw new Error(CAPTURE_SESSION_NOT_OWNED);
      }
      return { ...owned };
    },

    release(meetingId: string, ownerId: number) {
      if (active?.meetingId !== meetingId || active.ownerId !== ownerId) {
        return false;
      }
      active = null;
      return true;
    },

    releaseOwner(ownerId: number) {
      if (active?.ownerId !== ownerId) return null;
      const released = { ...active };
      active = null;
      return released;
    },
  };
};
