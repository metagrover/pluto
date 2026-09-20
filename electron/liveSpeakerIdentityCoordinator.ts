import { randomUUID } from 'node:crypto';
import type {
  LiveSpeakerIdentityHint,
  LiveSpeakerIdentitySnapshot,
} from '../src/services/liveTranscription/liveSpeakerIdentityContract';
import {
  ENROLLMENT_EXTRACTION_VERSION,
  type SpeakerCandidateEvidence,
  computeCandidateDigest,
  isCandidateEligibleForEnrollment,
} from '../src/services/speakerCandidateEvidence';
import { matchSpeakerVoiceOutcome } from '../src/services/speakerVoiceMatcher';
import type {
  CanonicalVoiceProfile,
  SpeakerVoiceRejection,
} from './speakerVoiceStore';
import type { SpeakerEvidenceResult } from './transcription/parakeetFinalClient';

type InternalHint = LiveSpeakerIdentityHint & { personId: string };

type Session = {
  meetingId: string;
  generation: number;
  revision: number;
  previousPeople: Set<string>;
  hints: Map<string, InternalHint>;
  deniedPeople: Set<string>;
};

const mergeRanges = (
  ranges: Array<{ startMs: number; endMs: number }>,
): Array<{ startMs: number; endMs: number }> => {
  const ordered = [...ranges].sort((a, b) => a.startMs - b.startMs);
  const merged: typeof ordered = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.startMs <= previous.endMs + 250) {
      previous.endMs = Math.max(previous.endMs, range.endMs);
    } else {
      merged.push({ ...range });
    }
  }
  return merged.slice(-64);
};

export class LiveSpeakerIdentityCoordinator {
  private session: Session | null = null;

  constructor(
    private readonly dependencies: {
      getProfiles(): CanonicalVoiceProfile[];
      getRejections(meetingId: string): SpeakerVoiceRejection[];
      persistConfirmation(input: {
        meetingId: string;
        suggestionId: string;
        personId: string;
        generation: number;
        revision: number;
        ranges: Array<{ startMs: number; endMs: number }>;
      }): void;
      removeConfirmation(meetingId: string, suggestionId: string): void;
    },
  ) {}

  start(meetingId: string, generation: number): LiveSpeakerIdentitySnapshot {
    this.session = {
      meetingId,
      generation,
      revision: 1,
      previousPeople: new Set(),
      hints: new Map(),
      deniedPeople: new Set(),
    };
    return this.snapshot();
  }

  stop(): void {
    this.session = null;
  }

