import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { app, clipboard, dialog, ipcMain, shell } from 'electron';
import {
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
} from '../src/utils/ollamaModels';
import { DREAMING_MODEL } from './dreaming/prompt';
import {
  OPENROUTER_CURATED_MODELS,
  PROVIDER_DEFAULT_MODELS,
} from './llm/providerCatalog';

export type BugReportArea = 'general' | 'project_themes' | 'project_updates';
export type BugReportAction = 'github' | 'email' | 'copy' | 'save';
export type BugReportReason =
  | 'renderer_active'
  | 'system_active'
  | 'capture'
  | 'transcription'
  | 'downstream'
  | 'ask_pluto_session'
  | 'work_paused'
  | 'foreground_preempted'
  | 'source_changed'
  | 'routing_queue_remaining';
export interface BugReportDraft {
  id: string;
  title: string;
  diagnostics: string;
}

type DiagnosticEvent = {
  id: string;
  at: string;
  attemptId: string;
  operation: Exclude<BugReportArea, 'general'>;
  stage:
    | 'collect_sources'
    | 'route_projects'
    | 'synthesize_themes'
    | 'prepare_updates';
  outcome: 'complete' | 'failed' | 'deferred' | 'cancelled';
  durationMs: number;
  sourceCount?: number;
  retryRequested?: boolean;
  errorCode?: string;
  stackFrames?: string[];
  reason?: BugReportReason;
  resultStatus?: string;
  updatedCount?: number;
  proposalCount?: number;
  remainingCount?: number;
  requiredProvider?: string;
  requiredModel?: string;
};

const resultStatuses = new Set([
  'proposed',
  'existing',
  'no_change',
  'busy',
  'ineligible',
  'backoff',
  'exhausted',
  'no_work',
  'invalid_request',
  'cancelled',
  'failed',
  'updated',
  'incomplete',
  'deferred',
]);
const knownModels = new Set<string>([
  ...Object.values(PROVIDER_DEFAULT_MODELS),
  ...OPENROUTER_CURATED_MODELS,
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
  DREAMING_MODEL,
]);
const safeModel = (model: string | undefined) =>
  model && knownModels.has(model) ? model : 'custom (name omitted)';

const safeErrorCodes = new Set([
  'timeout',
  'generation_failed',
  'validation_failed',
  'invalid_json',
  'invalid_output_shape',
  'invalid_no_change',
  'invalid_proposed_output',
  'duplicate_proposal',
  'persistence_failed',
  'lease_expired',
  'unsupported_project_commitment',
  'invalid_theme_response',
  'invalid_project_routing',
  'foreground_preempted',
  'project_response_incomplete',
  'schema_invalid',
  'source_reference_invalid',
  'source_revision_changed',
  'provider_unavailable',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
]);

// Only known codes and app source locations leave the process. Error messages,
// raw stacks and logger metadata can contain private notes or provider responses.
export function bugReportErrorCode(error: unknown): string {
  const candidate =
    typeof error === 'string'
      ? error
      : error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string'
        ? error.code
        : error instanceof Error
          ? error.message
          : '';
  if (safeErrorCodes.has(candidate)) return candidate;
  if (error instanceof SyntaxError) return 'invalid_json';
  if (error instanceof TypeError) return 'type_error';
  if (error instanceof RangeError) return 'range_error';
  if (error instanceof ReferenceError) return 'reference_error';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  return 'unknown_error';
}

function safeStackFrames(error: unknown): string[] {
  if (!(error instanceof Error) || !error.stack) return [];
  // Keep only fixed app filenames and line/column numbers, never function
  // arguments, absolute paths, messages or arbitrary external filenames.
  return error.stack
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const match = line.match(
        /[/\\](main\.js|main\.ts|bootstrap\.js|projectThemeSynthesis\.ts|projectRouting\.ts|idleDreamingCoordinator\.ts|unifiedProvider\.ts|serializedTaskGate\.ts):(\d{1,7}):(\d{1,7})\)?$/,
      );
      return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
    })
    .slice(0, 4);
}

