import type { EouPcmAppend } from './eouPcmContract';
import type {
  NativeEouUpdateEvent,
  NativeLiveSource,
} from './nativeJsonLineProcess';
import type {
  ParakeetEouClient,
  ParakeetEouIdentity,
} from './parakeetEouClient';
import type { SpeakerEvidenceResult } from './parakeetFinalClient';

type EouClient = Pick<
  ParakeetEouClient,
  | 'open'
  | 'append'
  | 'finish'
  | 'cancel'
  | 'close'
  | 'onUpdate'
  | 'onTerminalFailure'
  | 'speakerEvidence'
>;

export type ParakeetEouMeetingStart = {
  meetingId: string;
  generation: number;
  owner: string;
};

export type ParakeetEouMeetingAppend = Omit<
  EouPcmAppend,
  'streamId' | 'generation' | 'sequence'
> & {
  meetingId: string;
};

type ActiveMeeting = ParakeetEouMeetingStart & {
  client: EouClient;
  identities: Record<NativeLiveSource, ParakeetEouIdentity>;
  nextSequence: Record<NativeLiveSource, number>;
  unsubscribeUpdate: () => void;
  unsubscribeFailure: () => void;
};

type CoordinatorOptions = {
  createClient(): Promise<EouClient>;
  onUpdate(payload: {
    meetingId: string;
    owner: string;
    event: NativeEouUpdateEvent;
  }): void;
  onUnavailable(payload: {
    meetingId: string;
    owner: string;
    code: string;
  }): void;
};

const SOURCES: readonly NativeLiveSource[] = ['mic', 'system'];
const ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

/** Owns the one visible two-source EOU session for an active meeting. */
export class ParakeetEouMeetingCoordinator {
  private active: ActiveMeeting | null = null;
  private pendingStart: ParakeetEouMeetingStart | null = null;
  private failing: Promise<void> | null = null;

  constructor(private readonly options: CoordinatorOptions) {}

  isActive(): boolean {
    return this.active !== null;
  }

  async start(start: ParakeetEouMeetingStart): Promise<void> {
    this.validateStart(start);
    if (this.active || this.pendingStart)
      throw new Error('parakeet_meeting_active');
    const pending = { ...start };
    this.pendingStart = pending;

    let client: EouClient;
    try {
      if (this.failing) await this.failing;
      if (this.pendingStart !== pending) throw new Error('parakeet_cancelled');
      client = await this.options.createClient();
    } catch {
      if (this.pendingStart !== pending) throw new Error('parakeet_cancelled');
      this.pendingStart = null;
      this.options.onUnavailable({
        meetingId: start.meetingId,
        owner: start.owner,
        code: 'parakeet_live_unavailable',
      });
      throw new Error('parakeet_live_unavailable');
    }
    if (this.pendingStart !== pending) {
      await client.close();
      throw new Error('parakeet_cancelled');
    }
    this.pendingStart = null;
    const identities = Object.fromEntries(
      SOURCES.map((source) => [
        source,
        {
          streamId: `eou-${start.meetingId}-${source}`,
          source,
          generation: start.generation,
        },
      ]),
    ) as Record<NativeLiveSource, ParakeetEouIdentity>;
    const meeting: ActiveMeeting = {
      ...start,
      client,
      identities,
      nextSequence: { mic: 1, system: 1 },
      unsubscribeUpdate: () => undefined,
      unsubscribeFailure: () => undefined,
    };
    meeting.unsubscribeUpdate = client.onUpdate((event) => {
      if (this.active !== meeting) return;
      this.options.onUpdate({
        meetingId: meeting.meetingId,
        owner: meeting.owner,
        event,
      });
    });
    meeting.unsubscribeFailure = client.onTerminalFailure((code) => {
      if (this.active === meeting) void this.fail(code);
    });
    this.active = meeting;

    const opens = await Promise.allSettled(
      SOURCES.map((source) => client.open(identities[source])),
    );
    if (this.active !== meeting) throw new Error('parakeet_cancelled');
    if (opens.some((result) => result.status === 'rejected')) {
      await this.fail('parakeet_live_unavailable');
      throw new Error('parakeet_live_unavailable');
    }
  }

  async append(append: ParakeetEouMeetingAppend): Promise<void> {
    const meeting = this.requireMeeting(append.meetingId);
    const identity = meeting.identities[append.source];
    if (!identity) throw new Error('parakeet_request_invalid');
    const sequence = meeting.nextSequence[append.source];
    try {
      await meeting.client.append({
        ...identity,
        sequence,
        sampleRate: append.sampleRate,
        samples: append.samples,
        audioStartSeconds: append.audioStartSeconds,
        audioEndSeconds: append.audioEndSeconds,
      });
      if (this.active === meeting) meeting.nextSequence[append.source] += 1;
    } catch {
      if (this.active === meeting) await this.fail('parakeet_live_unavailable');
      throw new Error('parakeet_live_unavailable');
    }
  }

  async finish(meetingId: string): Promise<void> {
    const meeting = this.requireMeeting(meetingId);
    try {
      await Promise.all(
        SOURCES.map((source) =>
          meeting.client.finish(meeting.identities[source]),
        ),
      );
      if (this.active === meeting) this.detach(meeting);
      await meeting.client.close();
    } catch {
      if (this.active === meeting) await this.fail('parakeet_live_unavailable');
      throw new Error('parakeet_live_unavailable');
    }
  }

  async speakerEvidence(meetingId: string): Promise<SpeakerEvidenceResult> {
    const meeting = this.requireMeeting(meetingId);
    return await meeting.client.speakerEvidence(meeting.identities.system);
  }

  async cancel(
    meetingId?: string,
    reason = 'parakeet_cancelled',
  ): Promise<void> {
    const current = this.active ?? this.pendingStart;
    if (meetingId && current && current.meetingId !== meetingId) {
      return;
    }
    await this.fail(reason);
  }

  async fail(code: string): Promise<void> {
    const pending = this.pendingStart;
    if (pending) {
      this.pendingStart = null;
      this.options.onUnavailable({
        meetingId: pending.meetingId,
        owner: pending.owner,
        code,
      });
    }
    if (this.failing) return this.failing;
    const meeting = this.active;
    if (!meeting) return;
    this.detach(meeting);
    this.options.onUnavailable({
      meetingId: meeting.meetingId,
      owner: meeting.owner,
      code,
    });
    const operation = meeting.client.close().finally(() => {
      if (this.failing === operation) this.failing = null;
    });
    this.failing = operation;
    return operation;
  }

  private detach(meeting: ActiveMeeting): void {
    meeting.unsubscribeUpdate();
    meeting.unsubscribeFailure();
    if (this.active === meeting) this.active = null;
  }

  private requireMeeting(meetingId: string): ActiveMeeting {
    if (!this.active || this.active.meetingId !== meetingId) {
      throw new Error('parakeet_meeting_mismatch');
    }
    return this.active;
  }

  private validateStart(start: ParakeetEouMeetingStart): void {
    if (
      !ID_PATTERN.test(start.meetingId) ||
      start.meetingId.includes('..') ||
      !Number.isSafeInteger(start.generation) ||
      start.generation <= 0 ||
      typeof start.owner !== 'string' ||
      start.owner.length === 0
    ) {
      throw new Error('parakeet_request_invalid');
    }
  }
}
