import { deriveCitationTrustStatus } from '../../src/utils/trustStatus';
import { getEntity, getMeetingMid } from '../db';
import type { CitationChain, RetrievalResult } from './intelligenceTypes';

/**
 * Extract the sentence surrounding a given character index in a text.
 */
const extractSurroundingSentence = (
  text: string,
  matchIndex: number,
): string => {
  const before = text
    .slice(0, matchIndex)
    .replace(/(?:\s*\[Source\s+\d+\])+\s*$/gi, '')
    .trimEnd();
  const citationFollowsSentence = /[.!?]$/.test(before);
  const claimEnd = citationFollowsSentence ? before.length : matchIndex;
  const boundarySearchEnd = citationFollowsSentence ? claimEnd - 1 : claimEnd;
  const start = Math.max(
    before.lastIndexOf('.', boundarySearchEnd - 1),
    before.lastIndexOf('!', boundarySearchEnd - 1),
    before.lastIndexOf('?', boundarySearchEnd - 1),
    before.lastIndexOf('\n', boundarySearchEnd - 1),
  );
  const afterCitation = text
    .slice(matchIndex)
    .replace(/^\[Source\s+\d+\]/i, '');
  const nextBoundary = afterCitation.search(/[.!?\n]/);
  const claimTail = citationFollowsSentence
    ? ''
    : nextBoundary >= 0
      ? afterCitation.slice(0, nextBoundary + 1)
      : afterCitation;

  return `${before.slice(start + 1, claimEnd)}${claimTail}`
    .replace(/\[Source\s+\d+\]/gi, '')
    .trim();
};

const CLAIM_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'about',
  'be',
  'by',
  'during',
  'did',
  'do',
  'does',
  'for',
  'from',
  'if',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'who',
  'will',
  'with',
]);

const stemToken = (token: string): string => {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
};

const contentTokens = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((token) => !CLAIM_STOPWORDS.has(token))
    .map(stemToken);

