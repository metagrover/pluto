import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfiguredProviderModel } from '../../electron/llm/providerCatalog';

const main = readFileSync('electron/main.ts', 'utf8');
const handlerStart = main.indexOf("'intelligence:query',");
const handlerEnd = main.indexOf("'intelligence:query:cancel'", handlerStart);
const queryHandler = main.slice(handlerStart, handlerEnd);

describe('Ask Pluto query IPC boundary', () => {
  it.each(['ollama', 'chatgpt'])(
    'keeps %s answer routing from shortening a multi-part meeting question',
    (provider) => {
      const start = queryHandler.indexOf('const extractiveAnswer =');
      const end = queryHandler.indexOf(';', start);
      expect(start).toBeGreaterThan(0);
      const selectAnswer = new Function(
        'settings',
        'useWorkspaceRecall',
        'conversationResolution',
        'selfReference',
        'usePreparedAssigneeRecall',
        'assigneeRecall',
        'buildExtractiveTemporalSummary',
        'effectiveQueryText',
        'context',
        `${queryHandler.slice(start, end + 1)} return extractiveAnswer;`,
      );
      const summary = vi.fn(() => 'Riley: send the checklist by Monday.');
      const result = selectAnswer(
        { llm_provider: provider },
        false,
        { relation: 'new_topic' },
        { refersToSelf: false },
        false,
        null,
        summary,
        'List the follow-ups. Was the review booked? What must happen before production?',
        [{}],
      );
      expect(result).toBe(
        provider === 'chatgpt' ? null : 'Riley: send the checklist by Monday.',
      );
      expect(summary).toHaveBeenCalledTimes(provider === 'chatgpt' ? 0 : 1);
    },
  );

  it('uses complete retrieval rather than assignment-only context for ChatGPT', () => {
    const start = queryHandler.indexOf('const usePreparedAssigneeRecall =');
    const end = queryHandler.indexOf(';', start);
    const selectPrepared = new Function(
      'settings',
      'explicitResolvedScope',
      'temporalResolvedScope',
      'currentMeetingRequested',
      'isPlanning',
      'assigneeRecall',
      'inheritedScope',
      'conversationResolution',
      `${queryHandler.slice(start, end + 1)} return usePreparedAssigneeRecall;`,
    );
    const args = [
      undefined,
      undefined,
      false,
      false,
      { coverageLimited: false },
      undefined,
      { task: 'lookup' },
    ];
    expect(selectPrepared({ llm_provider: 'ollama' }, ...args)).toBe(true);
    expect(selectPrepared({ llm_provider: 'chatgpt' }, ...args)).toBe(false);
    for (const task of ['draft', 'analysis']) {
      expect(
        selectPrepared({ llm_provider: 'ollama' }, ...args.slice(0, -1), {
          task,
        }),
      ).toBe(false);
    }
    expect(
      selectPrepared(
        { llm_provider: 'ollama' },
        undefined,
        undefined,
        false,
        false,
        { coverageLimited: true },
        undefined,
        { task: 'lookup' },
      ),
    ).toBe(false);
  });

  it('keeps project recall diagnostics opt-in and model classification disabled by default', () => {
    const debugHandler = main.slice(
      main.indexOf("'intelligence:query:debug'"),
      main.indexOf("'intelligence:suggested-queries'"),
    );
    expect(debugHandler).toContain(
      'useModelClassification: options?.useModelClassification === true',
    );
    expect(debugHandler).toContain('options?.includeProjectRecall');
    expect(debugHandler).toContain(
      'buildProjectRecall(queryText, parsed.entity_mentions)',
    );
    expect(debugHandler).toContain('combinedProjectContext:');
    expect(debugHandler).toContain('combineProjectFacetContext(');
  });
  it('preserves project evidence when a follow-up names a recipient or owner', () => {
    expect(queryHandler).toMatch(
      /enforceSynthesizedOnlyContext\(\s*restrictEvidenceToMeetingIds\(\s*effectiveProjectRecall\s*\|\|\s*multiProjectContext\s*\|\|\s*!personFocusedRequest\s*\? subjectFocusedContext\s*: selectNamedPersonAnswerContext\(/,
    );
  });
  it('applies explicit meeting and date bounds before inferred project context and after supplementary merges', () => {
    const selection = queryHandler.slice(
      queryHandler.indexOf('const generalContext ='),
      queryHandler.indexOf('const projectFacetKeywords ='),
    );
    expect(selection.indexOf('explicitResolvedScope')).toBeLessThan(
      selection.indexOf('multiProjectContext'),
    );
    expect(selection.indexOf('temporalResolvedScope')).toBeLessThan(
      selection.indexOf('effectiveProjectRecall'),
    );
    expect(queryHandler).toMatch(
      /!multiProjectContext &&\s*!boundedMeetingIds/,
    );
    expect(queryHandler).toMatch(
      /restrictEvidenceToMeetingIds\([\s\S]{0,600}boundedMeetingIds/,
    );
    expect(queryHandler).toMatch(
      /!explicitResolvedScope &&\s*!temporalResolvedScope &&\s*!currentMeetingRequested/,
    );
    expect(queryHandler).toMatch(
      /!boundedMeetingIds\s*\? assigneeRecall\?\.answer\s*: undefined/,
    );
  });
  it('gates person recall and final filtering while preserving query facets outside one project', () => {
    expect(queryHandler).toMatch(
      /const personWorkRecall = personFocusedRequest\s*\? buildPersonWorkRecall/,
    );
    expect(queryHandler).toContain('keywords: projectFacetKeywords');
    expect(queryHandler).toContain('expanded_keywords: []');
    expect(queryHandler).toMatch(
      /keywords: projectFacetKeywords,[\s\S]{0,160}\{ query: queryText \}/,
    );
    expect(queryHandler).toContain(
      'combineProjectFacetContext(generalContext, projectFacetContext)',
    );
    expect(queryHandler).toMatch(
      /parsed.temporal_range \|\|\s*switchesNamedProject \|\|\s*hasMultipleProjectScopes/,
    );
  });
  it('uses structured assignee recall before invoking the answer provider', () => {
    expect(main).toContain('buildAssigneeActionRecall');
    expect(queryHandler).toContain('const assigneeRecall =');
    const assigneeRecallIndex = queryHandler.indexOf('const assigneeRecall =');
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
    expect(queryHandler).toContain(
      "(!inheritedScope || inheritedScope.kind === 'global')",
    );
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

  it('keeps semantic scope provider-specific and preserves existing local query routing', () => {
    const scopeRequest = queryHandler.slice(
      queryHandler.indexOf('const resolveScope ='),
      queryHandler.indexOf('const semanticScope ='),
    );
    expect(scopeRequest).toContain('needsSemanticMeetingScope({');
    expect(scopeRequest).toContain('provider: settings.llm_provider');
    expect(queryHandler).toContain("settings.llm_provider !== 'chatgpt' &&");
    expect(queryHandler).toContain('resolveExplicitMeetingScope(');
    expect(queryHandler).toContain(
      'queryReferencesCurrentMeeting(effectiveQueryText)',
    );
    expect(queryHandler).toContain('explicitlyScopedMeetings.length === 0 ||');
    expect(queryHandler).toContain('semanticScope &&');
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
    expect(queryHandler).toMatch(
      /\.\.\.\(turn\.retrievalPolicy\s*\? \{ retrievalPolicy: turn\.retrievalPolicy \}/,
    );
  });

  it('prepares explicit actions for confirmation before retrieval', () => {
    const actionBranch = queryHandler.indexOf(
      "conversationResolution.turnMode === 'act'",
    );
    expect(actionBranch).toBeGreaterThan(-1);
    expect(queryHandler).toContain('prepareTaskChatReply');
    expect(actionBranch).toBeLessThan(
      queryHandler.indexOf('await parseQuery('),
    );
    expect(actionBranch).toBeLessThan(
      queryHandler.indexOf("sendStatus('retrieving')"),
    );
  });

  it.each([
    ['fast', 'gemma4:12b'],
    ['deep', 'gemma4:12b'],
  ])(
    'reports the actual %s model in answer performance diagnostics',
    (reasoningMode, expectedModel) => {
      const modeStart = queryHandler.indexOf(
        'reasoningMode = resolveAskPlutoReasoningMode(',
      );
      const assignmentStart = queryHandler.indexOf(
        'configuredModel = resolveConfiguredProviderModel(',
        modeStart,
      );
      const assignmentEnd = queryHandler.indexOf(';', assignmentStart);
      const providerRequest = queryHandler.indexOf(
        'answerRaw = await provider.answerAskPluto(',
        assignmentEnd,
      );
      expect(assignmentStart).toBeGreaterThan(modeStart);
      expect(assignmentEnd).toBeLessThan(providerRequest);
      const modelDiagnostic = queryHandler.match(
        /model: providerRequestedAt \? configuredModel : 'not_used'/,
      )?.[0];
      expect(modelDiagnostic).toBeDefined();
      const diagnostics = new Function(
        'settings',
        'reasoningMode',
        'providerRequestedAt',
        'resolveConfiguredProviderModel',
        `let configuredModel; ${queryHandler.slice(assignmentStart, assignmentEnd + 1)} return { ${modelDiagnostic} };`,
      );
      const settings = {
        llm_provider: 'ollama',
        ollama_model: 'gemma4:12b',
        ollama_fast_model: 'phi4-mini:3.8b',
      };
      expect(
        diagnostics(
          settings,
          reasoningMode,
          100,
          resolveConfiguredProviderModel,
        ),
      ).toEqual({ model: expectedModel });
      expect(
        diagnostics(
          settings,
          reasoningMode,
          undefined,
          resolveConfiguredProviderModel,
        ),
      ).toEqual({ model: 'not_used' });
      expect(
        diagnostics(
          { llm_provider: 'chatgpt', chatgpt_model: 'gpt-5.6-terra' },
          reasoningMode,
          100,
          resolveConfiguredProviderModel,
        ),
      ).toEqual({ model: 'gpt-5.6-terra' });
      expect(queryHandler).toContain(
        'performance: buildPerformanceDiagnostics()',
      );
      expect(queryHandler).toContain(
        'const performance = buildPerformanceDiagnostics(finishedAt)',
      );
    },
  );

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
    expect(queryHandler).toMatch(
      /effectiveProjectRecall\s*\? effectiveProjectRecall.context/,
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
    expect(queryHandler).not.toContain('buildAgedProjectAnswer');
    expect(queryHandler).not.toContain('preparedProjectAnswer');
    expect(queryHandler).not.toContain('isPreparedProjectAnswer');
    expect(queryHandler).toContain(
      "previousAssistantTurn?.outcome === 'no_evidence'",
    );
    expect(queryHandler).toContain('buildNoEvidenceDraftReply(queryText)');
    expect(queryHandler).toContain("conversationResolution.task === 'draft'");
    expect(queryHandler).toMatch(
      /personWorkSubject &&\s*personWorkAssignmentRecall &&\s*!personWorkAssignmentRecall.coverageLimited\s*\? personWorkAssignmentRecall\?\.context \|\| \[\]/,
    );
    expect(queryHandler).toContain(
      "conversationResolution.relation !== 'new_topic'",
    );
    expect(queryHandler).toContain('shouldKeepActiveProjectScope({');
    expect(queryHandler).toMatch(
      /const effectiveProjectRecall =\s*inheritedProjectRecall \?\? projectRecall/,
    );
    expect(queryHandler).toMatch(
      /effectiveProjectRecall\s*\? effectiveProjectRecall.context/,
    );
    expect(queryHandler).toContain(
      'activeConversationContext?.meetingIds.slice(0, 3)',
    );
    expect(queryHandler).toContain('activeConversationContext:');
    expect(queryHandler).toContain(
      'conversationContext: nextConversationContext',
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
