const normalizeText = (value) =>
  typeof value === 'string'
    ? value.toLowerCase().replace(/\s+/g, ' ').trim()
    : '';

const includesNormalized = (haystack, needle) => {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  return haystack.some((item) =>
    normalizeText(item).includes(normalizedNeedle),
  );
};

const conceptStopWords = new Set([
  'a',
  'an',
  'are',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'the',
  'to',
  'was',
  'were',
  'will',
]);

const conceptTokens = (value) => {
  const canonical = normalizeText(value)
    .replace(/\b(?:excluded?|excluding)\b/g, 'filter out')
    .replace(/\bprior to\b/g, 'before')
    .replace(/\bfirst\b/g, 'before')
    .replace(/\b(?:aligned|agreed|settled)\b/g, 'agree')
    .replace(/\b(?:distinct|separation)\b/g, 'separate')
    .replace(/\bcomputation\b/g, 'compute');
  return canonical
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => !conceptStopWords.has(token))
    .map((token) => {
      if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
      if (token.endsWith('ies') && token.length > 4)
        return `${token.slice(0, -3)}y`;
      if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
      return token;
    });
};

const includesConcept = (haystack, needle) => {
  if (includesNormalized(haystack, needle)) return true;
  const expected = [...new Set(conceptTokens(needle))];
  if (expected.length === 0) return false;
  return haystack.some((item) => {
    const actual = new Set(conceptTokens(item));
    const matches = expected.filter((token) => actual.has(token)).length;
    return (
      matches >= Math.min(2, expected.length) &&
      matches / expected.length >= 0.6
    );
  });
};

const flattenAnalysis = (analysis) => {
  const topics = Array.isArray(analysis?.topics) ? analysis.topics : [];
  const summary =
    typeof analysis?.overview === 'string' ? analysis.overview : '';
  const keyPoints = topics.flatMap((topic) =>
    Array.isArray(topic?.key_points) ? topic.key_points : [],
  );
  const decisions = Array.isArray(analysis?.all_decisions)
    ? analysis.all_decisions
    : topics.flatMap((topic) =>
        Array.isArray(topic?.decisions) ? topic.decisions : [],
      );
  const actionItems = Array.isArray(analysis?.all_action_items)
    ? analysis.all_action_items
    : topics.flatMap((topic) =>
        Array.isArray(topic?.action_items) ? topic.action_items : [],
      );

  return {
    summary,
    topicTitles: topics.map((topic) => topic.title).filter(Boolean),
    topicContexts: topics.map(
      (topic) => `${topic.title || ''}: ${topic.summary || ''}`,
    ),
    keyPoints,
    decisions,
    actionItems,
  };
};

const buildDimension = (name, passed, maxScore, details = []) => ({
  name,
  score: passed ? maxScore : Math.max(0, maxScore - 1),
  max_score: maxScore,
  passed,
  details,
});

