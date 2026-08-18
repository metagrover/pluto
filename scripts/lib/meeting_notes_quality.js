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

const hasNegativePolarity = (value) =>
  /\b(?:not(?!-)|never|no longer|don't|do not|won't|will not|cannot|can't|reject(?:ed)?|declin(?:e|ed)|cancel(?:led|ed)?)\b/i.test(
    value,
  );

const hasContradictoryConcept = (actual, expected) => {
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  const containsTerm = (value, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(value);
  };
  const opposites = [
    ['filter out', 'include'],
    ['before', 'after'],
    ['increase', 'decrease'],
    ['selected', 'rejected'],
    ['enable', 'disable'],
    ['allow', 'block'],
    ['remove', 'retain'],
    ['start', 'stop'],
    ['accept', 'reject'],
    ['approve', 'reject'],
  ];
  if (
    opposites.some(
      ([left, right]) =>
        (containsTerm(normalizedActual, left) &&
          containsTerm(normalizedExpected, right)) ||
        (containsTerm(normalizedActual, right) &&
          containsTerm(normalizedExpected, left)),
    )
  ) {
    return true;
  }
  const relationSides = (value, relation) => {
    const tokens = value.split(/[^a-z0-9]+/).filter(Boolean);
    const relationIndex = tokens.indexOf(relation);
    if (relationIndex < 1 || relationIndex >= tokens.length - 1) return null;
    const ignored = new Set([
      'a',
      'an',
      'and',
      'i',
      'run',
      'the',
      'to',
      'we',
      'will',
    ]);
    const left = tokens
      .slice(0, relationIndex)
      .filter((token) => !ignored.has(token));
    const right = tokens
      .slice(relationIndex + 1)
      .filter((token) => !ignored.has(token));
    return left.length > 0 && right.length > 0 ? { left, right } : null;
  };
  const relationSideMatches = (left, right) => {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const intersection = [...leftSet].filter((token) => rightSet.has(token));
    return intersection.length >= 1;
  };
  const distinguishingRelationSides = (sides) => {
    const leftSet = new Set(sides.left);
    const rightSet = new Set(sides.right);
    const shared = new Set([...leftSet].filter((token) => rightSet.has(token)));
    return {
      left: sides.left.filter((token) => !shared.has(token)),
      right: sides.right.filter((token) => !shared.has(token)),
    };
  };
  return ['before', 'after'].some((relation) => {
    const actualSides = relationSides(normalizedActual, relation);
    const expectedSides = relationSides(normalizedExpected, relation);
    const distinguishingActualSides = actualSides
      ? distinguishingRelationSides(actualSides)
      : null;
    const distinguishingExpectedSides = expectedSides
      ? distinguishingRelationSides(expectedSides)
      : null;
    return (
      distinguishingActualSides &&
      distinguishingExpectedSides &&
      relationSideMatches(
        distinguishingActualSides.left,
        distinguishingExpectedSides.right,
      ) &&
      relationSideMatches(
        distinguishingActualSides.right,
        distinguishingExpectedSides.left,
      )
    );
  });
};

const conceptStopWords = new Set([
  'a',
  'an',
  'and',
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
    .replace(/\b(?:loaded|loading)\b/g, 'load')
    .replace(/\bprior to\b/g, 'before')
    .replace(/\bfirst\b/g, 'before')
    .replace(/\b(?:aligned|agreed|settled)\b/g, 'agree')
    .replace(/\b(?:distinct|separation)\b/g, 'separate')
    .replace(/\bcomputation\b/g, 'compute')
    .replace(/\bscoring\b/g, 'score');
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
  if (
    haystack.some(
      (item) =>
        hasNegativePolarity(item) === hasNegativePolarity(needle) &&
        !hasContradictoryConcept(item, needle) &&
        includesNormalized([item], needle),
    )
  ) {
    return true;
  }
  const expected = [...new Set(conceptTokens(needle))];
  if (expected.length === 0) return false;
  return haystack.some((item) => {
    if (hasNegativePolarity(item) !== hasNegativePolarity(needle)) {
      return false;
    }
    if (hasContradictoryConcept(item, needle)) return false;
    const actual = new Set(conceptTokens(item));
    const matches = expected.filter((token) => actual.has(token)).length;
    return (
      matches >= Math.min(2, expected.length) &&
      expected.length - matches <= 1 &&
      matches / expected.length >= 0.8
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
      !flattened.keyPoints.some(
        (keyPoint) =>
          normalizeText(keyPoint?.speaker || 'unknown') ===
            normalizeText(item.speaker || 'unknown') &&
          includesConcept([keyPoint?.text || ''], item.text),
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