  applyEvidence(evidence: SpeakerEvidenceResult): LiveSpeakerIdentitySnapshot {
    const session = this.requireSession();
    const profiles = this.dependencies.getProfiles();
    const rejections = this.dependencies.getRejections(session.meetingId);
    const byPerson = new Map<
      string,
      { name: string; ranges: Array<{ startMs: number; endMs: number }> }
    >();

    for (const cluster of evidence.clusterEvidence ?? []) {
      const turns = evidence.turns.filter(
        (turn) => turn.cluster === cluster.cluster,
      );
      if (turns.length === 0) continue;
      const provenance = {
        ...evidence.provenance,
        profileAlgorithmVersion:
          evidence.provenance.profileAlgorithmVersion ?? 'v1',
        ...(cluster.representativeEmbeddings &&
        cluster.representativeEmbeddings.length >= 2
          ? { enrollmentExtractionVersion: ENROLLMENT_EXTRACTION_VERSION }
          : {}),
      };
      const candidate: SpeakerCandidateEvidence = {
        speaker: `live:${cluster.cluster}`,
        nativeCluster: cluster.cluster,
        candidateDigest: computeCandidateDigest(
          cluster.embedding,
          provenance,
          cluster.representativeEmbeddings ?? [],
        ),
        embedding: cluster.embedding,
        representativeEmbeddings: cluster.representativeEmbeddings,
        cleanDurationSeconds: cluster.cleanDurationSeconds,
        cleanSegmentCount: cluster.cleanSegmentCount,
        cleanChunkCount: cluster.cleanChunkCount,
        minimumChunkSimilarity: cluster.minimumChunkSimilarity,
        meanChunkSimilarity: cluster.meanChunkSimilarity,
        referenceInterval: {
          startTime: turns[0].startTime,
          endTime: turns[0].endTime,
          excerpt: '',
        },
        provenance,
        isEligibleForEnrollment: isCandidateEligibleForEnrollment(cluster),
      };
      const outcome = matchSpeakerVoiceOutcome({
        meetingId: session.meetingId,
        sourceRevision: `live:${session.generation}:${session.revision}`,
        candidate,
        profiles,
        rejections,
        options: { featureFlagEnabled: true },
      });
      if (
        outcome.category !== 'suggested' ||
        session.deniedPeople.has(outcome.suggestion.suggestedPersonId)
      ) {
        continue;
      }
      const personId = outcome.suggestion.suggestedPersonId;
      const matched = byPerson.get(personId) ?? {
        name: outcome.suggestion.suggestedPersonName,
        ranges: [],
      };
      for (const turn of turns) {
        matched.ranges.push({
          startMs: turn.startTime * 1_000,
          endMs: turn.endTime * 1_000,
        });
      }
      byPerson.set(personId, matched);
    }

    const nextRevision = session.revision + 1;
    const currentPeople = new Set(byPerson.keys());
    for (const [personId, hint] of session.hints) {
      if (hint.state === 'confirmed' || hint.state === 'rejected') continue;
      if (!currentPeople.has(personId)) {
        session.hints.set(personId, {
          ...hint,
          state: 'revoked',
          revision: nextRevision,
        });
      }
    }
    for (const [personId, matched] of byPerson) {
      if (!session.previousPeople.has(personId)) continue;
      const existing = session.hints.get(personId);
      const ranges = mergeRanges([
        ...(existing?.ranges ?? []),
        ...matched.ranges,
      ]);
      session.hints.set(personId, {
        suggestionId: existing?.suggestionId ?? randomUUID(),
        displayLabel:
          existing?.state === 'confirmed'
            ? matched.name
            : `Likely ${matched.name}`,
        state: existing?.state === 'confirmed' ? 'confirmed' : 'suggested',
        ranges,
        generation: session.generation,
        revision: nextRevision,
        personId,
      });
    }
    session.previousPeople = currentPeople;
    session.revision = nextRevision;
    return this.snapshot();
  }

  act(
    suggestionId: string,
    action: 'confirm' | 'reject' | 'restore',
  ): LiveSpeakerIdentitySnapshot {
    const session = this.requireSession();
    const entry = [...session.hints.entries()].find(
      ([, hint]) => hint.suggestionId === suggestionId,
    );
    if (!entry) throw new Error('live_speaker_suggestion_not_found');
    const [personId, hint] = entry;
    if (
      ((action === 'confirm' || action === 'reject') &&
        hint.state !== 'suggested') ||
      (action === 'restore' &&
        hint.state !== 'confirmed' &&
        hint.state !== 'rejected')
    ) {
      throw new Error('live_speaker_suggestion_state_invalid');
    }
    const nextRevision = session.revision + 1;
    if (action === 'confirm') {
      const displayLabel = hint.displayLabel.replace(/^Likely\s+/u, '');
      const next = {
        ...hint,
        state: 'confirmed' as const,
        displayLabel,
        revision: nextRevision,
      };
      this.dependencies.persistConfirmation({
        meetingId: session.meetingId,
        suggestionId,
        personId,
        generation: session.generation,
        revision: nextRevision,
        ranges: next.ranges,
      });
      session.hints.set(personId, next);
      session.deniedPeople.delete(personId);
    } else if (action === 'reject') {
      this.dependencies.removeConfirmation(session.meetingId, suggestionId);
      const next = {
        ...hint,
        state: 'rejected' as const,
        revision: nextRevision,
      };
      session.deniedPeople.add(personId);
      session.hints.set(personId, next);
    } else {
      this.dependencies.removeConfirmation(session.meetingId, suggestionId);
      const next = {
        ...hint,
        state: 'suggested' as const,
        displayLabel: hint.displayLabel.startsWith('Likely ')
          ? hint.displayLabel
          : `Likely ${hint.displayLabel}`,
        revision: session.revision,
      };
      session.deniedPeople.delete(personId);
      session.hints.set(personId, next);
    }
    session.revision = nextRevision;
    return this.snapshot();
  }

  snapshot(): LiveSpeakerIdentitySnapshot {
    const session = this.requireSession();
    return {
      meetingId: session.meetingId,
      generation: session.generation,
      revision: session.revision,
      hints: [...session.hints.values()].map(
        ({ personId: _personId, ...hint }) => hint,
      ),
    };
  }

  private requireSession(): Session {
    if (!this.session) throw new Error('live_speaker_identity_inactive');
    return this.session;
  }
}