const normalizeNegativeAvailability = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\b(?:unavailable|unavailability)\b/g, 'not available')
    .replace(
      /\bno\s+((?:[\p{L}\p{N}'-]+\s+){1,4})available\b/gu,
      '$1not available',
    )
    .replace(
      /\b(?:don't|didn't|doesn't|isn't|wasn't|weren't|won't|can't|couldn't|cannot)\b/g,
      ' not ',
    );

const availabilityPolarity = (
  text: string,
): 'available' | 'unavailable' | undefined => {
  const normalized = normalizeNegativeAvailability(text);
  const matches = [...normalized.matchAll(/\b(?:(not)\s+)?available\b/g)];
  const polarities = new Set(
    matches.map((match) => (match[1] ? 'unavailable' : 'available')),
  );
  return polarities.size === 1 ? [...polarities][0] : undefined;
};

const certaintyPolarity = (
  text: string,
): 'certain' | 'uncertain' | undefined => {
  const normalized = normalizeNegativeAvailability(text);
  const uncertaintyPattern =
    /\b(?:not\s+(?:know|sure|certain)|unsure|uncertain|uncertainty|unknown|no\s+idea)\b/g;
  const polarities = new Set<'certain' | 'uncertain'>();
  if (uncertaintyPattern.test(normalized)) polarities.add('uncertain');
  if (
    /\b(?:know|knew|sure|certain)\b/.test(
      normalized.replace(uncertaintyPattern, ' '),
    )
  ) {
    polarities.add('certain');
  }
  return polarities.size === 1 ? [...polarities][0] : undefined;
};

const negationSignatures = (text: string): string[][] =>
  normalizeNegativeAvailability(text)
    .split(/[.;!?]/)
    .flatMap((clause) => {
      const tokens = clause.match(/[\p{L}\p{N}'-]+/gu) || [];
      return tokens.flatMap((token, negationIndex) => {
        if (!/^(?:no|not|never|neither|nor|without)$/.test(token)) return [];
        const before = contentTokens(tokens.slice(0, negationIndex).join(' '));
        const after = contentTokens(tokens.slice(negationIndex + 1).join(' '));
        const signature = [...before.slice(-1), ...after.slice(0, 3)];
        return signature.length > 0 ? [signature] : [];
      });
    });

const negationConflicts = (claim: string, evidence: string): boolean => {
  const claimAvailability = availabilityPolarity(claim);
  const evidenceAvailability = availabilityPolarity(evidence);
  if (
    claimAvailability &&
    evidenceAvailability &&
    claimAvailability !== evidenceAvailability
  ) {
    return true;
  }
  const claimCertainty = certaintyPolarity(claim);
  const evidenceCertainty = certaintyPolarity(evidence);
  if (
    claimCertainty &&
    evidenceCertainty &&
    claimCertainty !== evidenceCertainty
  ) {
    return true;
  }
  const claimSignatures = negationSignatures(claim);
  const evidenceSignatures = negationSignatures(evidence);
  if (claimSignatures.length === 0 && evidenceSignatures.length === 0) {
    return false;
  }
  const supportsSignature = (text: string, signature: string[]): boolean => {
    const tokens = new Set(contentTokens(text));
    return (
      signature.length > 0 &&
      signature.filter((token) => tokens.has(token)).length /
        signature.length >=
        0.75
    );
  };
  if (claimSignatures.length === 0) {
    return evidenceSignatures.some((signature) =>
      supportsSignature(claim, signature),
    );
  }
  if (evidenceSignatures.length === 0) {
    return claimSignatures.some((signature) =>
      supportsSignature(evidence, signature),
    );
  }
  return !claimSignatures.some((claimSignature) =>
    evidenceSignatures.some((evidenceSignature) => {
      const evidenceTokens = new Set(evidenceSignature);
      return (
        claimSignature.filter((token) => evidenceTokens.has(token)).length /
          Math.max(claimSignature.length, evidenceSignature.length) >=
        0.75
      );
    }),
  );
};

const NON_ENTITY_CAPITALIZED_WORDS = new Set([
  'A',
  'An',
  'Another',
  'At',
  'Compared',
  'During',
  'Earlier',
  'For',
  'From',
  'In',
  'It',
  'Later',
  'Multiple',
  'No',
  'On',
  'One',
  'Several',
  'They',
  'That',
  'The',
  'There',
  'This',
  'These',
  'Those',
  'All',
  'Both',
  'Each',
  'Every',
  'Some',
  'Any',
  'Key',
  'Immediate',
  'Current',
  'Next',
  'First',
  'Second',
  'Third',
  'Also',
  'However',
  'Therefore',
  'Additionally',
  'Meanwhile',
  'Furthermore',
  'Moreover',
  'Overall',
  'Finally',
  'Lastly',
  'Then',
  'After',
  'Before',
  'Since',
  'Because',
  'Although',
  'While',
  'When',
  'Where',
  'What',
  'Which',
  'Who',
  'How',
  'Why',
  'If',
  'Unless',
  'Until',
  'As',
  'At',
  'By',
  'To',
  'With',
  'Without',
  'Under',
  'Over',
  'Between',
  'Through',
  'Across',
  'Around',
  'About',
  'Above',
  'Below',
  'Here',
  'Suggestion',
  'Recommendation',
  'Advice',
  'Note',
  'Action',
  'Project',
  'Stream',
  'Focus',
  'Status',
  'Review',
  'Update',
  'Task',
  'Priority',
  'Priorities',
  'Consider',
  'Plan',
  'Moving',
  'Going',
  'Based',
  // Common action verbs, nouns, and participles
  'Follow',
  'Follows',
  'Following',
  'Follow-up',
  'Meeting',
  'Meetings',
  'Meet',
  'Meets',
  'Prepare',
  'Prepares',
  'Preparing',
  'Preparation',
  'Preparations',
  'Coordinate',
  'Coordinates',
  'Coordinating',
  'Coordination',
  'Schedule',
  'Schedules',
  'Scheduling',
  'Scheduled',
  'Check',
  'Checks',
  'Checking',
  'Confirm',
  'Confirms',
  'Confirming',
  'Confirmation',
  'Ensure',
  'Ensures',
  'Ensuring',
  'Discuss',
  'Discusses',
  'Discussing',
  'Discussion',
  'Discussions',
  'Align',
  'Aligns',
  'Aligning',
  'Alignment',
  'Verify',
  'Verifies',
  'Verifying',
  'Verification',
  'Work',
  'Works',
  'Working',
  'Start',
  'Starts',
  'Starting',
  'Continue',
  'Continues',
  'Continuing',
  'Complete',
  'Completes',
  'Completing',
  'Completion',
  'Finish',
  'Finishes',
  'Finishing',
  'Send',
  'Sends',
  'Sending',
  'Draft',
  'Drafts',
  'Drafting',
  'Share',
  'Shares',
  'Sharing',
  'Sync',
  'Syncs',
  'Syncing',
  'Investigate',
  'Investigates',
  'Investigating',
  'Investigation',
  'Explore',
  'Explores',
  'Exploring',
  'Exploration',
  'Evaluate',
  'Evaluates',
  'Evaluating',
  'Evaluation',
  'Assess',
  'Assesses',
  'Assessing',
  'Assessment',
  'Identify',
  'Identifies',
  'Identifying',
  'Identification',
  'Address',
  'Addresses',
  'Addressing',
  'Resolve',
  'Resolves',
  'Resolving',
  'Resolution',
  'Track',
  'Tracks',
  'Tracking',
  'Monitor',
  'Monitors',
  'Monitoring',
  'Maintain',
  'Maintains',
  'Maintaining',
  'Maintenance',
  'Support',
  'Supports',
  'Supporting',
  'Clarify',
  'Clarifies',
  'Clarifying',
  'Clarification',
  'Refine',
  'Refines',
  'Refining',
  'Refinement',
  'Improve',
  'Improves',
  'Improving',
  'Improvement',
  'Optimize',
  'Optimizes',
  'Optimizing',
  'Optimization',
  'Deliver',
  'Delivers',
  'Delivering',
  'Delivery',
  'Deliverable',
  'Deliverables',
  'Manage',
  'Manages',
  'Managing',
  'Management',
  'Lead',
  'Leads',
  'Leading',
  'Implement',
  'Implements',
  'Implementing',
  'Implementation',
  'Design',
  'Designs',
  'Designing',
  'Develop',
  'Develops',
  'Developing',
  'Development',
  'Build',
  'Builds',
  'Building',
  'Create',
  'Creates',
  'Creating',
  'Set',
  'Sets',
  'Setting',
  'Help',
  'Helps',
  'Helping',
  'Provide',
  'Provides',
  'Providing',
  'Require',
  'Requires',
  'Requiring',
  'Requirement',
  'Requirements',
  'Need',
  'Needs',
  'Needing',
  'Use',
  'Uses',
  'Using',
  'See',
  'Sees',
  'Seeing',
  'Look',
  'Looks',
  'Looking',
  'Find',
  'Finds',
  'Finding',
  'Findings',
  'Take',
  'Takes',
  'Taking',
  'Make',
  'Makes',
  'Making',
  'Get',
  'Gets',
  'Getting',
  'Keep',
  'Keeps',
  'Keeping',
  'Hold',
  'Holds',
  'Holding',
  'Give',
  'Gives',
  'Giving',
  'Tell',
  'Tells',
  'Telling',
  'Ask',
  'Asks',
  'Asking',
  'Answer',
  'Answers',
  'Answering',
  'Show',
  'Shows',
  'Showing',
  'Explain',
  'Explains',
  'Explaining',
  'Explanation',
  'Remember',
  'Remembering',
  'Connect',
  'Connects',
  'Connecting',
  'Connection',
  'Reach',
  'Reaches',
  'Reaching',
  'Talk',
  'Talks',
  'Talking',
  'Decide',
  'Decides',
  'Deciding',
  'Decision',
  'Decisions',
  'Prioritize',
  'Prioritizes',
  'Prioritizing',
  'Prioritization',
  'Recommend',
  'Recommends',
  'Recommending',
  'Suggest',
  'Suggests',
  'Suggesting',
  'Please',
  // Days of week and time periods
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'Today',
  'Tomorrow',
  'Yesterday',
  'Daily',
  'Weekly',
  'Monthly',
  'Yearly',
  'Quarterly',
  'Morning',
  'Afternoon',
  'Evening',
  'Tonight',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'Day',
  'Days',
  'Week',
  'Weeks',
  'Month',
  'Months',
  'Year',
  'Years',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  // Domain and technical terms
  'PR',
  'PRs',
  'API',
  'APIs',
  'DB',
  'DBs',
  'UI',
  'UX',
  'MVP',
  'QA',
  'CI',
  'CD',
  'POC',
  'SLA',
  'SLAs',
  'OKR',
  'OKRs',
  'KPI',
  'KPIs',
  'Client',
  'Clients',
  'Customer',
  'Customers',
  'User',
  'Users',
  'Team',
  'Teams',
  'Service',
  'Services',
  'System',
  'Systems',
  'Data',
  'Database',
  'Databases',
  'Backend',
  'Frontend',
  'Architecture',
  'Infrastructure',
  'Production',
  'Staging',
  'Release',
  'Feature',
  'Features',
  'Issue',
  'Issues',
  'Bug',
  'Bugs',
  'Roadmap',
  'Milestone',
  'Milestones',
  'Sprint',
  'Sprints',
  'Summary',
  'Overview',
  'Agenda',
  'Objective',
  'Objectives',
  'Result',
  'Results',
  'Outcome',
  'Outcomes',
  'Impact',
  'Impacts',
  'Communication',
  'Communications',
]);

const namedTerms = (text: string): string[] =>
  (text.match(/\b[\p{Lu}][\p{L}\p{N}'-]+\b/gu) || []).filter(
    (term) => !NON_ENTITY_CAPITALIZED_WORDS.has(term),
  );

const evidenceSupportScore = (claim: string, evidence: string): number => {
  const claimTokens = [...new Set(contentTokens(claim))];
  if (claimTokens.length === 0) return 0;
  const evidenceTokenSet = new Set(contentTokens(evidence));
  const matched = claimTokens.filter((token) => evidenceTokenSet.has(token));
  return matched.length / claimTokens.length;
};

const resolveSecondPersonClaim = (claim: string, selfName?: string): string =>
  selfName
    ? claim
        .replace(/\byou're\b/gi, `${selfName} is`)
        .replace(/\byour\b/gi, `${selfName}'s`)
        .replace(/\byou\b/gi, selfName)
    : claim;

const refersToConfirmedSelf = (claim: string, selfName?: string): boolean =>
  Boolean(selfName && /\b(?:you|your|you're)\b/i.test(claim));

export const claimIsSupportedByEvidence = (
  claim: string,
  evidence: string | undefined,
  selfName?: string,
): boolean => {
  if (!evidence?.trim()) return false;
  const evidenceClaim = resolveSecondPersonClaim(claim, selfName);
  if (negationConflicts(evidenceClaim, evidence)) return false;

  const claimNumbers = evidenceClaim.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  if (claimNumbers.some((value) => !evidence.includes(value))) return false;

  const normalizedEvidence = evidence.toLocaleLowerCase();
  if (
    namedTerms(evidenceClaim).some(
      (term) => !normalizedEvidence.includes(term.toLocaleLowerCase()),
    )
  ) {
    return false;
  }

  const normalizedClaim = contentTokens(evidenceClaim);
  const minimumCoverage =
    evidence.length > 300 ? 0.35 : normalizedClaim.length <= 3 ? 1 : 0.6;
  return evidenceSupportScore(evidenceClaim, evidence) >= minimumCoverage;
};

/**
 * Get the first meaningful evidence span from a retrieval result's MID.
 */
const getSourceEvidenceCandidates = (source: RetrievalResult): string[] => {
  const evidenceUnits = (source.evidence_text || '')
    .split('\n')
    .flatMap((line) => {
      const cleanLine = line.replace(/^\[[^\]]+\]:?\s*/, '').trim();
      if (!cleanLine) return [];
      const sentences = cleanLine
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 20);
      return sentences.length > 1 ? sentences : [cleanLine];
    });
  const adjacentEvidence = evidenceUnits.flatMap((_, index) =>
    [2, 3]
      .map((windowSize) => evidenceUnits.slice(index, index + windowSize))
      .filter((window) => window.length > 1)
      .map((window) => window.join('\n'))
      .filter((window) => window.length <= 320),
  );
  const sectionUnits =
    source.source_type === 'artifact'
      ? (source.evidence_text || '')
          .split(/\n\n+/)
          .map((block) => block.trim())
          .filter((block) => block.length > 20)
      : [];
  return [
    ...(source.mid?.evidence_spans?.map((span) => span.quote) || []),
    ...(source.mid?.decisions?.map((decision) => decision.description) || []),
    ...(source.mid?.action_items?.map((item) => item.description) || []),
    ...sectionUnits,
    ...evidenceUnits,
    ...adjacentEvidence,
  ].filter((candidate, index, candidates) => {
    const normalized = candidate.trim().toLocaleLowerCase();
    return (
      normalized.length > 0 &&
      candidates.findIndex(
        (value) => value.trim().toLocaleLowerCase() === normalized,
      ) === index
    );
  });
};

const getBestEvidenceSpan = (
  source: RetrievalResult,
  claim: string,
  selfName?: string,
): string | undefined => {
  const candidates = getSourceEvidenceCandidates(source);
  // Adjacent evidence helps ordinary claims, but must not join a person's
  // identity from one sentence to somebody else's action in the next.
  const scopedCandidates = refersToConfirmedSelf(claim, selfName)
    ? candidates
        .flatMap((candidate) =>
          candidate.split(/\n+|(?<=[.!?])\s+/).map((part) => part.trim()),
        )
        .filter((candidate) =>
          candidate.toLocaleLowerCase().includes(selfName!.toLocaleLowerCase()),
        )
    : candidates;
  const evidenceClaim = resolveSecondPersonClaim(claim, selfName);
  return scopedCandidates
    .map((evidence, index) => ({
      evidence,
      index,
      score: evidenceSupportScore(evidenceClaim, evidence),
    }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    )[0]
    ?.evidence.slice(0, 320);
};

/**
 * Builds a citation chain from the LLM's synthesized answer.
 * Primary format: [Source N] bracket references.
 * Fallback: legacy XML <cite> tags (including malformed ones).
 */
export const buildCitationChain = (
  answer: string,
  sources: RetrievalResult[],
  selfName?: string,
): CitationChain[] => {
  const citations: CitationChain[] = [];
  const seenClaimSources = new Set<string>();

  // Primary: match [Source N] references
  const sourceRefRegex = /\[Source\s+(\d+)\]/gi;
  for (const match of answer.matchAll(sourceRefRegex)) {
    const sourceIdx = Number.parseInt(match[1], 10) - 1; // 0-indexed
    if (sourceIdx >= 0 && sourceIdx < sources.length) {
      const source = sources[sourceIdx];
      const claim = extractSurroundingSentence(answer, match.index ?? 0);
      const claimSourceKey = `${sourceIdx}:${claim.toLowerCase()}`;
      if (seenClaimSources.has(claimSourceKey)) continue;
      seenClaimSources.add(claimSourceKey);

      const evidenceSpan = getBestEvidenceSpan(source, claim, selfName);
      const transcriptPassage = source.transcript_passages?.find((passage) =>
        evidenceSpan
          ? passage.quote
              .toLocaleLowerCase()
              .includes(evidenceSpan.toLocaleLowerCase()) ||
            evidenceSpan
              .toLocaleLowerCase()
              .includes(passage.quote.toLocaleLowerCase())
          : false,
      );
      const section = source.retrieved_sections?.[0];

      citations.push({
        claim,
        meeting_id: source.meeting_id,
        meeting_title:
          source.meeting_title || source.mid?.title || 'Unknown Meeting',
        source_type: source.source_type || 'meeting',
        source_id: source.source_id || source.meeting_id,
        evidence_span: evidenceSpan,
        evidence_valid: false, // set by auditCitations
        trust_status: 'needs_review',
        evidence_kind: transcriptPassage ? 'transcript' : source.evidence_kind,
        section_id: section?.section_id,
        section_heading: section?.heading,
        timestamp_ms: transcriptPassage?.start_ms,
        timestamp_end_ms: transcriptPassage?.end_ms,
        source_revision:
          transcriptPassage?.source_revision || source.source_revision,
      });
    }
  }

  // Fallback: legacy <cite> tag support (handle malformed tags like -cite, < cite)
  if (citations.length === 0) {
    const legacyCiteRegex =
      /<?\-?cite\s+meeting="([^"]+)"(?:\s+entity="([^"]*)")?(?:\s+quote="([^"]*)")?>([\s\S]*?)<\/cite>/gi;
    for (const legacyMatch of answer.matchAll(legacyCiteRegex)) {
      const meeting_id = legacyMatch[1];
      const entity_id = legacyMatch[2];
      const evidence_span = legacyMatch[3];
      const claim = legacyMatch[4].trim();

      const source = sources.find((s) => s.meeting_id === meeting_id);
      const meetingTitle =
        source?.meeting_title || source?.mid?.title || 'Unknown Meeting';

      citations.push({
        claim,
        meeting_id,
        meeting_title: meetingTitle,
        source_type: source?.source_type || 'meeting',
        source_id: source?.source_id || meeting_id,
        entity_id: entity_id || undefined,
        evidence_span: evidence_span || undefined,
        evidence_valid: false,
        trust_status: 'needs_review',
        evidence_kind: source?.evidence_kind,
        section_id: source?.retrieved_sections?.[0]?.section_id,
        section_heading: source?.retrieved_sections?.[0]?.heading,
        timestamp_ms: source?.transcript_passages?.[0]?.start_ms,
        timestamp_end_ms: source?.transcript_passages?.[0]?.end_ms,
        source_revision:
          source?.transcript_passages?.[0]?.source_revision ||
          source?.source_revision,
      });
    }
  }

  // Small local models occasionally omit an inline reference even when their
  // sentence closely follows one retrieved source. Recover only claims that
  // pass the same deterministic evidence checks used by the citation audit.
  const answerClaims = answer
    .replace(/<?\-?cite[^>]*>/gi, '')
    .replace(/<\/cite>/gi, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((claim) => claim.replace(/\[Source\s+\d+\]/gi, '').trim())
    .filter((claim) => contentTokens(claim).length >= 2);
  for (const claim of answerClaims) {
    if (
      COMPARATIVE_CLAIM_PATTERN.test(claim) ||
      citations.some(
        (citation) =>
          citation.claim.trim().toLocaleLowerCase() ===
          claim.toLocaleLowerCase(),
      )
    ) {
      continue;
    }
    const sourceIndex = sources.findIndex((source) => {
      const evidenceSpan = getBestEvidenceSpan(source, claim, selfName);
      return claimIsSupportedByEvidence(
        claim,
        refersToConfirmedSelf(claim, selfName)
          ? evidenceSpan
          : [
              evidenceSpan || '',
              source.meeting_title || source.mid?.title || '',
              source.evidence_text,
            ]
              .filter(Boolean)
              .join('\n'),
        selfName,
      );
    });
    if (sourceIndex < 0) continue;

    const source = sources[sourceIndex];
    const evidenceSpan = getBestEvidenceSpan(source, claim, selfName);
    const transcriptPassage = source.transcript_passages?.find((passage) =>
      evidenceSpan
        ? passage.quote
            .toLocaleLowerCase()
            .includes(evidenceSpan.toLocaleLowerCase()) ||
          evidenceSpan
            .toLocaleLowerCase()
            .includes(passage.quote.toLocaleLowerCase())
        : false,
    );
    const section = source.retrieved_sections?.[0];
    citations.push({
      claim,
      meeting_id: source.meeting_id,
      meeting_title:
        source.meeting_title || source.mid?.title || 'Unknown Meeting',
      source_type: source.source_type || 'meeting',
      source_id: source.source_id || source.meeting_id,
      evidence_span: evidenceSpan,
      evidence_valid: false,
      trust_status: 'needs_review',
      evidence_kind: transcriptPassage ? 'transcript' : source.evidence_kind,
      section_id: section?.section_id,
      section_heading: section?.heading,
      timestamp_ms: transcriptPassage?.start_ms,
      timestamp_end_ms: transcriptPassage?.end_ms,
      source_revision:
        transcriptPassage?.source_revision || source.source_revision,
    });
  }

  return citations;
};

export const normalizeClaimKey = (claim: string): string =>
  claim
    .replace(/^[-*•]\s*/, '')
    .replace(/\[Source\s+\d+\]/gi, '')
    .replace(/\s+([.!?])/g, '$1')
    .replace(/[\s.!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();

/**
 * Structural citation audit. Verifies that cited meeting_ids exist in the DB,
 * entity_ids resolve, and evidence quotes are present in the MID's evidence_spans.
 * Requires NO second LLM call.
 */
export const auditCitations = (
  citations: CitationChain[],
  sources: RetrievalResult[] = [],
  selfName?: string,
): CitationChain[] => {
  const structural = citations.map((citation) => {
    let structurallyValid = true;
    const source = sources.find(
      (candidate) => candidate.meeting_id === citation.meeting_id,
    );

    // 1. Verify meeting and MID exist
    const mid = source?.mid || getMeetingMid(citation.meeting_id);
    if (!source && !mid) {
      structurallyValid = false;
    } else {
      // 2. Verify entity_id resolves if provided and not empty
      if (citation.entity_id && citation.entity_id.trim() !== '') {
        const entity = getEntity(citation.entity_id);
        if (!entity) {
          structurallyValid = false;
        }
      }

      // 3. Verify evidence span exists in MID spans if provided and not empty
      if (
        structurallyValid &&
        citation.evidence_span &&
        citation.evidence_span.trim() !== ''
      ) {
        const needle = citation.evidence_span.toLowerCase().trim();
        const spanFound =
          (source ? getSourceEvidenceCandidates(source) : []).some(
            (candidate) => {
              const haystack = candidate.toLowerCase();
              return haystack.includes(needle) || needle.includes(haystack);
            },
          ) ||
          mid?.evidence_spans?.some((span) => {
            const haystack = span.quote.toLowerCase();
            return haystack.includes(needle) || needle.includes(haystack);
          });

        if (!spanFound) {
          structurallyValid = false;
        }
      }
    }

    return { citation, structurallyValid };
  });

  const claimGroups = new Map<string, typeof structural>();
  for (const item of structural) {
    const key = normalizeClaimKey(item.citation.claim);
    if (!key) continue;
    const group = claimGroups.get(key) || [];
    group.push(item);
    claimGroups.set(key, group);
  }

  // Synthesized note/profile sources (evidence_kind: 'note' | 'section' | 'overview' |
  // 'commitment' | 'artifact') are already grounded, verified truth. Running token-overlap
  // validation against pre-verified text is wasteful and harmful: paraphrases of ground-truth
  // notes fail the overlap check even when factually accurate, producing false negatives.
  // Only bypass for explicitly synthesized kinds — unknown/undefined keeps the strict path.
  const SYNTHESIZED_EVIDENCE_KINDS = new Set<string>([
    'note',
    'section',
    'overview',
    'commitment',
    'artifact',
  ]);
  const isSynthesizedSource = (s: RetrievalResult | undefined): boolean =>
    s !== undefined &&
    s.evidence_kind !== undefined &&
    SYNTHESIZED_EVIDENCE_KINDS.has(s.evidence_kind);

  return structural.map(({ citation, structurallyValid }) => {
    const source = sources.find(
      (candidate) => candidate.meeting_id === citation.meeting_id,
    );
    const selfClaim = refersToConfirmedSelf(citation.claim, selfName);
    const directSupport = selfClaim
      ? citation.evidence_span || ''
      : [
          citation.evidence_span || '',
          source?.meeting_title || source?.mid?.title || '',
          source?.evidence_text || '',
        ]
          .filter(Boolean)
          .join('\n');
    const provisionalSource =
      source !== undefined &&
      /^\[(?:Current recording|Live transcript|Interim transcript)[^\]]*(?:provisional|unconfirmed)/im.test(
        source.evidence_text,
      );
    const claimKey = normalizeClaimKey(citation.claim);
    const group = (claimKey ? claimGroups.get(claimKey) : undefined) || [];

    // For synthesized sources, structural validity is sufficient — skip token-overlap.
    const synthesized = isSynthesizedSource(source);
    const combinedSupport =
      !selfClaim &&
      group.length > 1 &&
      group.every((item) => item.structurallyValid) &&
      (group.every((item) =>
        isSynthesizedSource(
          sources.find(
            (candidate) => candidate.meeting_id === item.citation.meeting_id,
          ),
        ),
      ) ||
        claimIsSupportedByEvidence(
          citation.claim,
          group
            .flatMap((item) => {
              const itemSource = sources.find(
                (candidate) =>
                  candidate.meeting_id === item.citation.meeting_id,
              );
              return [
                item.citation.evidence_span || '',
                itemSource?.meeting_title || itemSource?.mid?.title || '',
                itemSource?.evidence_text || '',
              ];
            })
            .filter(Boolean)
            .join('\n'),
          selfName,
        ));
    const evidence_valid =
      structurallyValid &&
      (synthesized ||
        claimIsSupportedByEvidence(citation.claim, directSupport, selfName) ||
        combinedSupport);

    return {
      ...citation,
      evidence_valid,
      trust_status:
        evidence_valid && (combinedSupport || provisionalSource)
          ? ('inferred' as const)
          : deriveCitationTrustStatus({ evidenceValid: evidence_valid }),
    };
  });
};

const COMPARATIVE_CLAIM_PATTERN =
  /\b(compare|compared|difference|different|changed?|moved|more|most|less|earlier|later|whereas|while|unlike|versus|vs|primary|main concern|biggest|recurring|pattern|consistently|across meetings)\b/i;

type AnswerValidationMode = 'grounded' | 'analysis' | 'draft';

export const isHeadingText = (text: string): boolean => {
  const trimmed = text
    .replace(/\[Source\s+\d+\]/gi, '')
    .replace(/^[*_#`~]+|[*_#`~]+$/g, '')
    .trim();
  if (!trimmed) return false;
  if (/^[-*•]\s+/.test(trimmed)) return false;
  if (/^#{1,6}\s+/.test(text.trim())) return true;
  if (/^(?:Subject|From|To|Cc|Bcc|Date):/i.test(trimmed)) return false;
  if (/^(?:Hi|Hello|Hey|Dear)\b/i.test(trimmed)) return false;
  if (/^[A-Z][\w\s&/'-]{1,60}:?$/.test(trimmed)) return true;
  if (
    trimmed.length <= 60 &&
    !/[.!?,;]$/.test(trimmed) &&
    /^[A-Z0-9]/.test(trimmed) &&
    !trimmed.includes('\n')
  ) {
    return true;
  }
  return false;
};

export const isStructuralFraming = (text: string): boolean => {
  const trimmed = text.replace(/\[Source\s+\d+\]/gi, '').trim();
  if (!trimmed) return false;
  if (isHeadingText(trimmed)) return true;
  return (
    /^(?:Here (?:are|is)|Below (?:are|is)|The following (?:are|is)|In summary|Overall|To summarize)\b/i.test(
      trimmed,
    ) ||
    /^(?:Based on|Looking at|According to)\s+(?:your|the|our)\s+(?:open\s+)?(?:commitments?|action items?|tasks?|meetings?|discussions?|sources?|history)/i.test(
      trimmed,
    ) ||
    /^(?:Possible follow-ups|Unconfirmed assignments?|Candidate follow-ups?)\b/i.test(
      trimmed,
    )
  );
};

export const pruneOrphanHeadings = (text: string): string => {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const result: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const current = paragraphs[i];
    if (isHeadingText(current)) {
      const next = paragraphs[i + 1];
      if (
        !next ||
        isHeadingText(next) ||
        (/^(?:Suggestion|Recommendation|Advice):/i.test(next) &&
          !/^(?:Suggestions?|Recommendations?|Advice|Next steps?)/i.test(
            current,
          ))
      ) {
        continue;
      }
    }
    result.push(current);
  }

  return result.join('\n\n');
};

export const isNonFactualResponseText = (
  sentence: string,
  mode: AnswerValidationMode,
): boolean => {
  const text = sentence
    .replace(/\[Source\s+\d+\]/gi, '')
    .replace(/^[*_#`~]+|[*_#`~]+$/g, '')
    .trim();
  if (isStructuralFraming(text)) return true;
  if (mode === 'analysis') {
    if (
      /^(?:Suggestion|Recommendation|Advice|Takeaway|Next steps?|Focus(?: on)?|Priorit(?:y|ize|ies)|Action plan|Consider|Key focus|Summary|Overview):?/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(?:You should|I recommend|It is recommended|Consider|Prioritize|Focus on|Start by|We should|Plan to|Make sure to|Be sure to)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(?:These|This|The above|Such)\s+(?:items?|tasks?|commitments?|priorities|actions?|streams?|projects?)\s+(?:represent|involve|depend|require|should|are based|help|have|will|can)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(?:This|These|It)\s+(?:ensures|helps|allows|unblocks|prevents|aligns|supports|provides|addresses|reflects|aims|is intended|is needed|is critical|is essential)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(?:Key|Immediate|Primary|Main|Top|Upcoming|Current|Ongoing)\s+(?:focus|priorit(?:y|ies)|objectives?|goals?|initiatives?|themes?|areas?|deliverables?|streams?|efforts?)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(?:In terms of|Regarding|For|With respect to|Across|From)\s+(?:the\s+)?(?:active\s+)?(?:projects?|streams?|meetings?|discussions?|commitments?|priorities|work)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(?:There (?:are|is)|Currently|At present|As of now|No formal|No verified|You have|The team has|Work is)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /^(?:Moving forward|Going forward|To start|To begin|As a next step|First,|Second,|Third,|Next,)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /\b(?:direct dependencies on your output|blocking dependenc(?:y|ies)|immediate attention|highest priority|top priority)\b/i.test(
        text,
      )
    ) {
      return true;
    }
  }
  if (mode !== 'draft') return false;
  return (
    /^(?:Subject:|Hi(?:\s+[\p{L}'-]+){0,4},?$|Hello(?:\s+[\p{L}'-]+){0,4},?$|Dear(?:\s+[\p{L}'-]+){0,4},?$|Best,?$|Regards,?$|Sincerely,?$|Thanks,?$|Thank you,?$)/iu.test(
      text,
    ) ||
    /^(?:Could you|Would you|Please|Let me know|Can we|I'd like to|I would like to|Looking forward)\b/i.test(
      text,
    )
  );
};

const isMaterialClaim = (
  sentence: string,
  mode: AnswerValidationMode = 'grounded',
): boolean => {
  const withoutCitations = sentence.replace(/\[Source\s+\d+\]/gi, '').trim();
  if (!withoutCitations) return false;
  if (/^I couldn't find information/i.test(withoutCitations)) return false;
  if (isNonFactualResponseText(withoutCitations, mode)) return false;
  return contentTokens(withoutCitations).length >= 2;
};

const CONTEXTLESS_CLAIM_PATTERN =
  /\b(?:one|a|another|the)\s+(?:speaker|participant|attendee)\b|\b(?:an?|the)\s+(?:application|app|project|product|tool)\b/i;

const isContextfulClaim = (claim: string): boolean =>
  !CONTEXTLESS_CLAIM_PATTERN.test(
    claim.replace(/\[Source\s+\d+\]/gi, '').trim(),
  );

export const auditAnswerGrounding = (
  answer: string,
  citations: CitationChain[],
  mode: AnswerValidationMode = 'grounded',
): {
  trustStatus: 'grounded' | 'inferred' | 'needs_review';
  unsupportedClaimCount: number;
  unsupportedClaims: string[];
} => {
  const sentences = answer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => isMaterialClaim(sentence, mode));
  let unsupportedClaimCount = 0;
  const unsupportedClaims: string[] = [];
  let inferred = false;

  for (const sentence of sentences) {
    const cleanSentence = sentence
      .replace(/\[Source\s+\d+\]/gi, '')
      .trim()
      .replace(/[.!?]+$/, '');
    const sentenceKey = normalizeClaimKey(sentence);
    const matching = citations.filter((citation) => {
      const claimKey = normalizeClaimKey(citation.claim);
      return Boolean(sentenceKey && claimKey === sentenceKey);
    });
    const citedMeetings = new Set(
      matching.map((citation) => citation.meeting_id),
    );
    const comparisonNeedsTwoSources =
      COMPARATIVE_CLAIM_PATTERN.test(cleanSentence);
    const supported =
      matching.length > 0 &&
      isContextfulClaim(cleanSentence) &&
      matching.every((citation) => citation.evidence_valid) &&
      (!comparisonNeedsTwoSources || citedMeetings.size >= 2);
    if (!supported) {
      unsupportedClaimCount += 1;
      unsupportedClaims.push(sentence.replace(/\[Source\s+\d+\]/gi, '').trim());
    } else if (
      citedMeetings.size >= 2 ||
      matching.some((citation) => citation.trust_status === 'inferred')
    ) {
      inferred = true;
    }
  }

  return {
    trustStatus:
      unsupportedClaimCount > 0
        ? 'needs_review'
        : inferred
          ? 'inferred'
          : 'grounded',
    unsupportedClaimCount,
    unsupportedClaims,
  };
};

export const buildSafeAnswerPresentation = (
  answer: string,
  citations: CitationChain[],
  mode: AnswerValidationMode = 'grounded',
): {
  answer: string;
  citations: CitationChain[];
  outcome: 'answered' | 'partial' | 'no_evidence';
  trustStatus: 'grounded' | 'inferred' | undefined;
  unsupportedClaimCount: number;
  unsupportedClaims: string[];
} => {
  const cleanAnswer = answer
    .replace(/\s*\[Source\s+\d+\]/gi, '')
    .replace(/<?\-?cite[^>]*>[\s\S]*?<\/cite>/gi, '')
    .replace(/\s+([.!?])/g, '$1')
    .trim();
  if (/^I couldn't find information/i.test(cleanAnswer)) {
    return {
      answer: cleanAnswer,
      citations: [],
      outcome: 'no_evidence',
      trustStatus: undefined,
      unsupportedClaimCount: 0,
      unsupportedClaims: [],
    };
  }

  const grounding = auditAnswerGrounding(answer, citations, mode);
  if (grounding.unsupportedClaimCount === 0) {
    return {
      answer: pruneOrphanHeadings(cleanAnswer),
      citations,
      outcome: 'answered',
      trustStatus:
        grounding.trustStatus === 'inferred' ? 'inferred' : 'grounded',
      unsupportedClaimCount: 0,
      unsupportedClaims: [],
    };
  }

  const grouped = new Map<string, CitationChain[]>();
  for (const citation of citations) {
    const key = normalizeClaimKey(citation.claim);
    if (!key) continue;
    const group = grouped.get(key) || [];
    group.push(citation);
    grouped.set(key, group);
  }
  const supportedGroups = [...grouped.values()].filter((group) => {
    const meetings = new Set(group.map((citation) => citation.meeting_id));
    return (
      isContextfulClaim(group[0].claim) &&
      group.every((citation) => citation.evidence_valid) &&
      (!COMPARATIVE_CLAIM_PATTERN.test(group[0].claim) || meetings.size >= 2)
    );
  });
  const supportedCitations = supportedGroups.flat();
  if (supportedCitations.length === 0) {
    return {
      answer:
        "I couldn't verify a clear answer from what I retrieved. Try asking about a specific meeting or topic.",
      citations: [],
      outcome: 'no_evidence',
      trustStatus: undefined,
      unsupportedClaimCount: grounding.unsupportedClaimCount,
      unsupportedClaims: grounding.unsupportedClaims,
    };
  }

  const seenClaimKeys = new Set<string>();
  const deduplicatedSupportedGroups = supportedGroups.filter((group) => {
    const key = normalizeClaimKey(group[0].claim);
    if (!key || seenClaimKeys.has(key)) return false;
    seenClaimKeys.add(key);
    return true;
  });
  const supportedClaims = deduplicatedSupportedGroups.map((group) =>
    group[0].claim.trim(),
  );
  const supportedClaimKeys = new Set(
    supportedClaims.map((claim) => normalizeClaimKey(claim)),
  );
  const preservedAnswer =
    mode === 'grounded'
      ? undefined
      : answer
          .split(/\n+/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .filter((paragraph) => {
            const sentences = paragraph
              .split(/(?<=[.!?])\s+/)
              .map((sentence) => sentence.trim())
              .filter(Boolean);
            const material = sentences.filter((s) => isMaterialClaim(s, mode));
            if (material.length === 0) return true;
            if (mode === 'analysis') {
              return material.some((s) =>
                supportedClaimKeys.has(normalizeClaimKey(s)),
              );
            }
            return material.every((s) =>
              supportedClaimKeys.has(normalizeClaimKey(s)),
            );
          })
          .map((paragraph) =>
            paragraph
              .replace(/\s*\[Source\s+\d+\]/gi, '')
              .replace(/\s+([.!?])/g, '$1')
              .trim(),
          )
          .join('\n\n');
  const supportedClaimSeparator = supportedClaims.some((claim) =>
    /^[-*]\s/.test(claim),
  )
    ? '\n'
    : ' ';
  const inferred = supportedGroups.some(
    (group) =>
      new Set(group.map((citation) => citation.meeting_id)).size >= 2 ||
      group.some((citation) => citation.trust_status === 'inferred'),
  );
  const cleanedPreserved = preservedAnswer
    ? pruneOrphanHeadings(preservedAnswer)
    : undefined;
  const finalAnswer =
    cleanedPreserved && cleanedPreserved.trim().length > 0
      ? cleanedPreserved
      : supportedClaims.join(supportedClaimSeparator);

  const outcome =
    mode === 'analysis' &&
    cleanedPreserved &&
    supportedCitations.length > 0 &&
    cleanedPreserved.trim().length >= cleanAnswer.trim().length * 0.7
      ? 'answered'
      : 'partial';

  return {
    answer: finalAnswer || cleanAnswer,
    citations: supportedCitations,
    outcome,
    trustStatus: inferred ? 'inferred' : 'grounded',
    unsupportedClaimCount:
      outcome === 'answered' ? 0 : grounding.unsupportedClaimCount,
    unsupportedClaims:
      outcome === 'answered' ? [] : grounding.unsupportedClaims,
  };
};

export type SafeAnswerPresentation = ReturnType<
  typeof buildSafeAnswerPresentation
>;

/**
 * Buffers provider tokens at the trust boundary and releases only claims that
 * already have a complete, audited source reference. The final presentation
 * remains authoritative, but it can no longer retract an unsupported raw draft
 * that the renderer was allowed to present as an answer.
 */
export const createValidatedAnswerStream = (
  sources: RetrievalResult[],
  onDelta: (delta: string) => void,
  mode: AnswerValidationMode = 'grounded',
  onValidated?: (presentation: SafeAnswerPresentation) => void,
  selfName?: string,
): {
  push: (delta: string) => void;
  finalize: (answer: string) => SafeAnswerPresentation;
  readonly streamedAnswer: string;
} => {
  let rawAnswer = '';
  let streamedAnswer = '';
  let auditedReferenceCount = 0;

  const emitSupportedExtension = (
    presentation: SafeAnswerPresentation,
  ): void => {
    if (
      presentation.outcome === 'no_evidence' ||
      !presentation.answer.startsWith(streamedAnswer) ||
      presentation.answer.length === streamedAnswer.length
    ) {
      return;
    }
    const delta = presentation.answer.slice(streamedAnswer.length);
    streamedAnswer = presentation.answer;
    onValidated?.(presentation);
    onDelta(delta);
  };

  const auditCurrentAnswer = (): SafeAnswerPresentation => {
    const citations = auditCitations(
      buildCitationChain(rawAnswer, sources, selfName),
      sources,
      selfName,
    );
    return buildSafeAnswerPresentation(rawAnswer, citations, mode);
  };

  const push = (delta: string): void => {
    if (!delta) return;
    rawAnswer += delta;
    const references = [...rawAnswer.matchAll(/\[Source\s+\d+\]/gi)];
    if (references.length <= auditedReferenceCount) return;

    auditedReferenceCount = references.length;
    emitSupportedExtension(auditCurrentAnswer());
  };

  return {
    push,
    finalize: (answer: string) => {
      rawAnswer = answer;
      return auditCurrentAnswer();
    },
    get streamedAnswer() {
      return streamedAnswer;
    },
  };
};
