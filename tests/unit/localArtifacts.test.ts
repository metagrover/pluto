import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-local-artifacts-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  deleteLocalArtifact,
  listLocalArtifacts,
  saveLocalArtifact,
  searchLocalArtifacts,
  searchLocalArtifactsFts,
  setLocalArtifactStatus,
} from '../../electron/db';
import {
  classifyLocalArtifactQuality,
  createLocalArtifactRecord,
  extractArtifactContent,
  extractTextFromDocx,
  extractTextFromPages,
  extractTextFromPdf,
  normalizeLocalArtifactText,
  resolveLocalArtifactType,
} from '../../electron/localArtifacts';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('local artifact ingestion', () => {
  it('normalizes Markdown and records deterministic provenance and quality', () => {
    const content =
      '\uFEFF# Launch plan\r\n\r\nThe Juniper rollout begins Friday with a canary group.\r\nSupport owns the customer update.   \r\n';
    const artifact = createLocalArtifactRecord({
      path: '/tmp/launch-plan.md',
      content,
      capturedAt: '2026-09-19T18:00:00.000Z',
      importedAt: '2026-09-20T18:00:00.000Z',
    });

    expect(normalizeLocalArtifactText(content)).not.toContain('\r');
    expect(artifact).toMatchObject({
      type: 'markdown',
      title: 'launch-plan',
      captured_at: '2026-09-19T18:00:00.000Z',
      imported_at: '2026-09-20T18:00:00.000Z',
      source_quality: 'usable',
      trust_status: 'grounded',
      status: 'active',
    });
    expect(artifact.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('classifies short source material as limited evidence', () => {
    expect(classifyLocalArtifactQuality('Remember Juniper.')).toEqual({
      sourceQuality: 'limited',
      trustStatus: 'weak_evidence',
    });
  });

  it('resolves supported extensions including pdf, docx, and pages', () => {
    expect(resolveLocalArtifactType('/docs/plan.md')).toBe('markdown');
    expect(resolveLocalArtifactType('/docs/notes.markdown')).toBe('markdown');
    expect(resolveLocalArtifactType('/docs/notes.txt')).toBe('text');
    expect(resolveLocalArtifactType('/docs/spec.pdf')).toBe('pdf');
    expect(resolveLocalArtifactType('/docs/spec.docx')).toBe('docx');
    expect(resolveLocalArtifactType('/docs/meeting.pages')).toBe('pages');
    expect(resolveLocalArtifactType('/docs/unknown.exe')).toBeNull();
  });

  it('extracts text from PDF documents using unpdf', async () => {
    const minimalPdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >> endobj
4 0 obj << /Length 44 >> stream
BT
/F1 12 Tf
72 712 Td
(Hello World Pluto PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
trailer << /Root 1 0 R /Size 5 >>
startxref
308
%%EOF`);

    const text = await extractTextFromPdf(minimalPdf);
    expect(text).toContain('Hello World Pluto PDF');

    const extractedViaHelper = await extractArtifactContent(
      '/tmp/sample.pdf',
      minimalPdf,
    );
    expect(extractedViaHelper).toBe('Hello World Pluto PDF');
  });

  it('extracts text from Word documents using textutil on macOS', async () => {
    const docxPath = path.join(testDatabase.directory, 'sample.docx');
    fs.mkdirSync(testDatabase.directory, { recursive: true });
    execFileSync(
      '/usr/bin/textutil',
      ['-convert', 'docx', '-stdin', '-output', docxPath],
      {
        input:
          'Architecture spec for local intelligence in Pluto.\nCovers FTS5 indexing and native extraction.',
      },
    );

    const text = await extractTextFromDocx(docxPath);
    expect(text).toContain(
      'Architecture spec for local intelligence in Pluto.',
    );
    expect(text).toContain('Covers FTS5 indexing and native extraction.');

    const extractedViaHelper = await extractArtifactContent(docxPath);
    expect(extractedViaHelper).toBe(text);
  });

  it('extracts text from Pages documents when available', async () => {
    const samplePages =
      '/Users/metagrover/Desktop/work/Cognitive_AI_Interview_Guide.pages';
    if (fs.existsSync(samplePages)) {
      const text = await extractTextFromPages(samplePages);
      expect(text).toContain('Cognitive Task Analysis');
      expect(text).toContain('GOMS');

      const extractedViaHelper = await extractArtifactContent(samplePages);
      expect(extractedViaHelper).toContain('Cognitive Task Analysis');
    }
  });

  it('persists and indexes docx and pages artifacts with FTS5', () => {
    const docx = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/project-plan.docx',
        content:
          'Word Document detailing the project roadmap and sprint deliverables.',
      }),
    );
    expect(docx.type).toBe('docx');
    expect(searchLocalArtifactsFts(['deliverables'])).toEqual([
      expect.objectContaining({ id: docx.id }),
    ]);

    const pages = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/meeting-notes.pages',
        content:
          'Pages document summarizing stakeholder decisions and user feedback.',
      }),
    );
    expect(pages.type).toBe('pages');
    expect(searchLocalArtifactsFts(['stakeholder'])).toEqual([
      expect.objectContaining({ id: pages.id }),
    ]);

    deleteLocalArtifact(docx.id);
    deleteLocalArtifact(pages.id);
  });

  it('persists, indexes in FTS5, searches, excludes, and restores a local source', () => {
    const saved = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/customer-research.txt',
        content:
          'Customer research notes confirm that Juniper users need a staged migration and a support-owned announcement before Friday.',
      }),
    );

    expect(listLocalArtifacts()).toContainEqual(
      expect.objectContaining({ id: saved.id, status: 'active' }),
    );

    // Substring search
    expect(searchLocalArtifacts(['Juniper', 'migration'])).toEqual([
      expect.objectContaining({ id: saved.id }),
    ]);

    // FTS5 BM25 search
    const ftsMatches = searchLocalArtifactsFts(['Juniper', 'migration']);
    expect(ftsMatches).toEqual([expect.objectContaining({ id: saved.id })]);
    expect(ftsMatches[0].match_score).toBeGreaterThan(0);

    // Exclude
    expect(setLocalArtifactStatus(saved.id, 'excluded')).toMatchObject({
      status: 'excluded',
    });
    expect(searchLocalArtifacts(['Juniper'])).toEqual([]);
    expect(searchLocalArtifactsFts(['Juniper'])).toEqual([]);

    // Restore
    expect(setLocalArtifactStatus(saved.id, 'active')).toMatchObject({
      status: 'active',
      source_quality: 'usable',
      trust_status: 'grounded',
    });
    expect(searchLocalArtifacts(['Juniper'])).toHaveLength(1);
    expect(searchLocalArtifactsFts(['Juniper'])).toHaveLength(1);
  });

  it('updates an existing source when re-importing the same path with modified text', () => {
    const filePath = '/tmp/project-roadmap.md';
    const first = saveLocalArtifact(
      createLocalArtifactRecord({
        path: filePath,
        content:
          'Original roadmap: Launch v1 in Q3 with focus on local storage.',
      }),
    );

    const second = saveLocalArtifact(
      createLocalArtifactRecord({
        path: filePath,
        content:
          'Revised roadmap: Launch v1 in Q4 with focus on local storage and encryption.',
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.extracted_text).toContain('Revised roadmap');
    expect(second.content_hash).not.toBe(first.content_hash);

    const all = listLocalArtifacts().filter(
      (a) => a.original_path === filePath,
    );
    expect(all).toHaveLength(1);

    // Verify FTS5 indexed the updated content
    const searchResult = searchLocalArtifactsFts(['encryption']);
    expect(searchResult).toEqual([expect.objectContaining({ id: first.id })]);
  });

  it('deletes a local artifact and purges its FTS entry', () => {
    const saved = saveLocalArtifact(
      createLocalArtifactRecord({
        path: '/tmp/to-be-deleted.md',
        content: 'Sensitive ephemeral note that will be deleted permanently.',
      }),
    );

    expect(searchLocalArtifactsFts(['ephemeral'])).toEqual([
      expect.objectContaining({ id: saved.id }),
    ]);

    const deleted = deleteLocalArtifact(saved.id);
    expect(deleted).toBe(true);

    expect(listLocalArtifacts().find((a) => a.id === saved.id)).toBeUndefined();
    expect(searchLocalArtifactsFts(['ephemeral'])).toEqual([]);
  });
});
