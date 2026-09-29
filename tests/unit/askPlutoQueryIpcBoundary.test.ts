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
    const assigneeRecallIndex = queryHandler.indexOf(
      'const assigneeRecall = buildAssigneeActionRecall',
    );
    const extractiveAnswerIndex = queryHandler.indexOf(
      'const extractiveAnswer =',
    );
    const groundedProviderIndex = queryHandler.indexOf(
      'const provider = await getProvider(settings)',
      extractiveAnswerIndex,
    );
    expect(assigneeRecallIndex).toBeLessThan(extractiveAnswerIndex);
    expect(extractiveAnswerIndex).toBeLessThan(groundedProviderIndex);
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

  it('answers conversational turns through the dialogue model before retrieval', () => {
    const acknowledgmentBranch = queryHandler.indexOf(
      "conversationResolution.relation === 'acknowledgment'",
    );
    expect(acknowledgmentBranch).toBeGreaterThan(-1);
    expect(queryHandler).toContain('buildConversationalReplyPrompt({');
    expect(queryHandler).toContain('buildConversationBoundaryReply(queryText)');
    expect(queryHandler).toContain('provider.answerAskPluto(prompt, {');
    expect(queryHandler).toContain('live: true');
    expect(queryHandler).toContain(
      'const answer = await answerConversationally();',
    );
    expect(queryHandler).toContain(
      "conversationResolution.turnMode === 'social'",
    );
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'new_topic' &&",
    );
    expect(queryHandler).toContain('!isExplicitInformationRequest(queryText)');
    expect(queryHandler).toContain("turnMode = 'social'");
    expect(queryHandler).toContain("retrievalPolicy = 'none'");
    expect(queryHandler).not.toContain('buildAskPlutoAcknowledgment(');
    expect(acknowledgmentBranch).toBeLessThan(
      queryHandler.indexOf('await parseQuery('),
    );
    expect(acknowledgmentBranch).toBeLessThan(
      queryHandler.indexOf("sendStatus('retrieving')"),
    );
  });

  it('defers synthesized meeting detail reads until after conversation-only turns', () => {
    expect(queryHandler).toContain('db.getAskPlutoMeetingHeaders()');
    expect(queryHandler).toContain('db.getAskPlutoMeetings()');
    expect(queryHandler).not.toContain('db.getMeetings()');
    expect(queryHandler.indexOf('db.getAskPlutoMeetings()')).toBeGreaterThan(
      queryHandler.indexOf(
        "conversationResolution.relation === 'acknowledgment'",
      ),
    );
  });

  it('preserves conversation routing metadata across the IPC boundary', () => {
    expect(queryHandler).toContain(
      '...(turn.turnMode ? { turnMode: turn.turnMode } : {})',
    );
    expect(queryHandler).toContain(
      '...(turn.retrievalPolicy\n                  ? { retrievalPolicy: turn.retrievalPolicy }',
    );
  });

  it('prepares explicit actions for confirmation before retrieval', () => {
    const actionBranch = queryHandler.indexOf(
      "conversationResolution.turnMode === 'act'",
    );
    expect(actionBranch).toBeGreaterThan(-1);
    expect(queryHandler).toContain(
      'parseConversationActionProposal(queryText)',
    );
    expect(actionBranch).toBeLessThan(
      queryHandler.indexOf('await parseQuery('),
    );
    expect(actionBranch).toBeLessThan(
      queryHandler.indexOf("sendStatus('retrieving')"),
    );
  });

  it('returns end-to-end performance diagnostics for real IPC benchmarks', () => {
    expect(queryHandler).toContain('buildPerformanceDiagnostics');
    expect(queryHandler).toContain('conversationResolutionMs:');
    expect(queryHandler).toContain('providerRequestToFirstTokenMs:');
    expect(queryHandler).toContain('promptCharacters');
    expect(queryHandler).toContain('contextCount');
    expect(queryHandler).toContain(
      'performance: buildPerformanceDiagnostics()',
    );
  });

  it('streams synthesized answers without the sentence-level citation gate', () => {
    expect(queryHandler).toContain('createSynthesizedAnswerStream(');
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'omission_follow_up'",
    );
    expect(queryHandler).toContain('createValidatedAnswerStream(');
  });

  it('searches deeper in the cited follow-up meetings and skips prepared summaries', () => {
    expect(queryHandler).toContain('const expansionMeetingIds =');
    expect(queryHandler).toContain(').slice(0, 3);');
    expect(queryHandler).toContain('meetingIds: expansionMeetingIds');
    expect(queryHandler).toContain('previousExpansionAnswer');
    expect(queryHandler).toContain('removeRepeatedAskPlutoClaims(');
    expect(queryHandler).toContain('go deeper');
    expect(queryHandler).toContain(
      'effectiveProjectRecall\n            ? effectiveProjectRecall.context',
    );
    expect(queryHandler).toContain(
      "conversationResolution.relation === 'expansion'",
    );
  });

  it('carries structured active context instead of relying on follow-up phrases', () => {
    expect(queryHandler).toContain(
      'previousAssistantTurn?.conversationContext',
    );
    expect(queryHandler).toContain('const activeConversationContext =');
    expect(queryHandler).toContain(
      'activeConversationContext: switchesNamedProject',
    );
    expect(queryHandler).not.toContain(
      'activeConversationContext: previousConversationContext || null',
    );
    expect(queryHandler).toContain('const inheritedProjectRecall');
    expect(queryHandler).toContain('asksToVerifyProjectAssociation(');
    expect(queryHandler).toContain('asksForExplicitAttribution(');
    expect(queryHandler).toContain(
      "candidateProjectRecall?.project.matchKind === 'explicit_label'",
    );
    expect(queryHandler).toContain('selectNamedPersonAnswerContext(');
    expect(queryHandler).toContain(
      'const explicitPersonSubject = parsePersonWorkQuery(queryText)',
    );
    expect(queryHandler).toContain('const personWorkAssignmentRecall =');
    expect(queryHandler).toContain('const answerSelfName =');
    expect(queryHandler).toContain(
      'effectivePersonWorkRecall.person.id !== selfPersonId',
    );
    expect(queryHandler).toContain('buildAgedProjectAnswer(');
    expect(queryHandler).toContain(
      "previousAssistantTurn?.outcome === 'no_evidence'",
    );
    expect(queryHandler).toContain('buildNoEvidenceDraftReply(queryText)');
    expect(queryHandler).toContain("conversationResolution.task === 'draft'");
    expect(queryHandler).toContain(
      'personWorkSubject && personWorkAssignmentRecall\n                ? personWorkAssignmentRecall?.context || []',
    );
    expect(queryHandler).toContain(
      "conversationResolution.relation !== 'new_topic'",
    );
    expect(queryHandler).toContain('shouldKeepActiveProjectScope({');
    expect(queryHandler).toContain(
      'const effectiveProjectRecall = inheritedProjectRecall ?? projectRecall',
    );
    expect(queryHandler).toContain(
      'effectiveProjectRecall\n            ? effectiveProjectRecall.context',
    );
    expect(queryHandler).toContain(
      'activeConversationContext?.meetingIds.slice(0, 3)',
    );
    expect(queryHandler).toContain('activeConversationContext:');
    expect(queryHandler).toContain(
      'conversationContext: nextConversationContext',
    );
    expect(queryHandler).toContain(
      "conversationResolution.relation !== 'follow_up'",
    );
    expect(queryHandler).toContain('enforceSynthesizedOnlyContext(');
    expect(queryHandler).toContain('const effectivePersonWorkRecall');
    expect(queryHandler).toContain("kind: 'person' as const");
  });

  it('uses confirmed identity for self retrieval without rewriting another person as the user', () => {
    expect(queryHandler).toContain('db.identityStore.getSelfPersonId()');
    expect(queryHandler).toContain('resolveAskPlutoSelfReference(');
    expect(queryHandler).toContain('selfReference.retrievalQuery');
    expect(queryHandler).toMatch(
      /addressConfirmedSelf\(\s*distinct\.answer,\s*answerSelfName/,
    );
    expect(queryHandler).toContain('addressConfirmedSelf(');
    expect(queryHandler).not.toContain(
      'selfReference.refersToSelf ? confirmedSelfName',
    );
  });
});
