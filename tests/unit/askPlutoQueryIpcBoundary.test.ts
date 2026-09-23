import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync('electron/main.ts', 'utf8');
const handlerStart = main.indexOf("'intelligence:query',");
const handlerEnd = main.indexOf("'intelligence:query:cancel'", handlerStart);
const queryHandler = main.slice(handlerStart, handlerEnd);

describe('Ask Pluto query IPC boundary', () => {
  it('uses structured assignee recall before invoking the answer provider', () => {
    expect(main).toContain('buildAssigneeActionRecall');
    expect(queryHandler).toContain(
      'const assigneeRecall = buildAssigneeActionRecall',
    );
    expect(queryHandler.indexOf('buildAssigneeActionRecall')).toBeLessThan(
      queryHandler.indexOf('getProvider(settings)'),
    );
    expect(queryHandler).toContain('assigneeRecall?.context');
    expect(queryHandler).toContain('assigneeRecall?.answer');
    expect(queryHandler).toContain('!assigneeRecall.coverageLimited');
    expect(queryHandler).toContain('const usePreparedAssigneeRecall');
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'new_topic'",
    );
    expect(queryHandler).toContain('mergeRetrievalResultsByMeeting');
    expect(queryHandler).toContain('resolveAskPlutoConversation');
    expect(queryHandler).toContain('conversationResolution.retrievalQuery');
    expect(queryHandler).toContain('conversationResolution.answerQuery');
    expect(queryHandler).toContain('task: conversationResolution.task');
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'expansion'",
    );
    expect(queryHandler).toContain('.finalize(assigneeRecall.answer)');
    expect(queryHandler).toContain(
      'That is the full extent of the explicit assignment evidence I could verify.',
    );
  });

  it('publishes waiting and writing phases around model generation', () => {
    expect(queryHandler).toContain("sendStatus('waiting')");
    expect(queryHandler).toContain("sendStatus('writing')");
  });
});
