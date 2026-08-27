import type { NotesDraft, NotesSource, SourceSpan } from './meetingNotesTypes';

export type NotesGuardrailIssue = {
  code: 'missing_action' | 'missing_condition' | 'conflicting_action';
  sources: SourceSpan[];
};

// Deliberately small: these checks are a repair signal, not an action extractor.
// State, intention, reported speech, and ambiguous task identity must abstain.
const TASK_VERBS =
  'send|email|share|review|update|prepare|write|draft|create|check|book|schedule|publish|upload|finish|replace';
const TASK_BOUNDARY = new RegExp(
  `\\s+and\\s+(?=(?:(?:i['’]ll|i will)\\s+)?(?:${TASK_VERBS})\\b)`,
  'i',
);
const PROMISE =
  /^(?:yes[, ]+|okay[, ]+|sure[, ]+)?(?:i['’]ll|i will|i commit to)\s+(.+)$/i;
const CONDITION =
  /\b(?:only if|if|unless|until|once|after|when|provided(?: that)?|pending|subject to|conditional on|contingent (?:on|upon))\b/i;
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

type Sentence = {
  text: string;
  span: SourceSpan;
  speaker: string | null;
  order: number;
};
type Candidate = {
  task: string;
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
            : word
      )
        .replace(/(?:ing|ed|s)$/, '')
        .replace(/e$/, ''),
    );
}

function conditionTokens(text: string): string[] {
  return tokens(text.replace(/n['’]t\b/gi, '')).filter(
    (word) => !/^(?:not|never|no|do|did)$/.test(word),
  );
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
  const parts = taskParts(task);
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
      const task = text
        .replace(/^(?:i['’]ll|i will)\s+/i, '')
        .replace(DUE_PHRASE, '');
      if (taskParts(task))
        result.push({
          task,
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
    /^(?:i take back my (?:earlier )?|i(?:['’]m| am) withdrawing my )(.+?) (?:commitment|promise)[.;!]/i.exec(
      entry.text,
    );
  if (!withdrawal) return false;
  const identity = tokens(withdrawal[1]!);
  if (!identity.length) return false;
  const linked = all.filter(
    (other) =>
      other.order < entry.order &&
      other.speaker === entry.speaker &&
      identity.every((word) => tokens(other.task).includes(word)),
  );
  // A noun-only reference cannot choose between multiple tasks on that object.
  return (
    linked.includes(candidate) &&
    new Set(linked.map((other) => tokens(other.task).join(' '))).size === 1
  );
}

export function findNotesGuardrailIssues(
  source: NotesSource,
  draft: NotesDraft,
  allowedSpans?: readonly SourceSpan[],
): NotesGuardrailIssue[] {
  const entries = sentences(source, allowedSpans);
  const actions = draft.sections
    .flatMap((section) => section.items)
    .filter((item) => item.kind === 'action');
  const issues = new Map<string, NotesGuardrailIssue>();
  const sourceCandidates = candidates(entries);
  for (const candidate of sourceCandidates) {
    const matching = actions.flatMap((item) =>
      candidate.sources.some((span) =>
        item.sources.some((ref) => overlaps(span, ref)),
      )
        ? item.text
            .split(TASK_BOUNDARY)
            .filter((clause) =>
              matchesTask(candidate.task, `${clause} ${item.due ?? ''}`, true),
            )
        : [],
    );
    const cancellation = entries.find(
      (entry) =>
        entry.order > candidate.order &&
        cancels(entry, candidate, sourceCandidates),
    );
    // A later explicit renewal is authoritative for the same speaking owner
    // and task. An unrelated promise cannot reactivate cancelled work.
    if (
      cancellation &&
      sourceCandidates.some(
        (later) =>
          later.order > cancellation.order &&
          later.speaker === candidate.speaker &&
          matchesTask(candidate.task, later.task) &&
          matchesTask(later.task, candidate.task),
      )
    )
      continue;
    let code: NotesGuardrailIssue['code'] | null = null;
    if (cancellation) {
      if (matching.length) code = 'conflicting_action';
    } else if (!matching.length) {
      code = 'missing_action';
    } else if (
      candidate.condition &&
      !matching.some((clause) => {
        const condition = CONDITION.exec(clause);
        if (!condition) return false;
        const expectedOperator = CONDITION.exec(candidate.condition!)![0];
        const expectedBody = candidate.condition!.replace(CONDITION, '');
        const actualBody = clause.slice(condition.index + condition[0].length);
        const expectedNegative =
          /^unless$/i.test(expectedOperator) !== NEGATION.test(expectedBody);
        const actualNegative =
          /^unless$/i.test(condition[0]) !== NEGATION.test(actualBody);
        if (expectedNegative !== actualNegative) return false;
        const words = new Set(conditionTokens(actualBody));
        return conditionTokens(expectedBody).every((word) => words.has(word));
      })
    ) {
      code = 'missing_condition';
    }
    if (code) {
      const sources = [
        ...candidate.sources,
        ...(cancellation ? [cancellation.span] : []),
      ].map((span) => ({ ...span }));
      const issue = { code, sources };
      issues.set(JSON.stringify(issue), issue);
      if (issues.size >= 32) break;
    }
  }
  return [...issues.values()];
}
