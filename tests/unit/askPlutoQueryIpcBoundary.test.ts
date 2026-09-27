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

  it('rechecks omitted draft statements without sending their text to the renderer', () => {
    expect(queryHandler).toContain('getAskPlutoOmissionReview');
    expect(queryHandler).toContain('omissionReview.claims.slice(0, 6)');
    expect(queryHandler).toContain('retrieveContext(claimParsed');
    expect(queryHandler).toContain('selectAskPlutoOmissionContext');
    expect(queryHandler).toContain(
      'const claimParsed = await parseQuery(claim, {',
    );
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'omission_follow_up' ||",
    );
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'expansion'",
    );
    expect(queryHandler).toContain('selectAdditionalSupportedClaims');
    expect(queryHandler).toContain('rememberAskPlutoOmissions');
    expect(queryHandler).toContain('...(omissionRef ? { omissionRef } : {})');
    expect(queryHandler).not.toContain(
      'unsupportedClaims: presentation.unsupportedClaims,',
    );
  });

  it('publishes waiting and writing phases around model generation', () => {
    expect(queryHandler).toContain("sendStatus('waiting')");
    expect(queryHandler).toContain("sendStatus('writing')");
    expect(queryHandler).toContain("sendStatus('generating')");
    expect(queryHandler).toContain('runAskPlutoWithDeadline(');
    expect(queryHandler).toContain('await deadlineGeneration');
  });

  it('searches deeper in the cited follow-up meetings and skips prepared summaries', () => {
    expect(queryHandler).toContain('const expansionMeetingIds =');
    expect(queryHandler).toContain('meetingIds: expansionMeetingIds');
    expect(queryHandler).toContain('previousExpansionAnswer');
    expect(queryHandler).toContain('removeRepeatedAskPlutoClaims(');
    expect(queryHandler).toContain('go deeper');
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'expansion'",
    );
  });

  it('uses confirmed identity for personal retrieval and all grounded answers', () => {
    expect(queryHandler).toContain('db.identityStore.getSelfPersonId()');
    expect(queryHandler).toContain('resolveAskPlutoSelfReference(');
    expect(queryHandler).toContain('selfReference.retrievalQuery');
    expect(queryHandler).toMatch(
      /addressConfirmedSelf\(\s*distinct\.answer,\s*confirmedSelfName/,
    );
    expect(queryHandler).toContain('addressConfirmedSelf(');
    expect(queryHandler).not.toContain(
      'selfReference.refersToSelf ? confirmedSelfName',
    );
  });
});
