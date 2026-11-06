import type React from 'react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMeetingAskPluto } from '../../hooks/useMeetingAskPluto';
import type { Meeting } from '../../types';
import type { MeetingAskPlutoConversationMessage } from '../../types/askPluto';
import { MEETING_ASK_PLUTO_LIMITS } from '../../utils/meetingAskPlutoRequest';
import { AnswerActions } from './AnswerActions';
import { AskPlutoSidebar } from './AskPlutoSidebar';

interface MeetingAskPlutoPanelProps {
  meeting: Meeting;
  /** The one other person in the meeting, for "Add to Next time". */
  person?: { id: string; name: string } | null;
  /** Kept by the meeting page so closing the panel keeps the conversation. */
  conversation?: MeetingAskPlutoConversationMessage[];
  onConversationChange?: React.Dispatch<
    React.SetStateAction<MeetingAskPlutoConversationMessage[]>
  >;
  onClose: () => void;
}

const plainLinks = {
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
};

/** Ask Pluto about a finished meeting, in the same side panel as Notes. */
export const MeetingAskPlutoPanel: React.FC<MeetingAskPlutoPanelProps> = ({
  meeting,
  person = null,
  conversation,
  onConversationChange,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const {
    messages,
    isAsking,
    streamingAnswer,
    error,
    ask,
    stop,
    canAnswerWithChatGPT,
    answerWithChatGPT,
  } = useMeetingAskPluto({ meeting, conversation, onConversationChange });

  const submit = () => {
    if (ask(query)) setQuery('');
  };

  return (
    <AskPlutoSidebar
      label="Ask Pluto about this meeting"
      subtitle="About this meeting"
      onClose={onClose}
      followKey={`${messages.length}:${streamingAnswer.length}:${isAsking}`}
      query={query}
      onQueryChange={setQuery}
      onSubmit={submit}
      pending={isAsking}
      onStop={stop}
      inputLabel="Ask about this meeting"
      placeholder="Ask about this meeting…"
      maxLength={MEETING_ASK_PLUTO_LIMITS.queryChars}
      footnote="Answers use only this meeting."
    >
      {messages.length === 0 && !isAsking ? (
        <div className="note-ask-panel__intro">
          <p>
            Ask anything about this meeting: what was decided, who owns what, or
            what’s still open.
          </p>
        </div>
      ) : null}

      {messages.map((message) =>
        message.role === 'user' ? (
          <div key={message.id} className="note-ask-panel__question">
            {message.content}
          </div>
        ) : (
          <div key={message.id} className="note-ask-panel__answer">
            <div className="note-ask-panel__markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={plainLinks}
              >
                {message.content}
              </ReactMarkdown>
            </div>
            {message.packet?.citations.length ? (
              <details className="note-ask-panel__evidence">
                <summary>View evidence</summary>
                <p>Check these excerpts against the answer.</p>
                {message.packet.citations.map((citation) => (
                  <blockquote key={citation.id}>
                    {citation.evidence_span || citation.claim}
                  </blockquote>
                ))}
              </details>
            ) : message.packet?.claims.length &&
              message.packet.trustStatus === 'needs_review' ? (
              <span className="note-ask-panel__meta">
                No supporting evidence cited.
              </span>
            ) : null}
            {message.interrupted ? (
              <span className="note-ask-panel__meta">Stopped</span>
            ) : null}
            {message.answeredBy === 'chatgpt' ? (
              <span className="note-ask-panel__meta">
                Answered by ChatGPT, since there wasn’t enough free memory for
                your local model.
              </span>
            ) : null}
            {!message.interrupted && message.content.trim() ? (
              <AnswerActions answer={message.content} person={person} />
            ) : null}
          </div>
        ),
      )}

      {isAsking ? (
        <div className="note-ask-panel__answer">
          {streamingAnswer ? (
            <div className="note-ask-panel__markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={plainLinks}
              >
                {streamingAnswer}
              </ReactMarkdown>
            </div>
          ) : (
            <output className="note-ask-panel__reading">
              <span className="note-ask-panel__pulse" aria-hidden="true" />
              Reading this meeting…
            </output>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="note-ask-panel__error" role="alert">
          <div className="note-ask-panel__error-copy">
            <span>{error}</span>
            {canAnswerWithChatGPT ? (
              <span className="note-ask-panel__error-note">
                Sends this question, relevant meeting notes or transcript
                excerpts, and earlier chat messages to ChatGPT, just this once.
              </span>
            ) : null}
          </div>
          {canAnswerWithChatGPT ? (
            <div className="note-ask-panel__error-actions">
              <button type="button" onClick={() => answerWithChatGPT()}>
                Answer with ChatGPT
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </AskPlutoSidebar>
  );
};
