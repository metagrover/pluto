import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-profile-synthesis-${process.pid}`,
  synthesize: vi.fn(),
  providerName: 'Ollama',
}));
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
vi.mock('../../electron/llm/factory', () => ({
  getProvider: async () => ({
    name: fixture.providerName,
    synthesizeKnowledgeDocument: fixture.synthesize,
  }),
  getAllSettings: () => ({}),
}));

import * as db from '../../electron/db';
import { refreshKnowledgeDocNow } from '../../electron/knowledgeSynthesis';
import { PERSON_CONTEXT_SYNTHESIS_VERSION } from '../../src/utils/personDossierRead';
import { readPersonProfile } from '../../src/utils/personProfile';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

describe('comprehensive person profile publication', () => {
  it('retains full reviewed citations when consolidation shortens them and retains the dossier on invalid output', async () => {
    const person = db.upsertEntity({
      id: 'profile-person',
      type: 'person',
      name: 'Avery Chen',
    });
    for (const index of [1, 2, 3]) {
      const id = `meeting-${index}`;
      const quote = `Avery Chen requested a written recommendation for review ${index}.`;
      db.saveMeeting({
        id,
        title: `Planning review ${index}`,
        started_at: `2026-09-0${index}T12:00:00.000Z`,
        duration_seconds: 1800,
        enhanced_notes:
          'A substantive planning discussion with written recommendations. '.repeat(
            20,
          ),
        analysis_json: JSON.stringify({
          analysis_schema_version: 3,
          overview: 'Review',
          topics: [{ key_points: [{ text: quote }] }],
        }),
      });
      db.addMeetingEntity({
        meeting_id: id,
        entity_id: person.id,
        context: quote,
      });
    }
    const doc = db.upsertKnowledgeDoc({
      scope_type: 'person_context',
      scope_key: person.id,
      title: 'Conversations with Avery Chen',
    });
    fixture.synthesize.mockImplementation(
      async (_prompt: string, options: any) => {
        const ids: string[] =
          options.responseSchema.properties.profile.items.properties.citations
            .items.properties.meeting_id.enum;
        const consolidated = fixture.synthesize.mock.calls.length === 3;
        return JSON.stringify({
          profile: [
            {
              section: 'overview',
              summary:
                'Avery requested written recommendations in the available reviews.',
              citations: ids.map((id) => ({
                meeting_id: id,
                quote: consolidated
                  ? 'Avery Chen requested a written recommendation'
                  : `Avery Chen requested a written recommendation for review ${id.at(-1)}.`,
              })),
            },
          ],
        });
      },
    );
    const saved = await refreshKnowledgeDocNow(doc.id);
    expect(saved?.status).toBe('up_to_date');
    expect(fixture.synthesize).toHaveBeenCalledTimes(3);
    const profile = readPersonProfile(saved?.structured_json);
    expect(profile).toHaveLength(1);
    expect(profile[0].citations).toHaveLength(3);
    expect(profile[0].citations[0].quote).toBe(
      'Avery Chen requested a written recommendation for review 3.',
    );
    expect(saved?.rendered_content).toContain(profile[0].summary);
    expect(JSON.parse(saved!.config!).synthesis_version).toBe(
      PERSON_CONTEXT_SYNTHESIS_VERSION,
    );
    const versions = db.getKnowledgeDocVersions(doc.id).length;

    fixture.synthesize.mockResolvedValue('{}');
    const failed = await refreshKnowledgeDocNow(doc.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.structured_json).toBe(saved?.structured_json);
    expect(db.getKnowledgeDocVersions(doc.id)).toHaveLength(versions);
  });
  it('synthesizes all cloud profile sources once and does not split a failed paid request', async () => {
    fixture.providerName = 'ChatGPT';
    fixture.synthesize.mockClear();
    fixture.synthesize.mockImplementation(
      async (_prompt: string, options: any) => {
        const ids: string[] =
          options.responseSchema.properties.profile.items.properties.citations
            .items.properties.meeting_id.enum;
        expect(new Set(ids).size).toBe(3);
        return JSON.stringify({
          profile: [
            {
              section: 'overview',
              summary: 'Avery requested written recommendations.',
              citations: ids.map((id) => ({
                meeting_id: id,
                quote: `Avery Chen requested a written recommendation for review ${id.at(-1)}.`,
              })),
            },
          ],
        });
      },
    );
    const doc = db.getKnowledgeDocByScope('person_context', 'profile-person')!;
    const saved = await refreshKnowledgeDocNow(doc.id, { userRequested: true });
    expect(saved?.status).toBe('up_to_date');
    expect(fixture.synthesize).toHaveBeenCalledTimes(1);
    expect(readPersonProfile(saved?.structured_json)[0].citations).toHaveLength(
      3,
    );
    fixture.synthesize
      .mockClear()
      .mockRejectedValue(new Error('context_length_exceeded'));
    const failed = await refreshKnowledgeDocNow(doc.id, {
      userRequested: true,
    });
    expect(fixture.synthesize).toHaveBeenCalledTimes(1);
    expect(failed?.status).toBe('failed');
    expect(failed?.structured_json).toBe(saved?.structured_json);
  });
});