const safeReasons = new Set<string>([
  'renderer_active',
  'system_active',
  'capture',
  'transcription',
  'downstream',
  'ask_pluto_session',
  'work_paused',
  'foreground_preempted',
  'source_changed',
  'routing_queue_remaining',
]);

const recentEvents: Array<{ event: DiagnosticEvent; entityId?: string }> = [];
const latestFailures = new Map<
  string,
  { event: DiagnosticEvent; entityId?: string }
>();
const reports = new Map<
  string,
  BugReportDraft & { owner: number; createdAt: number }
>();

export function recordBugReportEvent(
  input: Omit<DiagnosticEvent, 'id' | 'at' | 'attemptId' | 'errorCode'> & {
    attemptId?: string;
    error?: unknown;
    entityId?: string;
  },
): void {
  // Copy the allowed fields individually; never spread arbitrary metadata.
  const id = randomUUID();
  const event: DiagnosticEvent = {
    id,
    attemptId:
      input.attemptId && /^[a-f0-9-]{36}$/i.test(input.attemptId)
        ? input.attemptId
        : id,
    at: new Date().toISOString(),
    operation: input.operation,
    stage: input.stage,
    outcome: input.outcome,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    ...(Number.isFinite(input.sourceCount)
      ? { sourceCount: input.sourceCount }
      : {}),
    ...(typeof input.retryRequested === 'boolean'
      ? { retryRequested: input.retryRequested }
      : {}),
    ...(input.error !== undefined
      ? { errorCode: bugReportErrorCode(input.error) }
      : {}),
  };
  if (input.reason && safeReasons.has(input.reason))
    event.reason = input.reason;
  if (input.resultStatus && resultStatuses.has(input.resultStatus))
    event.resultStatus = input.resultStatus;
  if (Number.isFinite(input.proposalCount))
    event.proposalCount = input.proposalCount;
  if (Number.isFinite(input.updatedCount))
    event.updatedCount = input.updatedCount;
  if (Number.isFinite(input.remainingCount))
    event.remainingCount = input.remainingCount;
  if (
    input.requiredProvider &&
    Object.hasOwn(PROVIDER_DEFAULT_MODELS, input.requiredProvider)
  )
    event.requiredProvider = input.requiredProvider;
  if (input.requiredModel) event.requiredModel = safeModel(input.requiredModel);
  const stackFrames = safeStackFrames(input.error);
  if (stackFrames.length) event.stackFrames = stackFrames;
  recentEvents.push({ event, entityId: input.entityId });
  if (recentEvents.length > 40) recentEvents.shift();
  if (event.outcome === 'failed') {
    const key = `${event.operation}:${input.entityId ?? ''}`;
    latestFailures.delete(key);
    latestFailures.set(key, { event, entityId: input.entityId });
    if (latestFailures.size > 40)
      latestFailures.delete(latestFailures.keys().next().value!);
  }
}

export function formatBugReport(
  draft: BugReportDraft,
  description: string,
): string {
  return `## What happened?\n${description.trim() || draft.title}\n\n## Expected behavior / steps to reproduce\nPlease add any useful details here before sending.\n\n## Diagnostics\n\`\`\`text\n${draft.diagnostics}\n\`\`\``;
}

