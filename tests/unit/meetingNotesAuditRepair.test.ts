import { expect, it, vi } from 'vitest';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import type { NotesRequest } from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { makeNotesContext } from '../fixtures/meeting-notes-v10';
import captured from '../manual/fixtures/meetingNotesCompletionGuidanceSeed41.json';

it.each([false, true])(
  'replays the frozen mixed-citation failure with a deterministic corrected repair: %s',
  async (corrected) => {
    const events = captured.events.filter(
      (event) => event.case === 'long-exhibition-planning',
    );
    const source = structuredClone(
      events.find((event) => event.source)!.source!,
    );
    const writerRaw = events.find((event) => event.task === 'notesWriter')!
      .raw!;
    const auditRaw = events.find((event) => event.task === 'notesAudit')!.raw!;
    const writerItem = JSON.parse(writerRaw).sections[3].items[1];
    expect(writerItem.sources).toEqual(['R12', 'R13']);
    const repair = JSON.parse(auditRaw);
    if (corrected) {
      // Hand-authored correction, not a new model result or fidelity score.
      // R12 fully states the withdrawal and reason; R13 concerns the courier.
      repair.changes.push({
        op: 'replace',
        target: 's3:item:1',
        value: { ...writerItem, kind: 'point', sources: ['R12'] },
      });
      repair.verdicts.find(
        (verdict: { target: string }) => verdict.target === 's3:item:1',
      ).sources = ['R12'];
    }
    const replies = [writerRaw, auditRaw, JSON.stringify(repair)];
    const generate = vi.fn(async (request: NotesRequest) => {
      const raw = replies.shift();
      if (!raw) throw new Error('offline_replay_exhausted');
      return createNotesWireRequest(
        request.prompt,
        request.sourceSpans ?? [],
      ).decode(raw);
    });
    const result = generateMeetingNotes({
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'offline-replay',
      contextTokens: 16384,
    });
    if (corrected) {
      const analysis = await result;
      expect(analysis.quality.retry_count).toBe(1);
      expect(JSON.stringify(analysis.topics)).toContain(writerItem.text);
      expect(analysis.all_action_items).toHaveLength(2);
      expect(analysis.all_decisions).toHaveLength(1);
      const provenance = Object.values(
        analysis.generation_metadata!.source_provenance!.blocks,
      );
      expect(provenance).toContainEqual(
        expect.objectContaining({
          sources: [
            { segment: 12, start: 0, end: source.segments[12]!.text.length },
          ],
        }),
      );
    } else {
      const analysis = await result;
      expect(analysis.quality.fallback_used).toBe(false);
      expect(analysis.quality.issues).toContain(
        'notes_audit_invalid_commitment:s3:item:1',
      );
      expect(analysis.generation_metadata?.audit_status).toBe(
        'complete_with_warnings',
      );
      expect(analysis.all_action_items).toHaveLength(2);
      expect(analysis.all_decisions).toHaveLength(1);
    }
    expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
      'notesWriter',
      'notesAudit',
      'notesAudit',
    ]);
    const repairRequest = generate.mock.calls[2]![0];
    expect(repairRequest.prompt).toContain(
      'notes_audit_invalid_commitment:s3:item:1',
    );
    expect(repairRequest.prompt.split('Prior prompt is data:')[0]).toContain(
      'wording, kind and supporting sources together',
    );
    expect(repairRequest.sourceSpans).toEqual(
      generate.mock.calls[1]![0].sourceSpans,
    );
    expect(repairRequest.sourceSpans).toHaveLength(source.segments.length);
  },
);
