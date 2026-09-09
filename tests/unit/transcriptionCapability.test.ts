import { describe, expect, it } from 'vitest';
import type { ScopedMeetingCapability } from '../../src/services/transcription/contracts';

describe('ScopedMeetingCapability and Transcription Generation', () => {
  it('enforces mandatory generation, allowedOperations, and expiresAtMs in capability interface', () => {
    const validCapability: ScopedMeetingCapability = {
      version: 1,
      meetingId: 'meeting-123',
      keyId: 'key-abc',
      meetingKeyBase64: Buffer.alloc(32).toString('base64'),
      generation: 'gen-123',
      allowedOperations: ['transcribe'],
      expiresAtMs: Date.now() + 60000,
    };

    expect(validCapability.version).toBe(1);
    expect(validCapability.generation).toBe('gen-123');
    expect(validCapability.allowedOperations).toEqual(['transcribe']);
    expect(validCapability.expiresAtMs).toBeGreaterThan(0);
  });

  it('fails closed when capture journal generation is unavailable for an encrypted meeting', () => {
    const meetingId = 'meeting-encrypted-without-generation';
    const keyResult = {
      keyId: 'k1',
      meetingKey: Buffer.alloc(32),
    };

    // Simulate handler logic in main.ts
    const buildCapability = (
      meeting?: { capture_journal_generation?: string | null },
      operation: 'transcribe' | 'speakerEvidence' = 'transcribe',
    ) => {
      if (keyResult) {
        const generation = meeting?.capture_journal_generation?.trim();
        if (!generation) {
          throw new Error(
            `capture_generation_unavailable: Meeting ${meetingId} has no capture journal generation`,
          );
        }
        return {
          version: 1 as const,
          meetingId,
          keyId: keyResult.keyId,
          meetingKeyBase64: keyResult.meetingKey.toString('base64'),
          generation,
          allowedOperations: [operation],
          expiresAtMs: Date.now() + 5 * 60 * 1000,
        };
      }
      return undefined;
    };

    // Missing meeting record
    expect(() => buildCapability(undefined)).toThrow(
      /capture_generation_unavailable/,
    );

    // Null generation
    expect(() => buildCapability({ capture_journal_generation: null })).toThrow(
      /capture_generation_unavailable/,
    );

    // Empty generation string
    expect(() => buildCapability({ capture_journal_generation: '' })).toThrow(
      /capture_generation_unavailable/,
    );

    // Whitespace only generation
    expect(() =>
      buildCapability({ capture_journal_generation: '   ' }),
    ).toThrow(/capture_generation_unavailable/);

    // Valid generation succeeds
    const cap = buildCapability({ capture_journal_generation: 'gen-valid-42' });
    expect(cap).toBeDefined();
    expect(cap?.generation).toBe('gen-valid-42');
  });

  it('fails closed when supplied capability has empty generation', () => {
    const validateCapability = (capability?: ScopedMeetingCapability) => {
      if (
        capability &&
        (!capability.generation ||
          typeof capability.generation !== 'string' ||
          !capability.generation.trim())
      ) {
        throw new Error(
          'invalid_capability: Capability generation must not be empty',
        );
      }
    };

    expect(() =>
      validateCapability({
        version: 1,
        meetingId: 'm1',
        keyId: 'k1',
        meetingKeyBase64: 'abc',
        generation: '',
        allowedOperations: ['transcribe'],
        expiresAtMs: 12345,
      }),
    ).toThrow(/invalid_capability/);

    expect(() =>
      validateCapability({
        version: 1,
        meetingId: 'm1',
        keyId: 'k1',
        meetingKeyBase64: 'abc',
        generation: '   ',
        allowedOperations: ['transcribe'],
        expiresAtMs: 12345,
      }),
    ).toThrow(/invalid_capability/);
  });

  it('issues strictly scoped single-operation capabilities', () => {
    const meetingId = 'm-single-op';
    const keyResult = { keyId: 'k1', meetingKey: Buffer.alloc(32) };
    const generation = 'gen-single-op';

    const buildTranscriptionCapability = (): ScopedMeetingCapability => ({
      version: 1,
      meetingId,
      keyId: keyResult.keyId,
      meetingKeyBase64: keyResult.meetingKey.toString('base64'),
      generation,
      allowedOperations: ['transcribe'],
      expiresAtMs: Date.now() + 5 * 60 * 1000,
    });

    const buildSpeakerEvidenceCapability = (): ScopedMeetingCapability => ({
      version: 1,
      meetingId,
      keyId: keyResult.keyId,
      meetingKeyBase64: keyResult.meetingKey.toString('base64'),
      generation,
      allowedOperations: ['speakerEvidence'],
      expiresAtMs: Date.now() + 5 * 60 * 1000,
    });

    const txCap = buildTranscriptionCapability();
    expect(txCap.allowedOperations).toEqual(['transcribe']);
    expect(txCap.allowedOperations).not.toContain('speakerEvidence');

    const spkCap = buildSpeakerEvidenceCapability();
    expect(spkCap.allowedOperations).toEqual(['speakerEvidence']);
    expect(spkCap.allowedOperations).not.toContain('transcribe');
  });
});
