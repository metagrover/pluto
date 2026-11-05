import { ArrowUp, Square, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Logo } from '../Brand/Logo';
import './notes/notes.css';

interface AskPlutoSidebarProps {
  /** Accessible name of the panel, e.g. "Ask Pluto about this note". */
  label: string;
  /** The line under "Ask Pluto" saying what answers are about. */
  subtitle: string;
  onClose: () => void;
  /** Changes whenever new conversation content arrives, to keep it in view. */
  followKey: string;
  /** The conversation: questions, answers, progress and errors. */
  children: React.ReactNode;
  /** Shown above the question field, e.g. the text being asked about. */
  composerAccessory?: React.ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  /** An answer is running; the send button becomes Stop. */
  pending: boolean;
  onStop: () => void;
  inputLabel: string;
  placeholder: string;
  maxLength: number;
  footnote: string;
}

/**
 * The Ask Pluto side panel used in Notes and on finished meetings: a header,
 * the conversation, and a question field. Callers own what is asked and how
 * answers are shown.
 */
export const AskPlutoSidebar: React.FC<AskPlutoSidebarProps> = ({
  label,
  subtitle,
  onClose,
  followKey,
  children,
  composerAccessory,
  query,
  onQueryChange,
  onSubmit,
  pending,
  onStop,
  inputLabel,
  placeholder,
  maxLength,
  footnote,
}) => {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // Keep the newest turn in view.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [followKey]);

  return (
    <aside className="note-ask-panel" aria-label={label}>
      <header className="note-ask-panel__header">
        <span className="note-ask-panel__mark" aria-hidden="true">
          <Logo size={16} variant="default" />
        </span>
        <div className="note-ask-panel__heading">
          <span>Ask Pluto</span>
          <span>{subtitle}</span>
        </div>
        <button
          type="button"
          className="note-ask-panel__icon-button"
          onClick={onClose}
          aria-label="Close Ask Pluto"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </header>

      <div
        ref={threadRef}
        className="note-ask-panel__thread"
        role="log"
        aria-live="polite"
      >
        {children}
      </div>

      <form
        className="note-ask-panel__composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {composerAccessory}
        <div className="note-ask-panel__field">
          <TextareaAutosize
            ref={composerRef}
            value={query}
            minRows={1}
            maxRows={6}
            maxLength={maxLength}
            aria-label={inputLabel}
            placeholder={placeholder}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                if (pending) onStop();
                else onClose();
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {pending ? (
            <button
              type="button"
              className="note-ask-panel__send"
              onClick={onStop}
              aria-label="Stop answer"
              title="Stop"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="note-ask-panel__send"
              disabled={!query.trim()}
              aria-label="Send question"
              title="Send (Enter)"
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
        <p className="note-ask-panel__footnote">{footnote}</p>
      </form>
    </aside>
  );
};
