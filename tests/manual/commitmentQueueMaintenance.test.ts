/** Explicit local maintenance: preview first, then apply the saved, revision-guarded plan. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      const directory = process.env.PLUTO_COMMITMENT_DB_DIR;
      if (
        !directory ||
        !path.isAbsolute(directory) ||
        !fs.existsSync(path.join(directory, 'pluto.db'))
      )
        throw new Error('An explicit existing database directory is required');
      return directory;
    },
  },
}));

const suite =
  process.env.RUN_COMMITMENT_QUEUE_MAINTENANCE === '1'
    ? describe
    : describe.skip;
suite('explicit commitment queue maintenance', () => {
  it('previews or applies a revision-guarded semantic reconciliation plan', async () => {
    const db = await import('../../electron/db');
    const { previewPendingCommitmentCleanup, COMMITMENT_REVIEW_VERSION } =
      await import('../../electron/commitmentReconciliation');
    const { getAllSettings, getProvider } = await import(
      '../../electron/llm/factory'
    );
    const reportPath = process.env.COMMITMENT_REVIEW_REPORT;
    if (!reportPath || !path.isAbsolute(reportPath))
      throw new Error('An absolute private report path is required');
    const mode = process.env.COMMITMENT_REVIEW_MODE || 'preview';
    if (mode === 'apply') {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Awaited<
        ReturnType<typeof previewPendingCommitmentCleanup>
      >;
      if (
        !Array.isArray(report.aliases) ||
        typeof report.revision !== 'string' ||
        report.reviewVersion !== COMMITMENT_REVIEW_VERSION
      )
        throw new Error('Invalid review report');
      const reviewed = db
        .getEntitiesByType('action_item')
        .filter(
          (entity) =>
            JSON.parse(entity.metadata || '{}').commitment_state !== 'possible',
        );
      db.commitCommitmentAliases(report.revision, report.aliases);
      for (const entity of reviewed)
        expect(db.getEntity(entity.id)).toEqual(entity);
      for (const alias of report.aliases) {
        expect(db.resolveCommitmentIdentity(alias.extractionId)?.id).toBe(
          alias.canonicalId,
        );
        expect(
          db
            .getEntitiesByType('action_item')
            .some((entity) => entity.id === alias.extractionId),
        ).toBe(false);
      }
      console.log(
        JSON.stringify({
          applied: report.aliases.length,
          reviewedRecordsPreserved: reviewed.length,
        }),
      );
    } else if (mode === 'restore') {
      const extractionId = process.env.COMMITMENT_RESTORE_ID;
      if (!extractionId) throw new Error('Explicit extraction ID required');
      db.restoreCommitmentAlias(extractionId);
      expect(db.resolveCommitmentIdentity(extractionId)?.id).toBe(extractionId);
      console.log(JSON.stringify({ restored: extractionId }));
    } else if (mode === 'preview') {
      const settings = await getAllSettings(db);
      // A maintenance preview never silently switches provider or sends local
      // meeting history to a fallback cloud provider.
      if (settings.llm_provider && settings.llm_provider !== 'ollama')
        throw new Error('This local maintenance runner requires Ollama');
      const provider = await getProvider(settings);
      if (provider.name !== 'Ollama (Local)')
        throw new Error('Local provider unavailable');
      let batches = 0;
      const report = await previewPendingCommitmentCleanup(
        async (prompt, responseSchema, signal) => {
          console.log(JSON.stringify({ reviewingBatch: ++batches }));
          return provider.synthesizeKnowledgeDocument(prompt, {
            purpose: 'commitmentReconciliation',
            responseSchema,
            signal,
          });
        },
        AbortSignal.timeout(1_800_000),
      );
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
      console.log(
        JSON.stringify({
          examined: report.examined,
          duplicates: report.aliases.length,
          batches,
          reportPath,
        }),
      );
    } else throw new Error('Unknown maintenance mode');
  }, 1_860_000);
});