export function bugReportDestination(
  action: 'github' | 'email',
  title: string,
  body: string,
): string {
  if (action === 'github') {
    const url = new URL('https://github.com/metagrover/pluto/issues/new');
    url.searchParams.set('title', title);
    url.searchParams.set('body', body);
    return url.toString();
  }
  return `mailto:deepakgrover333+pluto@gmail.com?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export function registerBugReportHandlers(
  getSetting: (key: string) => string | null | undefined,
): void {
  ipcMain.handle('BUG_REPORT_PREPARE', (event, input: unknown) => {
    const request =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {};
    const area = request.area ?? 'general';
    if (
      typeof area !== 'string' ||
      !['general', 'project_themes', 'project_updates'].includes(area) ||
      (request.entityId !== undefined &&
        (typeof request.entityId !== 'string' || request.entityId.length > 256))
    )
      throw new Error('Invalid report context');
    const providerSetting = getSetting('llm_provider') || 'ollama';
    const provider = Object.hasOwn(PROVIDER_DEFAULT_MODELS, providerSetting)
      ? providerSetting
      : 'unknown';
    const model =
      getSetting(`${provider}_model`) ||
      PROVIDER_DEFAULT_MODELS[provider as keyof typeof PROVIDER_DEFAULT_MODELS];
    const matches = ({
      event: item,
      entityId,
    }: { event: DiagnosticEvent; entityId?: string }) =>
      (area === 'general' || item.operation === area) &&
      (request.entityId === undefined || entityId === request.entityId);
    const latestFailure = Array.from(latestFailures.values())
      .filter(matches)
      .at(-1)?.event;
    const events = recentEvents
      .filter(matches)
      .slice(-4)
      .map(({ event: item }) => item);
    const id = randomUUID();
    const draft: BugReportDraft = {
      id,
      title: area === 'general' ? 'Pluto bug report' : 'Project updates failed',
      diagnostics: [
        `Report: ${id}`,
        `Prepared: ${new Date().toISOString()}`,
        `Pluto: ${app.getVersion()}`,
        `OS: ${process.platform} ${os.release()} (${process.arch})`,
        `Provider setting: ${provider}`,
        `Model setting: ${safeModel(model)}`,
        ...(latestFailure
          ? [
              'Latest matching failure from this session (may precede recent events):',
              JSON.stringify(latestFailure),
            ]
          : ['No matching failure in retained session diagnostics.']),
        'Recent diagnostic events from this app session:',
        ...(events.length
          ? events.map((item) => JSON.stringify(item))
          : ['No matching events recorded.']),
      ].join('\n'),
    };
    // Drafts are local snapshots, owned by the requesting window and bounded.
    for (const [key, value] of reports) {
      if (Date.now() - value.createdAt > 30 * 60_000) reports.delete(key);
    }
    if (reports.size >= 20) reports.delete(reports.keys().next().value!);
    reports.set(id, {
      ...draft,
      owner: event.sender.id,
      createdAt: Date.now(),
    });
    return draft;
  });

  ipcMain.handle('BUG_REPORT_ACTION', async (event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid report');
    const request = input as Record<string, unknown>;
    const report =
      typeof request.id === 'string' ? reports.get(request.id) : undefined;
    if (
      !report ||
      report.owner !== event.sender.id ||
      Date.now() - report.createdAt > 30 * 60_000
    )
      throw new Error('Report expired. Close and reopen the report.');
    if (
      typeof request.action !== 'string' ||
      !['github', 'email', 'copy', 'save'].includes(request.action) ||
      typeof request.description !== 'string' ||
      request.description.length > 2000
    )
      throw new Error('Invalid report action');
    const body = formatBugReport(report, request.description);
    if (request.action === 'copy') {
      clipboard.writeText(body);
      return { status: 'copied' };
    }
    if (request.action === 'save') {
      const result = await dialog.showSaveDialog({
        title: 'Save bug report',
        defaultPath: `pluto-report-${report.id.slice(0, 8)}.txt`,
        filters: [{ name: 'Text report', extensions: ['txt'] }],
      });
      if (result.canceled || !result.filePath) return { status: 'cancelled' };
      await writeFile(result.filePath, body, { encoding: 'utf8', mode: 0o600 });
      return { status: 'saved' };
    }
    const action = request.action as 'github' | 'email';
    let url = bugReportDestination(action, report.title, body);
    // Native mail clients and browsers have different URL ceilings. Preserve
    // the whole report on the clipboard if it cannot fit in a compact draft.
    const copied = url.length > (action === 'email' ? 1800 : 6000);
    if (copied) {
      clipboard.writeText(body);
      url = bugReportDestination(
        action,
        report.title,
        'Paste the full report copied from Pluto here before sending.',
      );
    }
    await shell.openExternal(url);
    return { status: copied ? 'opened_with_copy' : 'opened' };
  });
}
