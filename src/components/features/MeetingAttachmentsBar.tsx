import { Loader2, Paperclip, Plus, Sparkles, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  type LocalArtifact,
  type LocalArtifactType,
  detachMeetingArtifact,
  importAndAttachMeetingArtifacts,
  listMeetingArtifacts,
} from '../../api/localArtifacts';

export interface MeetingAttachmentsBarProps {
  meetingId: string | number;
  hasExistingNotes?: boolean;
  onRegenerateNotes?: () => void;
  isRegeneratingNotes?: boolean;
  refreshTrigger?: number;
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
  refreshTrigger = 0,
}) => {
  const [artifacts, setArtifacts] = useState<LocalArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detachingId, setDetachingId] = useState<string | null>(null);
  const [viewingArtifact, setViewingArtifact] = useState<LocalArtifact | null>(
    null,
  );
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
  }, [loadArtifacts, refreshTrigger]);

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

  // If there are no artifacts and not viewing one, render nothing to avoid visual clutter
  if (artifacts.length === 0 && !loading && !viewingArtifact) {
    return null;
  }

  return (
    <>
      {artifacts.length > 0 && (
        <section
          aria-label="Attached reference documents"
          className="mx-auto mb-4 w-full max-w-[760px] px-6 md:px-8"
        >
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-pro-text-muted">
            <div className="flex items-center gap-1.5 font-medium text-pro-text-main/80">
              <Paperclip className="h-3.5 w-3.5 text-pro-text-muted" />
              <span>Reference docs:</span>
            </div>

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
                title={`Preview extracted text from ${artifact.title}`}
                className="group inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-pro-border/70 bg-black/[0.03] px-2 py-0.5 text-[12px] text-pro-text-main transition-colors hover:border-pro-accent/40 hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.09]"
              >
                <span className="rounded bg-pro-accent/10 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider text-pro-accent">
                  {formatTypeBadge(artifact.type)}
                </span>
                <span className="max-w-[170px] truncate font-medium">
                  {artifact.title}
                </span>
                <button
                  type="button"
                  aria-label={`Detach ${artifact.title}`}
                  disabled={detachingId === artifact.id}
                  onClick={(e) => void handleDetach(e, artifact.id)}
                  className="ml-0.5 rounded text-pro-text-muted/60 transition-colors hover:text-red-500 disabled:cursor-wait"
                >
                  {detachingId === artifact.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => void handleAttach()}
              disabled={importing}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main disabled:opacity-50"
              aria-label="Add another reference document"
            >
              {importing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              <span>{importing ? 'Adding…' : 'Add'}</span>
            </button>

            {needsRegeneration && onRegenerateNotes && (
              <button
                type="button"
                onClick={onRegenerateNotes}
                disabled={isRegeneratingNotes}
                className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-pro-accent transition-opacity hover:underline disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                <span>
                  {isRegeneratingNotes
                    ? 'Updating notes…'
                    : 'Docs changed · Regenerate notes'}
                </span>
              </button>
            )}
          </div>

          {error && (
            <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </section>
      )}

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
    </>
  );
};
