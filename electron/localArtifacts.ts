import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { extractText } from 'unpdf';
import type { TrustStatus } from '../src/utils/trustStatus';

const execFileAsync = promisify(execFile);

export type LocalArtifactType = 'markdown' | 'text' | 'pdf' | 'docx' | 'pages';
export type LocalArtifactStatus = 'active' | 'noisy' | 'excluded';
export type LocalArtifactSourceQuality = 'usable' | 'limited' | 'noisy';

export interface LocalArtifactRecord {
  id: string;
  type: LocalArtifactType;
  title: string;
  captured_at: string;
  imported_at: string;
  original_path: string;
  content_hash: string;
  extracted_text: string;
  metadata_json: string;
  source_quality: LocalArtifactSourceQuality;
  trust_status: TrustStatus;
  status: LocalArtifactStatus;
  created_at: string;
  updated_at: string;
}

export interface LocalArtifactImportInput {
  path: string;
  content: string;
  capturedAt?: string;
  importedAt?: string;
  metadata?: Record<string, unknown>;
}

const SUPPORTED_EXTENSIONS = new Map<string, LocalArtifactType>([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.mdown', 'markdown'],
  ['.mkd', 'markdown'],
  ['.txt', 'text'],
  ['.text', 'text'],
  ['.pdf', 'pdf'],
  ['.docx', 'docx'],
  ['.pages', 'pages'],
]);

export const normalizeLocalArtifactText = (content: string): string =>
  content
    .replace(/^\uFEFF/, '')
    .replace(/\u00AD/g, '')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

export const extractTextFromPdf = async (
  buffer: Buffer | Uint8Array,
): Promise<string> => {
  try {
    const result = await extractText(new Uint8Array(buffer));
    const pages = Array.isArray(result.text)
      ? result.text
      : [String(result.text || '')];
    const text = pages.filter(Boolean).join('\n\n');
    return normalizeLocalArtifactText(text);
  } catch (error) {
    throw new Error(
      `failed_to_extract_pdf_text: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const extractTextFromDocx = async (
  filePath: string,
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/textutil',
      ['-convert', 'txt', filePath, '-stdout'],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    return normalizeLocalArtifactText(stdout);
  } catch (error) {
    throw new Error(
      `failed_to_extract_docx_text: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const extractTextFromPages = async (
  filePath: string,
): Promise<string> => {
  const tmpPlistPath = path.join(
    os.tmpdir(),
    `pluto-pages-${randomUUID()}.plist`,
  );
  try {
    await execFileAsync(
      '/usr/bin/mdimport',
      ['-t', '-o', tmpPlistPath, filePath],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    if (!fs.existsSync(tmpPlistPath)) {
      return '';
    }
    let rawText = '';
    try {
      const { stdout } = await execFileAsync(
        '/usr/bin/plutil',
        ['-extract', 'kMDItemTextContent', 'raw', tmpPlistPath],
        { maxBuffer: 20 * 1024 * 1024 },
      );
      rawText = stdout;
    } catch (plutilError) {
      const msg =
        plutilError instanceof Error
          ? plutilError.message
          : String(plutilError);
      if (
        msg.includes('No value at that key path') ||
        msg.includes('invalid key path')
      ) {
        return '';
      }
      throw plutilError;
    }
    const cleaned = rawText.replace(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\r?$/gm,
      '',
    );
    return normalizeLocalArtifactText(cleaned);
  } catch (error) {
    throw new Error(
      `failed_to_extract_pages_text: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    try {
      if (fs.existsSync(tmpPlistPath)) {
        fs.unlinkSync(tmpPlistPath);
      }
    } catch {
      // Ignore temporary file cleanup failure
    }
  }
};

export const extractArtifactContent = async (
  filePath: string,
  buffer?: Buffer,
): Promise<string> => {
  const type = resolveLocalArtifactType(filePath);
  if (!type) throw new Error('unsupported_artifact_type');
  if (type === 'pdf') {
    const data = buffer ?? (await fs.promises.readFile(filePath));
    return extractTextFromPdf(data);
  }
  if (type === 'docx') {
    if (buffer && !fs.existsSync(filePath)) {
      const tmpPath = path.join(os.tmpdir(), `pluto-test-${randomUUID()}.docx`);
      try {
        await fs.promises.writeFile(tmpPath, buffer);
        return await extractTextFromDocx(tmpPath);
      } finally {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          // Ignore temp cleanup error
        }
      }
    }
    return extractTextFromDocx(filePath);
  }
  if (type === 'pages') {
    if (buffer && !fs.existsSync(filePath)) {
      const tmpPath = path.join(
        os.tmpdir(),
        `pluto-test-${randomUUID()}.pages`,
      );
      try {
        await fs.promises.writeFile(tmpPath, buffer);
        return await extractTextFromPages(tmpPath);
      } finally {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          // Ignore temp cleanup error
        }
      }
    }
    return extractTextFromPages(filePath);
  }
  const text = buffer
    ? buffer.toString('utf8')
    : await fs.promises.readFile(filePath, 'utf8');
  return normalizeLocalArtifactText(text);
};

export const classifyLocalArtifactQuality = (
  text: string,
): {
  sourceQuality: Exclude<LocalArtifactSourceQuality, 'noisy'>;
  trustStatus: TrustStatus;
} => {
  const normalized = normalizeLocalArtifactText(text);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (normalized.length >= 80 && wordCount >= 12) {
    return { sourceQuality: 'usable', trustStatus: 'grounded' };
  }
  return { sourceQuality: 'limited', trustStatus: 'weak_evidence' };
};

export const resolveLocalArtifactType = (
  filePath: string,
): LocalArtifactType | null =>
  SUPPORTED_EXTENSIONS.get(path.extname(filePath).toLocaleLowerCase()) ?? null;

export const createLocalArtifactRecord = (
  input: LocalArtifactImportInput,
): LocalArtifactRecord => {
  const type = resolveLocalArtifactType(input.path);
  if (!type) throw new Error('unsupported_artifact_type');
  const extractedText = normalizeLocalArtifactText(input.content);
  if (!extractedText) throw new Error('artifact_has_no_text');
  const importedAt = input.importedAt ?? new Date().toISOString();
  const capturedAt = input.capturedAt ?? importedAt;
  const title = path.basename(input.path, path.extname(input.path)).trim();
  const quality = classifyLocalArtifactQuality(extractedText);

  return {
    id: randomUUID(),
    type,
    title: title || 'Untitled source',
    captured_at: capturedAt,
    imported_at: importedAt,
    original_path: path.resolve(input.path),
    content_hash: createHash('sha256').update(extractedText).digest('hex'),
    extracted_text: extractedText,
    metadata_json: JSON.stringify({
      extension: path.extname(input.path),
      ...(input.metadata || {}),
    }),
    source_quality: quality.sourceQuality,
    trust_status: quality.trustStatus,
    status: 'active',
    created_at: importedAt,
    updated_at: importedAt,
  };
};

export const localArtifactStatusProjection = (
  artifact: LocalArtifactRecord,
  status: LocalArtifactStatus,
): Pick<
  LocalArtifactRecord,
  'status' | 'source_quality' | 'trust_status' | 'updated_at'
> => ({
  status,
  source_quality:
    status === 'noisy'
      ? 'noisy'
      : classifyLocalArtifactQuality(artifact.extracted_text).sourceQuality,
  trust_status:
    status === 'noisy'
      ? 'weak_evidence'
      : classifyLocalArtifactQuality(artifact.extracted_text).trustStatus,
  updated_at: new Date().toISOString(),
});
