import { canonicalizeActionText } from '../../src/utils/actionCommitment';
import { buildCitedSpeakerAliasProof } from './meetingNotesSource';
import type { NotesDraft, NotesSource, SourceSpan } from './meetingNotesTypes';

export type NotesGuardrailIssue = {
  code:
    | 'missing_action'
    | 'missing_condition'
    | 'conflicting_action'
    | 'missing_cancellation_context';
  sources: SourceSpan[];
};

// Deliberately small: these checks are a repair signal, not an action extractor.
// State, intention, reported speech, and ambiguous task identity must abstain.
const TASK_VERBS =
  'send|email|share|review|update|prepare|write|draft|create|check|book|schedule|publish|upload|finish|replace|coordinate|provide|rerun';
const TASK_BOUNDARY = new RegExp(
  `\\s+and\\s+(?=(?:(?:i['’]ll|i will)\\s+)?(?:${TASK_VERBS})\\b)`,
  'i',
);
const PROMISE =
  /^(?:yes[, ]+|okay[, ]+|sure[, ]+)?(?:i['’]ll|i will|i commit to)\s+(.+)$/i;
const COMPLETED_PROMISE =
  /^i(?:(?:['’]ve| have)\s+(?:already\s+)?|\s+already\s+|\s+)((?:sent|emailed|shared|reviewed|updated|prepared|written|drafted|created|checked|booked|scheduled|published|uploaded|finished|replaced|coordinated|provided|rerun)\s+.+)/i;
export const CONDITION =
  /\b(?:only if|if|unless|until|once|after|when|provided(?: that)?|pending|subject to|conditional on|contingent (?:on|upon)|(?:not\s+)?(?:requires?|requiring))\b/i;
// Recognizable trailing due phrases are metadata, not task identity. Do not
// strip arbitrary "by ..." text, which could name the task's recipient/author.
const DUE_PHRASE =
  /\s+(?:by|on|before)\s+(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|today|tomorrow|\d{4}-\d{2}-\d{2})[.!]?$/i;
const NEGATION = /\b(?:not|never|no)\b|n['’]t\b/i;
const NON_CONTENT = new Set(
  'i we you the a an to for of in on at by with and that it this my our will shall please tomorrow today next week morning afternoon'.split(
    ' ',
  ),
);

const knownOwnerLabel = (value: string | null): string | null => {
  const label = value?.trim().toLocaleLowerCase();
  return label && !['them', 'unknown', 'speaker'].includes(label)
    ? label
    : null;
};

type Sentence = {
  text: string;
  span: SourceSpan;
  speaker: string | null;
  order: number;
};
type Candidate = {
  task: string;
  exactTask: string;
  condition: string | null;
  sources: SourceSpan[];
  order: number;
  speaker: string | null;
};

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((word) => !NON_CONTENT.has(word))
    .map((word) =>
      (word === 'checklist'
        ? 'list'
        : word === 'approval'
          ? 'approve'
          : word === 'replacement'
            ? 'replace'
            : word === 'completion'
              ? 'complete'
              : word
      )
        .replace(/(?:ing|ed|s)$/, '')
        .replace(/e$/, ''),
    )
    .filter(Boolean);
}

function conditionTokens(text: string): string[] {
  return tokens(text.replace(/n['’]t\b/gi, '')).filter(
    (word) => !/^(?:not|never|no|do|did)$/.test(word),
  );
}

function normalizeWaitingPrerequisite(text: string): string {
  return text.replace(
    /\b(?:must\s+)?wait\s+until\b/gi,
    (match, offset: number) => {
      const prefix =
        text
          .slice(0, offset)
          .split(/[.!?;\n]/u)
          .at(-1) ?? '';
      return NEGATION.test(prefix) ? match : 'conditional on';
    },
  );
}

function prerequisiteClauses(text: string): string[] {
  return normalizeWaitingPrerequisite(text)
    .split(/(?<!\d)\.|\.(?!\d)|[?!;]/u)
    .flatMap((rawSentence) => {
      // A whole-list status is a separate assertion for semantic review;
      // noun qualifications and additional requirements stay in the prerequisite.
      // shortcut: Extend other relative grammar only with scoped prerequisite controls.
      const sentence = rawSentence.replace(
        /,\s*(?:neither|both|either)\s+of\s+which\s+(?:is|are|was|were)\s+(?:(?:not|yet|still|currently)\s+)*(?:complete|completed|incomplete|done|pending|outstanding)\s*$/iu,
        '',
      );
      const operators = [
        ...sentence.matchAll(new RegExp(CONDITION.source, 'gi')),
      ].filter((operator) => {
        const prefix = sentence.slice(0, operator.index).trim();
        // Embedded uncertainty questions use "if" as "whether", not a prerequisite.
        if (
          operator[0].toLowerCase() === 'if' &&
          /\b(?:(?:am|is|are|was|were)\s+(?:(?:still|currently)\s+)?(?:unsure|uncertain|unclear|not\s+(?:sure|certain|clear))|(?:do|does|did)\s+not\s+know|(?:don['’]t|doesn['’]t|didn['’]t)\s+know|wonders?|wondered)\s*$/i.test(
            prefix,
          )
        )
          return false;
        return !(
          operator[0].toLowerCase() === 'when' &&
          !prefix &&
          /^\s*(?:will|would|can|could|should|is|are|was|were|do|does|did)\b/i.test(
            sentence.slice(operator.index! + operator[0].length),
          )
        );
      });
      return operators.map((operator, index) => {
        const start = operator.index!;
        const end = operators[index + 1]?.index ?? sentence.length;
        let clause = sentence.slice(start, end).trim();
        // A prefix prerequisite ends before its consequent, not at the first
        // comma in a list. Keep preceding comma-qualified evidence intact.
        const consequents = [
          ...clause.matchAll(
            new RegExp(
              `,\\s+(?:(?:[\\p{L}\\p{N}'’-]+\\s+)*(?:will|shall|can|could|may|might|must|should)\\b|(?:${TASK_VERBS})\\b)`,
              'giu',
            ),
          ),
        ];
        const consequent = consequents
          .filter((match) => !/^,\s+(?:which|who|that)\b/i.test(match[0]))
          .at(-1);
        if (consequent && !sentence.slice(0, start).trim())
          clause = clause.slice(0, consequent.index).trim();
        return clause;
      });
    });
}

function conditionIsSupported(expected: string, actual: string): boolean {
  const expectedClauses = prerequisiteClauses(expected);
  const actualClauses = prerequisiteClauses(actual);
  return (
    expectedClauses.length > 0 &&
    expectedClauses.every((condition) =>
      actualClauses.some((evidence) =>
        prerequisiteIsSupported(condition, evidence),
      ),
    )
  );
}

function prerequisiteIsSupported(expected: string, actual: string): boolean {
  let expectedPrerequisite = expected;
  let actualPrerequisite = actual;
  // A self-report can become attributed prose without changing its prerequisite.
  // Align only an otherwise exact consequent; this is not an actor-identity check.
  for (const boundary of actual.matchAll(/,\s+(?:I|we)\s+([^,]+)$/gi)) {
    const consequent = boundary[1]!.trim().toLowerCase();
    const claimBoundary = [
      ...expected.matchAll(/,\s+[^\s,]+\s+([^,]+)$/g),
    ].find((candidate) => candidate[1]!.trim().toLowerCase() === consequent);
    if (claimBoundary) {
      expectedPrerequisite = expected.slice(0, claimBoundary.index);
      actualPrerequisite = actual.slice(0, boundary.index);
      break;
    }
  }
  const expectedOperator = CONDITION.exec(expectedPrerequisite);
  const actualOperator = CONDITION.exec(actualPrerequisite);
  if (!expectedOperator || !actualOperator) return false;
  if (
    /^until$/i.test(expectedOperator[0]) !== /^until$/i.test(actualOperator[0])
  )
    return false;
  const expectedBody = expectedPrerequisite.slice(
    expectedOperator.index + expectedOperator[0].length,
  );
  const actualBody = actualPrerequisite.slice(
    actualOperator.index + actualOperator[0].length,
  );
  const expectedNegative =
    (/^unless$/i.test(expectedOperator[0]) ||
      NEGATION.test(expectedOperator[0])) !== NEGATION.test(expectedBody);
  const actualNegative =
    (/^unless$/i.test(actualOperator[0]) ||
      NEGATION.test(actualOperator[0])) !== NEGATION.test(actualBody);
  if (expectedNegative !== actualNegative) return false;
  const words = new Set(conditionTokens(actualBody));
  return conditionTokens(expectedBody).every((word) => words.has(word));
}

/** A reviewed prerequisite must be supported by this item's exact cited evidence. */
export function hasUnsupportedNotesCondition(
  text: string,
  evidence: string,
): boolean {
  return (
    prerequisiteClauses(text).length > 0 &&
    !conditionIsSupported(text, evidence)
  );
}

/** A named source prerequisite cannot disappear from that same responsibility. */
export function hasOmittedSubjectCondition(
  subject: { text: string; owner: string | null },
  text: string,
  passages: readonly { speaker: string | null; text: string }[],
): boolean {
  const owner = knownOwnerLabel(subject.owner);
  if (!owner) return false;
  const subjectWords = conditionTokens(
    splitCondition(
      canonicalizeActionText(subject.text, subject.owner ?? undefined),
    ).task,
  );
  if (subjectWords.length < 2) return false;
  const scoped = passages.flatMap((passage) =>
    passage.text.split(/(?<!\d)\.|\.(?!\d)|[!;\n]/u).flatMap((clause) => {
      if (/[?"“”]/.test(clause)) return [];
      const { task, condition } = splitCondition(
        normalizeWaitingPrerequisite(clause.trim()),
      );
      const canonical = canonicalizeActionText(
        task,
        subject.owner ?? undefined,
      );
      const explicitOwner = canonical !== canonicalizeActionText(task);
      if (knownOwnerLabel(passage.speaker) !== owner && !explicitOwner)
        return [];
      const words = conditionTokens(canonical);
      const leading = subjectWords.every(
        (word, index) => words[index] === word,
      );
      const clauseWords = conditionTokens(clause);
      const mentioned = clauseWords.some((_, start) =>
        subjectWords.every(
          (word, index) => clauseWords[start + index] === word,
        ),
      );
      if (!leading && !mentioned) return [];
      return [
        {
          condition: leading ? condition : null,
          positive:
            leading &&
            !NEGATION.test(task) &&
            !/[,]|\b(?:and|or|but)\b/i.test(task),
        },
      ];
    }),
  );
  const first = scoped.findIndex(
    (clause) => clause.positive && clause.condition,
  );
  const condition = scoped[first]?.condition;
  if (!condition) return false;
  // A later qualified statement may change this prerequisite. Do not pick an
  // earlier condition or infer a waiver from wording this small check cannot resolve.
  if (
    scoped
      .slice(first + 1)
      .some(
        (clause) =>
          !clause.positive ||
          !clause.condition ||
          !conditionIsSupported(condition, clause.condition) ||
          !conditionIsSupported(clause.condition, condition),
      )
  )
    return false;
  return !conditionIsSupported(condition, text);
}

function taskParts(text: string): { verb: string; objects: string[] } | null {
  const match = new RegExp(`^(${TASK_VERBS})\\s+(.+)`, 'i').exec(text);
  if (!match) return null;
  const objects = tokens(match[2]!);
  if (
    !objects.length ||
    objects.every((word) => /^(?:something|anything|that|it)$/.test(word))
  )
    return null;
  return { verb: match[1]!.toLowerCase(), objects };
}

function matchesTask(
  task: string,
  text: string,
  allowCompression = false,
): boolean {
  // A repeated, explicit recipient can explain why a delivery matters without
  // making that purpose a second task. Preserve every core object/date token
  // and the recipient relation when using this narrowly scoped allowance.
  const purpose =
    /\s+so\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})\s+can\s+(.+?)[.!]?$/iu.exec(
      task,
    );
  const recipientPattern = purpose
    ? new RegExp(
        `\\bto\\s+${purpose[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i',
      )
    : null;
  const scopedPurpose =
    purpose &&
    recipientPattern?.test(task.slice(0, purpose.index)) &&
    !CONDITION.test(purpose[2]!) &&
    !TASK_BOUNDARY.test(purpose[2]!) &&
    !/\bi (?:commit|promise) to\b/i.test(purpose[2]!);
  if (scopedPurpose && !recipientPattern!.test(text)) return false;
  const parts = taskParts(scopedPurpose ? task.slice(0, purpose.index) : task);
  if (!parts) return false;
  const words = new Set(tokens(text));
  // Permit common delivery paraphrases without treating different work on the
  // same object (review vs send) as the same task.
  const verbs = /^(?:send|email|share)$/.test(parts.verb)
    ? ['send', 'email', 'share']
    : [parts.verb];
  const shared = parts.objects.filter((word) => words.has(word)).length;
  return (
    verbs.some((verb) => tokens(verb).every((word) => words.has(word))) &&
    (shared === parts.objects.length ||
      (allowCompression &&
        !scopedPurpose &&
        shared >= 2 &&
        shared / parts.objects.length >= 2 / 3))
  );
}

function overlaps(left: SourceSpan, right: SourceSpan): boolean {
  return (
    left.segment === right.segment &&
    left.start < right.end &&
    right.start < left.end
  );
}

function sentences(
  source: NotesSource,
  allowed?: readonly SourceSpan[],
): Sentence[] {
  const result: Sentence[] = [];
  let order = 0;
  for (const segment of source.segments) {
    // Quotation scope can cross sentence boundaries. Do not turn an inner
    // quotation into a first-person commitment by slicing it out of context.
    const quoted = /["“”]/.test(segment.text);
    for (const match of segment.text.matchAll(/[^.!?\n]+[.!?]?/g)) {
      const text = match[0].trim();
      const start = match.index! + match[0].indexOf(text);
      const span = { segment: segment.index, start, end: start + text.length };
      const sentenceOrder = order++;
      if (
        quoted ||
        !text ||
        (allowed &&
          !allowed.some(
            (window) =>
              window.segment === span.segment &&
              window.start <= span.start &&
              window.end >= span.end,
          ))
      )
        continue;
      result.push({
        text,
        span,
        speaker: segment.speaker,
        order: sentenceOrder,
      });
    }
  }
  return result;
}

function splitCondition(text: string): {
  task: string;
  condition: string | null;
} {
  const condition = CONDITION.exec(text);
  if (!condition) return { task: text, condition: null };
  return {
    task: text.slice(0, condition.index).trim(),
    condition: text.slice(condition.index).trim(),
  };
}

function promise(
  sentence: Sentence,
): { task: string; condition: string | null } | null {
  if (sentence.text.endsWith('?')) return null;
  let text = sentence.text;
  let prefix: string | null = null;
  if (CONDITION.exec(text)?.index === 0) {
    const comma = text.indexOf(',');
    if (comma < 0) return null;
    prefix = text.slice(0, comma);
    text = text.slice(comma + 1).trim();
  }
  const match = PROMISE.exec(text);
  if (!match) return null;
  const parts = splitCondition(match[1]!);
  return { task: parts.task, condition: prefix ?? parts.condition };
}

function candidates(entries: Sentence[]): Candidate[] {
  const result: Candidate[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    let parts = promise(entry);
    let sources = [entry.span];
    const request = /^(?:can|could|would) you (?:please )?(.+)\?$/i.exec(
      entry.text,
    );
    const acceptance = entries[index + 1];
    if (
      request &&
      acceptance &&
      acceptance.order === entry.order + 1 &&
      entry.speaker &&
      acceptance.speaker &&
      entry.speaker !== acceptance.speaker &&
      /^(?:yes|sure|okay)(?:[, ]+(?:i['’]ll|i will) do that)?[.!]?$/i.test(
        acceptance.text,
      )
    ) {
      parts = splitCondition(request[1]!);
      sources = [entry.span, acceptance.span];
    }
    if (!parts) continue;
    // A small source checker cannot reliably associate shared or clause-local
    // prerequisites in compound promises. Abstain for that sentence entirely.
    if (parts.condition && TASK_BOUNDARY.test(entry.text)) continue;
    const tasks = parts.task.split(TASK_BOUNDARY);
    for (const text of tasks) {
      const exactTask = text.replace(/^(?:i['’]ll|i will)\s+/i, '');
      const task = exactTask.replace(DUE_PHRASE, '');
      if (taskParts(task))
        result.push({
          task,
          exactTask,
          condition: parts.condition,
          sources,
          order: acceptance && request ? acceptance.order : entry.order,
          speaker: acceptance && request ? acceptance.speaker : entry.speaker,
        });
    }
  }
  return result;
}

function cancellationTask(text: string, sameSpeaker: boolean): string | null {
  if (text.endsWith('?') || CONDITION.test(text)) return null;
  const clause = text
    .replace(/^actually,\s*/i, 'Actually ')
    .split(/[;,]|\s+(?:and|but)\s+/i)[0]!;
  const ownWithdrawal =
    /^i(?:['’]m| am) withdrawing my (?:earlier )?(?:promise|commitment) to (.+)/i.exec(
      clause,
    );
  if (ownWithdrawal) return sameSpeaker ? ownWithdrawal[1]! : null;
  const direct =
    /^(?:actually[, ]+)?i (?:won['’]t|will not|will no longer)\s+(.+)/i.exec(
      clause,
    );
  if (direct) return sameSpeaker ? direct[1]! : null;
  const ownCommand = /^(?:do not|don['’]t)\s+(.+)/i.exec(clause);
  if (ownCommand) return sameSpeaker ? ownCommand[1]! : null;
  const disposition =
    /^(?:the )?(?:plan|task) to (.+?) (?:is|was|has been) cancel(?:led|ed)[.!]?$/i.exec(
      clause,
    );
  if (disposition) return disposition[1]!;
  const withdrawn =
    /^(?:actually[, ]+)?(?:cancel|drop) (?:the (?:plan|task) to )?(.+)/i.exec(
      clause,
    );
  return withdrawn?.[1] ?? null;
}

function cancels(
  entry: Sentence,
  candidate: Candidate,
  all: Candidate[],
): boolean {
  const sameSpeaker =
    candidate.speaker !== null && entry.speaker === candidate.speaker;
  if (
    matchesTask(candidate.task, cancellationTask(entry.text, sameSpeaker) ?? '')
  )
    return true;
  if (!sameSpeaker) return false;
  const withdrawal =
    /^(?:i take back my (?:earlier )?|i(?:['’]m| am) withdrawing my |i withdraw (?:my )?(?:earlier )?)(.+?) (?:commitment|promise)[.;!]/i.exec(
      entry.text,
    );
  if (!withdrawal) return false;
  const identity = tokens(withdrawal[1]!);
  if (!identity.length) return false;
  const linked = all.filter(
    (other) =>
      other.order < entry.order &&
      other.speaker === entry.speaker &&
      identity.every((word) => tokens(other.exactTask).includes(word)),
  );
  // A noun-only reference cannot choose between multiple tasks on that object.
  return (
    linked.includes(candidate) &&
    new Set(linked.map((other) => tokens(other.task).join(' '))).size === 1
  );
}

function completes(entry: Sentence, candidate: Candidate): boolean {
  if (
    !candidate.speaker ||
    entry.speaker !== candidate.speaker ||
    entry.text.endsWith('?') ||
    /\b(?:but|and)\s+i(?:['’]ll| will| need to| must)\b/i.test(entry.text)
  )
    return false;
  const match = COMPLETED_PROMISE.exec(entry.text);
  if (
    !match ||
    CONDITION.test(match[1]!.replace(/^\S+\s+/, '')) ||
    (/^rerun\b/i.test(match[1]!) &&
      !/^i(?:['’]ve| have| already)\b/i.test(entry.text))
  )
    return false;
  const task = match[1]!
    .split(/[;,]|\s+(?:and|but)\s+/i)[0]!
    .replace(/^sent\b/i, 'send')
    .replace(/^written\b/i, 'write');
  return matchesTask(candidate.task, task);
}

function requiresWithdrawalContext(
  entry: Sentence,
  candidate: Candidate,
): boolean {
  if (!candidate.speaker || entry.speaker !== candidate.speaker) return false;
  const clause = entry.text.split(/[;,]|\s+(?:and|but)\s+/i)[0]!;
  const explicitTask =
    /^i(?:['’]m| am) withdrawing my (?:earlier )?(?:promise|commitment) to (.+)/i.exec(
      clause,
    );
  if (explicitTask) {
    // Existing cancellation detection is one-way; a narrower recipient or date
    // must not introduce a new requirement to narrate a whole-task withdrawal.
    return matchesTask(explicitTask[1]!, candidate.task);
  }
  // The caller already proved this noun-only withdrawal identifies one prior
  // task of the same speaker. Do not extend this to ambiguous "will not" text.
  return /^(?:i take back my (?:earlier )?|i(?:['’]m| am) withdrawing my |i withdraw (?:my )?(?:earlier )?)(.+?) (?:commitment|promise)[.;!]/i.test(
    entry.text,
  );
}

export function createNotesGuardrailChecker(
  source: NotesSource,
  allowedSpans?: readonly SourceSpan[],
) {
  const entries = sentences(source, allowedSpans);
  const sourceCandidates = candidates(entries);
  // Exact repeats may cite either occurrence. Keep deadlines and recipients in
  // this identity, and never share evidence across a cancellation/renewal.
  const repeatedSources = new Map<Candidate, SourceSpan[]>();
  const previousRepeats = new Map<string, Candidate>();
  for (const candidate of sourceCandidates) {
    const key = JSON.stringify([
      candidate.speaker,
      candidate.exactTask,
      candidate.condition,
    ]);
    const previous = candidate.speaker ? previousRepeats.get(key) : undefined;
    const sources =
      previous &&
      !entries.some(
        (entry) =>
          entry.order > previous.order &&
          entry.order < candidate.order &&
          (cancels(entry, previous, sourceCandidates) ||
            completes(entry, previous)),
      )
        ? repeatedSources.get(previous)!
        : [];
    sources.push(...candidate.sources);
    repeatedSources.set(candidate, sources);
    previousRepeats.set(key, candidate);
  }
  return (
    draft: NotesDraft,
    diagnosticCodes?: readonly NotesGuardrailIssue['code'][],
  ): NotesGuardrailIssue[] => {
    const actions = draft.sections
      .flatMap((section) => section.items)
      .filter((item) => item.kind === 'action');
    const context = [
      ...(draft.overview ? [draft.overview] : []),
      ...draft.sections.flatMap((section) =>
        section.items.filter(
          (item) => item.kind === 'point' || item.kind === 'decision',
        ),
      ),
    ];
    const issues = new Map<string, NotesGuardrailIssue>();
    for (const candidate of sourceCandidates) {
      const candidateOwner = knownOwnerLabel(candidate.speaker);
      const matching = actions.flatMap((item) => {
        const itemOwner = knownOwnerLabel(item.owner);
        if (
          candidateOwner &&
          itemOwner &&
          candidateOwner !== itemOwner &&
          !buildCitedSpeakerAliasProof(source, item.sources).some(
            (alias) =>
              knownOwnerLabel(alias.speaker) === candidateOwner &&
              knownOwnerLabel(alias.name) === itemOwner,
          )
        )
          return [];
        return repeatedSources
          .get(candidate)!
          .some((span) => item.sources.some((ref) => overlaps(span, ref)))
          ? item.text
              .split(TASK_BOUNDARY)
              .filter((clause) =>
                matchesTask(
                  candidate.task,
                  `${clause} ${item.due ?? ''}`,
                  true,
                ),
              )
          : [];
      });
      const cancellation = entries.find(
        (entry) =>
          entry.order > candidate.order &&
          cancels(entry, candidate, sourceCandidates),
      );
      const completion = entries.find(
        (entry) => entry.order > candidate.order && completes(entry, candidate),
      );
      const resolution = cancellation ?? completion;
      // A later explicit renewal is authoritative for the same speaking owner
      // and task. An unrelated promise cannot reactivate cancelled work.
      if (
        resolution &&
        sourceCandidates.some(
          (later) =>
            later.order > resolution.order &&
            later.speaker === candidate.speaker &&
            matchesTask(candidate.task, later.task) &&
            matchesTask(later.task, candidate.task),
        )
      )
        continue;
      let code: NotesGuardrailIssue['code'] | null = null;
      if (resolution) {
        if (matching.length) code = 'conflicting_action';
        else if (
          cancellation &&
          requiresWithdrawalContext(cancellation, candidate) &&
          !context.some(
            (block) =>
              block.sources.some((span) => overlaps(span, cancellation.span)) ||
              (/\b(?:withdraw|retract|cancel|take[n]? back|no longer|replac|supersed)\w*\b/i.test(
                block.text,
              ) &&
                actions.some((action) =>
                  action.sources.some((span) =>
                    overlaps(span, cancellation.span),
                  ),
                )),
          )
        ) {
          // Coverage diagnostic only: citations do not prove the wording or the
          // reason is faithful. The source audit and semantic acceptance still do.
          code = 'missing_cancellation_context';
        }
      } else if (!matching.length) {
        code = 'missing_action';
      } else if (
        candidate.condition &&
        !matching.some((clause) =>
          conditionIsSupported(candidate.condition!, clause),
        )
      ) {
        code = 'missing_condition';
      }
      // Filter before the bounded diagnostic collection: omission warnings must
      // not hide a later unsafe action when checking an individual commitment.
      if (code && (!diagnosticCodes || diagnosticCodes.includes(code))) {
        const sources = [
          ...candidate.sources,
          ...(resolution ? [resolution.span] : []),
        ].map((span) => ({ ...span }));
        const issue = { code, sources };
        issues.set(JSON.stringify(issue), issue);
        if (issues.size >= 32) break;
      }
    }
    return [...issues.values()];
  };
}

export function findNotesGuardrailIssues(
  source: NotesSource,
  draft: NotesDraft,
  allowedSpans?: readonly SourceSpan[],
  diagnosticCodes?: readonly NotesGuardrailIssue['code'][],
): NotesGuardrailIssue[] {
  return createNotesGuardrailChecker(source, allowedSpans)(
    draft,
    diagnosticCodes,
  );
}
