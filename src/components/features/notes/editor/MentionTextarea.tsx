import { type ReactNode, forwardRef } from 'react';
import TextareaAutosize, {
  type TextareaAutosizeProps,
} from 'react-textarea-autosize';
import {
  type MentionCandidate,
  findMentions,
} from '../../../../utils/noteMentions';

interface MentionTextareaProps extends TextareaAutosizeProps {
  value: string;
  people: readonly MentionCandidate[];
  onOpenPerson?: (personId: string) => void;
}

/**
 * A block textarea that draws "@Name" mentions of known people as tags.
 * A textarea can't style parts of its text, so a copy of the text sits on
 * top with the same classes (so it wraps the same), invisible except for
 * the tags, which take clicks and open the person.
 */
export const MentionTextarea = forwardRef<
  HTMLTextAreaElement,
  MentionTextareaProps
>(({ value, people, onOpenPerson, className = '', ...props }, ref) => {
  const mentions = findMentions(value, people);
  let overlay: ReactNode = null;
  if (mentions.length) {
    const parts: ReactNode[] = [];
    let at = 0;
    for (const mention of mentions) {
      if (mention.start > at) parts.push(value.slice(at, mention.start));
      const label = value.slice(mention.start, mention.end);
      parts.push(
        <span
          key={`${mention.start}:${mention.person.id}`}
          className="note-mention"
          data-person-id={mention.person.id}
          role={onOpenPerson ? 'link' : undefined}
          title={onOpenPerson ? `Open ${mention.person.name}` : undefined}
          onMouseDown={(e) => {
            // Keep the caret where it is; the click opens the person.
            if (onOpenPerson) e.preventDefault();
          }}
          onClick={() => onOpenPerson?.(mention.person.id)}
        >
          {label}
        </span>,
      );
      at = mention.end;
    }
    // A trailing newline needs a character after it to take up a line.
    parts.push(`${value.slice(at)}​`);
    overlay = (
      <div className={`${className} note-mention-overlay`} aria-hidden="true">
        {parts}
      </div>
    );
  }
  return (
    <div className="note-mention-field">
      <TextareaAutosize
        ref={ref}
        value={value}
        className={className}
        {...props}
      />
      {overlay}
    </div>
  );
});

MentionTextarea.displayName = 'MentionTextarea';
