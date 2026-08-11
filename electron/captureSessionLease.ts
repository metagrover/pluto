export const CAPTURE_SESSION_ALREADY_ACTIVE = 'capture_session_already_active';

export type CaptureSessionLease = {
  meetingId: string;
  ownerId: number;
};

export const createCaptureSessionLeaseRegistry = () => {
  let active: CaptureSessionLease | null = null;

  return {
    acquire(meetingId: string, ownerId: number) {
      if (!active) {
        active = { meetingId, ownerId };
        return { status: 'acquired' as const, lease: { ...active } };
      }
      if (active.meetingId === meetingId && active.ownerId === ownerId) {
        return { status: 'already_owned' as const, lease: { ...active } };
      }
      throw new Error(CAPTURE_SESSION_ALREADY_ACTIVE);
    },

    activeForOwner(ownerId: number) {
      return active?.ownerId === ownerId ? { ...active } : null;
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
