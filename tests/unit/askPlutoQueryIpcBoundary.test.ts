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
    expect(queryHandler).toContain(
      'assigneeRecall && !assigneeRecall.coverageLimited',
    );
    expect(queryHandler).toContain('mergeRetrievalResultsByMeeting');
    expect(queryHandler).toContain('resolveConversationQuery');
  });

  it('publishes waiting and writing phases around model generation', () => {
    expect(queryHandler).toContain("sendStatus('waiting')");
    expect(queryHandler).toContain("sendStatus('writing')");
  });
});