export const scoreMeetingNotesQuality = (fixture) => {
  const analysis = fixture?.generated_analysis || fixture?.analysis || {};
  const expected = fixture?.expected || {};
  const flattened = flattenAnalysis(analysis);
  const decisionTexts = flattened.decisions.map((item) => item?.text || '');
  const actionItemTexts = flattened.actionItems.map((item) => item?.text || '');
  const attributionTexts = flattened.keyPoints.map(
    (item) => `${item?.speaker || 'unknown'}: ${item?.text || ''}`,
  );
  const failureTags = [];

  const summaryMustInclude = Array.isArray(expected.summary_must_include)
    ? expected.summary_must_include
    : [];
  const summaryMustExclude = Array.isArray(expected.summary_must_exclude)
    ? expected.summary_must_exclude
    : [];
  const missingSummary = summaryMustInclude.filter(
    (item) => !includesConcept([flattened.summary], item),
  );
  const unexpectedSummary = summaryMustExclude.filter((item) =>
    includesNormalized([flattened.summary], item),
  );
  if (missingSummary.length > 0 || unexpectedSummary.length > 0) {
    failureTags.push('summary_factuality');
  }

  const decisionExpectations =
    expected.decisions && typeof expected.decisions === 'object'
      ? expected.decisions
      : {};
  const missingDecisions = (decisionExpectations.must_include || []).filter(
    (item) => !includesConcept(decisionTexts, item),
  );
  const unexpectedDecisions = (decisionExpectations.must_exclude || []).filter(
    (item) => includesNormalized(decisionTexts, item),
  );
  if (missingDecisions.length > 0 || unexpectedDecisions.length > 0) {
    failureTags.push('decision_precision');
  }

  const actionItemExpectations =
    expected.action_items && typeof expected.action_items === 'object'
      ? expected.action_items
      : {};
  const missingActionItems = (actionItemExpectations.must_include || []).filter(
    (item) => !includesConcept(actionItemTexts, item.text || item),
  );
  const unexpectedActionItems = (
    actionItemExpectations.must_exclude || []
  ).filter((item) => includesNormalized(actionItemTexts, item));
  if (missingActionItems.length > 0 || unexpectedActionItems.length > 0) {
    failureTags.push('action_item_precision');
  }

  const attributionExpectations = Array.isArray(expected.attributions)
    ? expected.attributions
    : [];
  const missingAttributions = attributionExpectations.filter(
    (item) =>
      !includesConcept(
        attributionTexts,
        `${item.speaker || 'unknown'}: ${item.text}`,
      ),
  );
  if (missingAttributions.length > 0) {
    failureTags.push('attribution_correctness');
  }

  const requiredTopics = Array.isArray(expected.must_include_topics)
    ? expected.must_include_topics
    : [];
  const missingTopics = requiredTopics.filter(
    (item) => !includesConcept(flattened.topicContexts, item),
  );
  if (missingTopics.length > 0) {
    failureTags.push('critical_topic_omission');
  }

  const unsupportedExpectations = Array.isArray(
    expected.unsupported_inference_must_exclude,
  )
    ? expected.unsupported_inference_must_exclude
    : [];
  const allUserFacingText = [
    flattened.summary,
    ...flattened.topicTitles,
    ...decisionTexts,
    ...actionItemTexts,
    ...flattened.keyPoints.map((item) => item?.text || ''),
  ];
  const unsupportedHits = unsupportedExpectations.filter((item) =>
    includesNormalized(allUserFacingText, item),
  );
  if (unsupportedHits.length > 0) {
    failureTags.push('unsupported_inference_rate');
  }

  const dimensions = [
    buildDimension(
      'summary_factuality',
      failureTags.includes('summary_factuality') === false,
      2,
      [
        ...missingSummary.map((item) => `missing summary: ${item}`),
        ...unexpectedSummary.map((item) => `unexpected summary: ${item}`),
      ],
    ),
    buildDimension(
      'decision_precision',
      failureTags.includes('decision_precision') === false,
      2,
      [
        ...missingDecisions.map((item) => `missing decision: ${item}`),
        ...unexpectedDecisions.map((item) => `unexpected decision: ${item}`),
      ],
    ),
    buildDimension(
      'action_item_precision',
      failureTags.includes('action_item_precision') === false,
      2,
      [
        ...missingActionItems.map(
          (item) => `missing action item: ${item.text || item}`,
        ),
        ...unexpectedActionItems.map(
          (item) => `unexpected action item: ${item}`,
        ),
      ],
    ),
    buildDimension(
      'attribution_correctness',
      failureTags.includes('attribution_correctness') === false,
      2,
      missingAttributions.map(
        (item) =>
          `missing attribution: ${item.speaker || 'unknown'} / ${item.text}`,
      ),
    ),
    buildDimension(
      'critical_topic_omission',
      failureTags.includes('critical_topic_omission') === false,
      2,
      missingTopics.map((item) => `missing topic: ${item}`),
    ),
    buildDimension(
      'unsupported_inference_rate',
      failureTags.includes('unsupported_inference_rate') === false,
      2,
      unsupportedHits.map((item) => `unsupported inference: ${item}`),
    ),
  ];

  const totalScore = dimensions.reduce((sum, item) => sum + item.score, 0);
  const maxScore = dimensions.reduce((sum, item) => sum + item.max_score, 0);

  return {
    meeting_id: fixture?.meeting_id || fixture?.meetingId || 'unknown',
    label: fixture?.label || fixture?.title || 'Unlabeled fixture',
    provider: analysis?.generation_metadata?.provider || 'unknown',
    model: analysis?.generation_metadata?.model || 'unknown',
    generation_path:
      analysis?.generation_metadata?.generation_path || 'unknown',
    prompt_version: analysis?.generation_metadata?.prompt_version || 'unknown',
    reviewed_at: fixture?.reviewed_at || null,
    reviewer_notes: fixture?.reviewer_notes || null,
    dimensions,
    failure_tags: [...new Set(failureTags)],
    total_score: totalScore,
    max_score: maxScore,
    score_ratio: maxScore > 0 ? totalScore / maxScore : 0,
  };
};

export const summarizeQualityResults = (results) => {
  const safeResults = Array.isArray(results) ? results : [];
  const totals = safeResults.reduce(
    (acc, result) => {
      acc.total_score += Number(result.total_score || 0);
      acc.max_score += Number(result.max_score || 0);
      for (const tag of result.failure_tags || []) {
        acc.failure_counts[tag] = (acc.failure_counts[tag] || 0) + 1;
      }
      return acc;
    },
    { total_score: 0, max_score: 0, failure_counts: {} },
  );

  return {
    meeting_count: safeResults.length,
    total_score: totals.total_score,
    max_score: totals.max_score,
    average_score_ratio:
      totals.max_score > 0 ? totals.total_score / totals.max_score : 0,
    failure_counts: totals.failure_counts,
  };
};
