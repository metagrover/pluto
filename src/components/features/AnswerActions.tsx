import { Check, ListPlus, MessageSquarePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { saveTask } from '../../api/tasks';
import { isActionableAnswerItem } from '../../utils/actionableAnswer';
import { addToNextTime } from '../KnowledgeGraph/NextWithPerson';

const ITEM_MAX_LENGTH = 160;

const plain = (line: string) =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^#+\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const shorten = (text: string) => {
  if (text.length <= ITEM_MAX_LENGTH) return text;
  const cut = text.slice(0, ITEM_MAX_LENGTH);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 60 ? space : ITEM_MAX_LENGTH).trimEnd()}…`;
};

/** Only offer a draft when the answer contains a concrete outstanding action. */
export const answerItemDraft = (answer: string): string => {
  const lines = answer
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^\s*(?:[-*+]\s+)?\[[xX]\]/.test(line)) continue;
    const text = plain(line);
    const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
    if (isActionableAnswerItem(sentence))
      return shorten(sentence.replace(/[.]$/, ''));
  }
  return '';
};

type Target = 'task' | 'next';

/**
 * Under an Ask Pluto answer: turn it into a to-do, or into something to raise
 * with the person next time. Both open a short line to edit first.
 */
export function AnswerActions({
  answer,
  person,
}: {
  answer: string;
  /** The one other person this conversation is about, when there is one. */
  person?: { id: string; name: string } | null;
}) {
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (target) inputRef.current?.focus();
  }, [target]);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(timer);
  }, [done]);

  const open = (next: Target) => {
    setTarget(next);
    setDraft(answerItemDraft(answer));
    setError(null);
    setDone(null);
  };
  const firstName = person?.name.trim().split(/\s+/)[0] || person?.name;

  const add = async () => {
    const text = draft.replace(/\s+/g, ' ').trim();
    if (!text || !target) return;
    setBusy(true);
    setError(null);
    try {
      if (target === 'task') {
        // A to-do with the same title already in Tasks is reused, untouched.
        await saveTask({
          title: text,
          requestId: `answer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        });
        setDone('Added to Tasks');
      } else if (person) {
        await addToNextTime(person, text);
        setDone(`Added to Next time with ${firstName}`);
      }
      setTarget(null);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'Could not add it. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const suggestedDraft = answerItemDraft(answer);
  if (!suggestedDraft) return null;

  if (target) {
    return (
      <>
        <form
          className="answer-actions answer-actions--editing"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={1000}
            disabled={busy}
            aria-label={
              target === 'task' ? 'New to-do' : `Next time with ${person?.name}`
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setTarget(null);
              }
            }}
          />
          <button type="submit" disabled={busy || !draft.trim()}>
            Add
          </button>
          <button type="button" onClick={() => setTarget(null)}>
            Cancel
          </button>
        </form>
        {error ? (
          <p role="alert" className="answer-actions__error mt-1">
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <div className="answer-actions">
      <button type="button" onClick={() => open('task')}>
        <ListPlus size={12} aria-hidden="true" />
        Add as to-do
      </button>
      {person ? (
        <button type="button" onClick={() => open('next')}>
          <MessageSquarePlus size={12} aria-hidden="true" />
          Add to Next time with {firstName}
        </button>
      ) : null}
      {done ? (
        <output className="answer-actions__done" aria-live="polite">
          <Check size={12} aria-hidden="true" />
          {done}
        </output>
      ) : null}
    </div>
  );
}
