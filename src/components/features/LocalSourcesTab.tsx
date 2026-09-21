import {
  Check,
  FilePlus2,
  FileText,
  Paperclip,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type LocalArtifact,
  deleteLocalArtifact,
  importLocalArtifactPaths,
  importLocalArtifacts,
  listLocalArtifacts,
} from '../../api/localArtifacts';
import { getTrustStatusMeta } from '../../utils/trustStatus';
import { PageHeader } from '../ui/PageHeader';

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export const LocalSourcesTab = ({
  selectedSourceId,
}: {
  selectedSourceId?: string | null;
}) => {
  const [artifacts, setArtifacts] = useState<LocalArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<'load' | 'import' | null>(
    null,
  );
  const [openedId, setOpenedId] = useState<string | null>(
    selectedSourceId ?? null,
  );

  useEffect(() => {
    if (selectedSourceId) setOpenedId(selectedSourceId);
  }, [selectedSourceId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFailedAction(null);
    try {
      setArtifacts(await listLocalArtifacts());
    } catch {
      setError('Pluto could not load your local sources. Try again.');
      setFailedAction('load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loading && selectedSourceId) {
      document
        .getElementById(`local-source-${selectedSourceId}`)
        ?.scrollIntoView({
          block: 'center',
        });
    }
  }, [artifacts, loading, selectedSourceId]);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setFailedAction(null);
    try {
      const imported = await importLocalArtifacts();
      if (imported.length > 0) await refresh();
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : String(importError);
      setError(
        message.includes('artifact_too_large')
          ? 'That source exceeds the file size limit (15 MB for documents, 5 MB for text). Choose a smaller file.'
          : message.includes('artifact_has_no_text')
            ? 'That source does not contain readable text.'
            : 'Pluto could not add that source. Choose a Markdown, text, PDF, Pages, or Word file and try again.',
      );
      setFailedAction('import');
    } finally {
      setImporting(false);
    }
  };

  const handleDroppedFiles = async (files: FileList) => {
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as unknown as { path?: string };
      if (file.path) paths.push(file.path);
    }
    if (paths.length === 0) return;

    setImporting(true);
    setError(null);
    setFailedAction(null);
    try {
      const imported = await importLocalArtifactPaths(paths);
      if (imported.length > 0) await refresh();
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : String(importError);
      setError(
        message.includes('artifact_too_large')
          ? 'One or more dropped files exceed the size limit (15 MB for documents, 5 MB for text).'
          : 'Pluto could not process the dropped files. Ensure they are Markdown, text, PDF, Pages, or Word files.',
      );
    } finally {
      setImporting(false);
    }
  };


  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const ok = await deleteLocalArtifact(id);
      if (ok) {
        setArtifacts((current) => current.filter((item) => item.id !== id));
        if (openedId === id) setOpenedId(null);
      } else {
        setError('Pluto could not delete that source. Try again.');
      }
    } catch {
      setError('Pluto could not delete that source. Try again.');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const formatTypeBadge = (type: string) => {
    switch (type) {
      case 'markdown':
        return 'Markdown';
      case 'pdf':
        return 'PDF Document';
      case 'docx':
        return 'Word Document';
      case 'pages':
        return 'Pages Document';
      default:
        return 'Text';
    }
  };

  return (
    <div
      className="relative mx-auto w-full max-w-5xl animate-in pb-20"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        if (e.dataTransfer.files?.length) {
          void handleDroppedFiles(e.dataTransfer.files);
        }
      }}
    >
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-pro-accent bg-pro-accent/[0.08] backdrop-blur-sm">
          <UploadCloud className="mb-3 h-12 w-12 text-pro-accent animate-bounce" />
          <p className="text-[16px] font-semibold text-pro-text-main">
            Drop notes, PDFs, or documents here
          </p>
          <p className="mt-1 text-[13px] text-pro-text-muted">
            Files will be imported into Pluto's local sources
          </p>
        </div>
      )}

      <PageHeader title="Sources">
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={importing}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-pro-accent px-3.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-pro-accent/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
        >
          {importing ? (
            <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <FilePlus2 className="h-4 w-4" />
          )}
          {importing ? 'Adding…' : 'Add files'}
        </button>
      </PageHeader>

      <div className="mb-8 max-w-2xl space-y-2">
        <h2 className="font-serif text-[22px] font-medium tracking-[-0.01em] text-pro-text-main">
          Your local reference material
        </h2>
        <p className="text-[14px] leading-6 text-pro-text-muted">
          Add Markdown notes, plain-text documents, PDFs, Pages, or Word files.
          Pluto indexes the extracted text on this Mac with full-text search;
          active sources participate in evidence-backed recall in Chat with
          Pluto.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-[13px] text-pro-text-main"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              if (failedAction === 'import') void handleImport();
              else void refresh();
            }}
            className="shrink-0 font-semibold text-pro-accent hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div
          aria-label="Loading sources"
          className="divide-y divide-pro-border/50"
        >
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex gap-4 py-5">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-3 w-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
                <div className="h-2.5 w-72 animate-pulse rounded bg-black/[0.035] dark:bg-white/[0.035]" />
              </div>
            </div>
          ))}
        </div>
      ) : error && failedAction === 'load' ? null : artifacts.length === 0 ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border-y border-dashed border-pro-border px-6 text-center">
          <FileText className="mb-4 h-8 w-8 text-pro-text-muted/50" />
          <h3 className="text-[15px] font-semibold text-pro-text-main">
            Bring a note or document into Pluto
          </h3>
          <p className="mt-2 max-w-md text-[13px] leading-5 text-pro-text-muted">
            Drag and drop a Markdown note, research paper, Word doc, or Pages
            file, or choose files from disk. You can exclude sources or delete
            them at any time.
          </p>
          <button
            type="button"
            onClick={() => void handleImport()}
            className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-lg border border-pro-border bg-pro-surface px-3.5 text-[13px] font-semibold text-pro-text-main transition-colors hover:border-pro-text-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
          >
            <FilePlus2 className="h-4 w-4" />
            Choose files
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-pro-border/50 border-y border-pro-border/50">
          {artifacts.map((artifact) => {
            const trust = getTrustStatusMeta(artifact.trust_status);
            const busy = deletingId === artifact.id;
            const isConfirmingDelete = confirmDeleteId === artifact.id;

            return (
              <li
                key={artifact.id}
                id={`local-source-${artifact.id}`}
                className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="flex min-w-0 gap-3.5">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-pro-text-muted dark:bg-white/[0.06]">
                    <FileText className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="truncate text-[14px] font-semibold text-pro-text-main">
                        {artifact.title}
                      </h3>
                      <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pro-text-muted/80 dark:bg-white/[0.08]">
                        {formatTypeBadge(artifact.type)}
                      </span>
                    </div>
                    <p
                      className="mt-1 truncate text-[12px] text-pro-text-muted"
                      title={artifact.original_path}
                    >
                      {artifact.original_path}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-pro-text-muted/80">
                      <span>Added {formatDate(artifact.imported_at)}</span>
                      <span className="inline-flex items-center gap-1">
                        {artifact.source_quality === 'usable' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <ShieldAlert className="h-3 w-3" />
                        )}
                        {trust.label}
                      </span>
                      {artifact.attached_meetings &&
                      artifact.attached_meetings.length > 0 ? (
                        <span>
                          Attached to {artifact.attached_meetings.length}{' '}
                          {artifact.attached_meetings.length === 1
                            ? 'meeting'
                            : 'meetings'}
                        </span>
                      ) : (
                        <span>Global reference</span>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-expanded={openedId === artifact.id}
                      onClick={() =>
                        setOpenedId((current) =>
                          current === artifact.id ? null : artifact.id,
                        )
                      }
                      className="mt-2 text-[12px] font-semibold text-pro-accent hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/40"
                    >
                      {openedId === artifact.id
                        ? 'Hide extracted text'
                        : 'View extracted text'}
                    </button>
                    {openedId === artifact.id && (
                      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-pro-border bg-pro-surface p-4 font-sans text-[12px] leading-5 text-pro-text-main">
                        {artifact.extracted_text}
                      </pre>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {artifact.attached_meetings &&
                  artifact.attached_meetings.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {artifact.attached_meetings.map((meeting) => (
                        <span
                          key={meeting.id}
                          className="inline-flex items-center gap-1 rounded-md bg-pro-accent/10 px-2 py-1 text-[11px] font-medium text-pro-accent"
                          title={`Attached to meeting: ${meeting.title}`}
                        >
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="max-w-[140px] truncate">
                            {meeting.title}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-pro-text-muted dark:bg-white/[0.06]">
                      Global reference
                    </span>
                  )}

                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDelete(artifact.id)}
                        className="inline-flex min-h-7 items-center rounded-md bg-red-500/10 px-2.5 text-[11px] font-semibold text-red-600 hover:bg-red-500/20 dark:text-red-400"
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="inline-flex min-h-7 items-center rounded-md px-2 text-[11px] text-pro-text-muted hover:text-pro-text-main"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      title="Delete source"
                      aria-label={`Delete ${artifact.title}`}
                      onClick={() => setConfirmDeleteId(artifact.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-pro-text-muted/60 transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
