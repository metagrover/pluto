import { Copy, Download, ExternalLink, Mail, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  BugReportAction,
  BugReportArea,
  BugReportDraft,
} from '../../../electron/bugReports';

const buttonBase =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium text-pro-text-main transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50';
const buttonClass = `${buttonBase} border-pro-border hover:bg-pro-hover`;

export function ReportProblemButton({
  area = 'general',
  entityId,
  className = buttonClass,
}: { area?: BugReportArea; entityId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        Report a problem
      </button>
      {open && (
        <ReportProblemDialog
          area={area}
          entityId={entityId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ReportProblemDialog({
  area,
  entityId,
  onClose,
}: {
  area: BugReportArea;
  entityId?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<BugReportDraft | null>(null);
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    let active = true;
    window.ipcRenderer
      .invoke('BUG_REPORT_PREPARE', { area, entityId })
      .then((value: BugReportDraft) => {
        if (active) setDraft(value);
      })
      .catch(() => {
        if (active)
          setError(
            'Couldn’t prepare diagnostics. Close this report and try again.',
          );
      });
    return () => {
      active = false;
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [area, entityId]);

  const perform = async (action: BugReportAction) => {
    if (!draft || pending) return;
    setPending(true);
    setMessage('');
    setError('');
    try {
      const result = await window.ipcRenderer.invoke('BUG_REPORT_ACTION', {
        id: draft.id,
        description,
        action,
      });
      setMessage(
        result.status === 'opened_with_copy'
          ? 'Full report copied. Paste it into the draft, then review and send.'
          : result.status === 'opened'
            ? 'Draft opened. Review and send it there.'
            : result.status === 'copied'
              ? 'Report copied.'
              : result.status === 'saved'
                ? 'Report saved.'
                : '',
      );
    } catch {
      setError(
        'Couldn’t complete that action. Try copying or saving the report. If it has expired, close and reopen it.',
      );
    } finally {
      setPending(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="bug-report-title"
      aria-describedby="bug-report-privacy"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-y-auto rounded-xl bg-pro-bg p-6 text-pro-text-main shadow-xl backdrop:bg-black/45"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="bug-report-title" className="text-lg font-semibold">
          Report a problem
        </h2>
        <button
          type="button"
          aria-label="Close report"
          className="rounded p-1 text-pro-text-main/75 hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <p
        id="bug-report-privacy"
        className="mt-2 text-sm leading-relaxed text-pro-text-main/75"
      >
        Diagnostics include app details and recent operation events. Meeting
        content, names, credentials, and personal paths are excluded.
      </p>
      <label
        htmlFor="bug-report-description"
        className="mt-5 block text-[13px] font-medium"
      >
        What happened?{' '}
        <span className="font-normal text-pro-text-main/75">(optional)</span>
      </label>
      <textarea
        id="bug-report-description"
        value={description}
        maxLength={2000}
        rows={3}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="What were you doing, and what did you expect? Please omit private meeting details."
        className="mt-2 w-full resize-y rounded-lg border border-pro-border bg-pro-surface p-3 text-sm placeholder:text-pro-text-main/75 focus:outline-none focus:ring-2 focus:ring-pro-accent"
      />
      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-medium text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent">
          Review included diagnostics
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-pro-surface p-3 font-mono text-xs leading-relaxed text-pro-text-main/75">
          {draft?.diagnostics ||
            (error ? 'Diagnostics unavailable.' : 'Preparing diagnostics…')}
        </pre>
      </details>
      <p className="mt-4 text-xs leading-relaxed text-pro-text-main/75">
        GitHub issues are public. Without a GitHub account, email
        deepakgrover333+pluto@gmail.com. You review and send the draft yourself.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${buttonBase} border-transparent bg-pro-accent text-white dark:text-black hover:opacity-90`}
          disabled={!draft || pending}
          onClick={() => void perform('github')}
        >
          <ExternalLink className="h-4 w-4" />
          Open GitHub issue
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!draft || pending}
          onClick={() => void perform('email')}
        >
          <Mail className="h-4 w-4" />
          Email support
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!draft || pending}
          onClick={() => void perform('copy')}
        >
          <Copy className="h-4 w-4" />
          Copy report
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!draft || pending}
          onClick={() => void perform('save')}
        >
          <Download className="h-4 w-4" />
          Save report
        </button>
      </div>
      <div
        className="mt-3 text-[13px] leading-relaxed"
        aria-live="polite"
        aria-atomic="true"
      >
        {pending ? (
          <p className="text-pro-text-main/75">Preparing report…</p>
        ) : null}
        {message ? <p className="text-pro-text-main/75">{message}</p> : null}
        {error ? (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
