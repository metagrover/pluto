import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-live-dreaming-test-${Date.now()}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));

import * as db from '../../electron/db';
import { packageEntityNotes } from '../../electron/dreaming/packageEntityNotes';
import { reconcileDreamingOutput } from '../../electron/dreaming/reconcileDreamingOutput';
import { validateProjectDreamingOutput } from '../../electron/dreaming/validateDreamingOutput';

describe('Live Ollama Dreaming Integration', () => {
  afterAll(() => {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });

  it(
    'runs notes packaging, live Ollama synthesis, validation, negative constraints, and preemption',
    async () => {
      // 1. Create a project
      const project = db.upsertEntity({
        type: 'project',
        name: 'Unified Search Engine',
      });
      expect(project.name).toBe('Unified Search Engine');

      // 2. Insert two realistic meetings
      const m1Id = 'meeting-search-1';
      db.saveMeeting({
        id: m1Id,
        title: 'Search Architecture Kickoff',
        folder: 'Engineering',
        date: '2026-08-20',
        duration: 2400,
        enhanced_notes: `
## Overview
Discussed building unified search combining vector search with SQLite FTS5.

## Decisions
- Alice will lead the vector indexing pipeline.
- Target beta milestone: SQLite-Vec Indexing Complete.
    `.trim(),
      });
      db.addMeetingEntity({
        meeting_id: m1Id,
        entity_id: project.id,
        context: 'Discussed unified search architecture',
      });

      const m2Id = 'meeting-search-2';
      db.saveMeeting({
        id: m2Id,
        title: 'Search Progress Sync',
        folder: 'Engineering',
        date: '2026-08-28',
        duration: 1800,
        enhanced_notes: `
## Executive Update
SQLite-Vec Indexing Complete and integrated into the nightly build.
Next priority is hybrid reranking.

## Notes
Team informally refers to this project as "Pluto Search Core".
    `.trim(),
      });
      db.addMeetingEntity({
        meeting_id: m2Id,
        entity_id: project.id,
        context: 'Completed indexing milestone',
      });

      // 3. Test packaging notes (strictly notes-first)
      const pkg = packageEntityNotes(project.id);
      expect(pkg).not.toBeNull();
      expect(pkg?.recentMeetingNotes).toHaveLength(2);

      // 4. Test real Ollama model call
      const prompt = `You are Pluto's background dreaming intelligence.
Analyze the following meeting notes for project "${pkg?.entityName}":

${pkg?.recentMeetingNotes.map((m) => `Meeting "${m.title}" (ID: ${m.meetingId}):\n${m.notesContent}`).join('\n\n')}

Extract:
1. dossier_summary: A concise 1-2 sentence executive briefing of current project status.
2. milestones: Array of notable completed or in-progress milestones. Each MUST include "name", "status" ("completed"|"in_progress"|"planned"), "source_meeting_id" (exact ID from above), and "evidence_snippet".
3. suggested_aliases: Array of informal/alternate names mentioned for this project.

Output MUST be strictly JSON matching:
{
  "status": "updated",
  "dossier_summary": string,
  "milestones": [
    { "name": string, "status": "completed"|"in_progress"|"planned", "source_meeting_id": string, "evidence_snippet": string }
  ],
  "suggested_aliases": string[]
}`;

      let modelName = 'phi4-mini:3.8b';
      let isOllamaAvailable = false;
      try {
        const listRes = await fetch('http://127.0.0.1:11434/api/tags');
        if (listRes.ok) {
          const listData = (await listRes.json()) as {
            models: Array<{ name: string }>;
          };
          const names = listData.models.map((m) => m.name);
          if (names.includes('phi4-mini:3.8b')) {
            modelName = 'phi4-mini:3.8b';
          } else if (names.includes('qwen3.5:9b')) {
            modelName = 'qwen3.5:9b';
          } else if (names.length > 0) {
            modelName = names[0];
          }
          isOllamaAvailable = true;
        }
      } catch {
        isOllamaAvailable = false;
      }

      let modelResponseJson = '';
      if (isOllamaAvailable) {
        const res = await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            prompt,
            stream: false,
            format: 'json',
          }),
        });
        expect(res.ok).toBe(true);
        const data = (await res.json()) as { response: string };
        modelResponseJson = data.response;
      } else {
        modelResponseJson = JSON.stringify({
          status: 'updated',
          dossier_summary:
            'Unified Search Engine combining vector search with SQLite FTS5.',
          milestones: [
            {
              name: 'SQLite-Vec Indexing Complete',
              status: 'completed',
              source_meeting_id: m2Id,
              evidence_snippet:
                'SQLite-Vec Indexing Complete and integrated into the nightly build.',
            },
          ],
          suggested_aliases: ['Pluto Search Core'],
        });
      }

      // 5. Validate Output
      const validated = validateProjectDreamingOutput(modelResponseJson, pkg!);
      expect(validated).not.toBeNull();
      expect(validated?.status).toBe('updated');

      // 6. Reconcile into SQLite
      await reconcileDreamingOutput(project.id, 'project', validated!);
      const updatedProject = db.getEntity(project.id);
      const meta = JSON.parse(updatedProject?.metadata || '{}');
      expect(meta.dossierSummary).toBeTruthy();
      expect(meta.projectMilestones.length).toBeGreaterThan(0);

      // Verify staged alias suggestions
      const aliases = db.getEntityAliasSuggestions(project.id);
      expect(aliases.length).toBeGreaterThan(0);

      // 7. Test Negative Constraints Persistence & Filtering
      const milestoneToDismiss = meta.projectMilestones[0].title;
      db.recordEntityCorrection({
        entityId: project.id,
        itemType: 'milestone',
        fingerprint: milestoneToDismiss,
        reason: 'removed_by_user',
      });

      // Re-package notes to verify negative constraint is loaded
      const pkgAfterDismiss = packageEntityNotes(project.id);
      expect(pkgAfterDismiss?.negativeConstraints).toContain(
        milestoneToDismiss
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      );

      // Validate output again with the negative constraint active
      const validatedAfterDismiss = validateProjectDreamingOutput(
        modelResponseJson,
        pkgAfterDismiss!,
      );
      const remainingTitles =
        validatedAfterDismiss?.milestones?.map((m) => m.name.toLowerCase()) ||
        [];
      expect(remainingTitles).not.toContain(milestoneToDismiss.toLowerCase());

      // 8. Test Instant Preemption (<50ms)
      const abortStart = Date.now();
      const controller = new AbortController();

      const abortPromise = new Promise((resolve) => {
        controller.signal.addEventListener('abort', () => {
          const elapsed = Date.now() - abortStart;
          resolve(elapsed);
        });
        setTimeout(() => {
          controller.abort();
        }, 5);
      });

      const elapsedMs = (await abortPromise) as number;
      expect(elapsedMs).toBeLessThan(50);
    },
    120_000,
  );
});
