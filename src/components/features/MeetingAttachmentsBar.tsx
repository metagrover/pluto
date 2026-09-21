import {
  FilePlus2,
  Loader2,
  Paperclip,
  Sparkles,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  type LocalArtifact,
  type LocalArtifactType,
  detachMeetingArtifact,
  importAndAttachMeetingArtifactPaths,
  importAndAttachMeetingArtifacts,
  listMeetingArtifacts,
} from '../../api/localArtifacts';

export interface MeetingAttachmentsBarProps {
  meetingId: string | number;
  hasExistingNotes?: boolean;
  onRegenerateNotes?: () => void;
  isRegeneratingNotes?: boolean;
}

const formatTypeBadge = (type: LocalArtifactType): string => {
  switch (type) {
    case 'docx':
      return 'Word';
    case 'pages':
      return 'Pages';
    case 'pdf':
      return 'PDF';
    case 'markdown':
      return 'Markdown';
    case 'text':
      return 'Text';
    default:
      return 'Doc';
  }
};

export const MeetingAttachmentsBar: React.FC<MeetingAttachmentsBarProps> = ({
  meetingId,
  hasExistingNotes = false,
  onRegenerateNotes,
  isRegeneratingNotes = false,
}) => {
  const [artifacts, setArtifacts] = useState<LocalArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const [viewingArtifact, setViewingArtifact] = useState<LocalArtifact | null>(
    null,
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRegeneration, setNeedsRegeneration] = useState(false);

  const loadArtifacts = useCallback(async () => {
    if (!meetingId) return;
    setLoading(true);
    try {
      const items = await listMeetingArtifacts(meetingId);
      setArtifacts(items);
    } catch (err) {
      console.error('[MeetingAttachmentsBar] Failed to load artifacts:', err);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void loadArtifacts();
    setNeedsRegeneration(false);
  }, [loadArtifacts]);

  // When regenerating completes, clear the regeneration reminder banner
  useEffect(() => {
    if (!isRegeneratingNotes) {
      setNeedsRegeneration(false);
    }
  }, [isRegeneratingNotes]);

  const handleAttach = async () => {
    setImporting(true);
    setError(null);
    try {
      const imported = await importAndAttachMeetingArtifacts(meetingId);
      if (imported.length > 0) {
        await loadArtifacts();
        if (hasExistingNotes) {
          setNeedsRegeneration(true);
        }
      }
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : String(importError);
      setError(
        message.includes('artifact_too_large')
          ? 'File exceeds size limit (15 MB for docs, 5 MB for text).'
          : 'Could not attach document. Choose a Word, Pages, PDF, or text file.',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDetach = async (e: React.MouseEvent, artifactId: string) => {
    e.stopPropagation();
    setDetachingId(artifactId);
    setError(null);
    try {
      const success = await detachMeetingArtifact(meetingId, artifactId);
      if (success) {
        await loadArtifacts();
        if (hasExistingNotes) {
          setNeedsRegeneration(true);
        }
      }
    } catch (detachError) {
      console.error('[MeetingAttachmentsBar] Detach error:', detachError);
      setError('Could not remove document from meeting.');
    } finally {
      setDetachingId(null);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as unknown as { path?: string };
      if (file.path) paths.push(file.path);
    }
    if (paths.length === 0) return;

    setImporting(true);
    setError(null);
    try {
      const imported = await importAndAttachMeetingArtifactPaths(
        meetingId,
        paths,
      );
      if (imported.length > 0) {
        await loadArtifacts();
        if (hasExistingNotes) {
          setNeedsRegeneration(true);
        }
      }
    } catch (dropError) {
      const message =
        dropError instanceof Error ? dropError.message : String(dropError);
      setError(
        message.includes('artifact_too_large')
          ? 'File exceeds size limit (15 MB for docs, 5 MB for text).'
          : 'Could not attach document. Drop Word, Pages, PDF, or text files.',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  return (
    <div
      className="mx-auto w-full max-w-[760px] px-6 md:px-8"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={`relative rounded-xl border p-3 transition-colors ${
          isDragOver
            ? 'border-pro-accent bg-pro-accent/[0.08]'
            : 'border-pro-border/70 bg-pro-surface/50'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-pro-text-muted" />
            <span className="text-[12px] font-semibold uppercase tracking-wider text-pro-text-muted">
              Reference Assets
            </span>
            {artifacts.length > 0 && (
              <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-medium text-pro-text-muted dark:bg-white/[0.08]">
                {artifacts.length}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleAttach()}
            disabled={importing || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-pro-border/80 bg-pro-surface px-2.5 py-1 text-[12px] font-medium text-pro-text-main transition-colors hover:border-pro-accent/40 hover:text-pro-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FilePlus2 className="h-3.5 w-3.5" />
            )}
            <span>{importing ? 'Attaching…' : 'Attach document'}</span>
          </button>
        </div>

        {/* Attachment chips list or empty prompt */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {artifacts.length === 0 && !loading && (
            <p className="text-[12px] text-pro-text-muted/80">
              Attach project briefs, slide decks, Word docs, Pages, or PDFs.
              Extracted content will ground generated meeting notes.
            </p>
          )}

          {artifacts.map((artifact) => (
            <div
              key={artifact.id}
              role="button"
              tabIndex={0}
              onClick={() => setViewingArtifact(artifact)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setViewingArtifact(artifact);
                }
              }}
              title={`Click to preview extracted text from ${artifact.title}`}
              className="group inline-flex cursor-pointer items-center gap-2 rounded-lg border border-pro-border bg-pro-surface px-2.5 py-1 text-[12px] text-pro-text-main shadow-xs transition-all hover:border-pro-accent/50 hover:bg-pro-accent/[0.04]"
            >
              <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pro-accent dark:bg-white/[0.1]">
                {formatTypeBadge(artifact.type)}
              </span>
              <span className="max-w-[200px] truncate font-medium">
                {artifact.title}
              </span>
              <button
                type="button"
                aria-label={`Detach ${artifact.title}`}
                disabled={detachingId === artifact.id}
                onClick={(e) => void handleDetach(e, artifact.id)}
                className="ml-0.5 rounded p-0.5 text-pro-text-muted/60 transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:cursor-wait"
              >
                {detachingId === artifact.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Regeneration callout when attachment was added/removed */}
        {needsRegeneration && onRegenerateNotes && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-pro-accent/30 bg-pro-accent/[0.08] px-3 py-2 text-[12px] text-pro-text-main">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-pro-accent" />
              <span>
                Meeting documents changed. Regenerate notes to synthesize them.
              </span>
            </div>
            <button
              type="button"
              onClick={onRegenerateNotes}
              disabled={isRegeneratingNotes}
              className="inline-flex items-center gap-1.5 rounded-md bg-pro-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRegeneratingNotes ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              <span>{isRegeneratingNotes ? 'Writing…' : 'Regenerate'}</span>
            </button>
          </div>
        )}

        {/* Error notification */}
        {error && (
          <div className="mt-2 text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Extracted Text Preview Modal */}
      {viewingArtifact && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setViewingArtifact(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Preview: ${viewingArtifact.title}`}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-pro-border bg-pro-bg shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-pro-border/70 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pro-accent dark:bg-white/[0.1]">
                    {formatTypeBadge(viewingArtifact.type)}
                  </span>
                  <h3 className="truncate text-[15px] font-semibold text-pro-text-main">
                    {viewingArtifact.title}
                  </h3>
                </div>
                <p className="mt-1 truncate text-[11px] text-pro-text-muted">
                  {viewingArtifact.original_path}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingArtifact(null)}
                className="rounded-lg p-1.5 text-pro-text-muted transition-colors hover:bg-black/5 hover:text-pro-text-main dark:hover:bg-white/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-pro-text-muted">
                Extracted Text (Synthesized with Notes)
              </div>
              <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-pro-border bg-pro-surface p-4 font-mono text-[12px] leading-relaxed text-pro-text-main">
                {viewingArtifact.extracted_text || '(No text extracted)'}
              </pre>
            </div>

            <div className="flex justify-end border-t border-pro-border/70 px-6 py-3">
              <button
                type="button"
                onClick={() => setViewingArtifact(null)}
                className="rounded-lg border border-pro-border bg-pro-surface px-4 py-1.5 text-[13px] font-medium text-pro-text-main transition-colors hover:border-pro-text-muted/40"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
