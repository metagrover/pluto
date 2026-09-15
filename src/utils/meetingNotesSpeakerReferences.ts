import type { AnalysisDocumentV3 } from '../types';
import { parseTranscriptSegments } from './transcript';

export interface MeetingNotesSpeakerReference {
  speaker: string;
  sourceName: string;
  start: number;
  end: number;
}

export interface MeetingNotesSpeakerReferences {
  schema_version: 1;
  blocks: Record<string, MeetingNotesSpeakerReference[]>;
}

const textAtPath = (
  analysis: AnalysisDocumentV3,
  path: string,
): string | null => {
  if (path === 'title') return analysis.title ?? null;
  if (path === 'overview') return analysis.overview;
  if (path === 'recent_win:win') return analysis.recent_win?.win ?? null;
  if (path === 'recent_win:why_it_counts')
    return analysis.recent_win?.why_it_counts ?? null;
  const attribution = path.match(
    /^all_(decisions|action_items):(\d+):(decided_by|assignee)$/u,
  );
  if (attribution) {
    const index = Number(attribution[2]);
    return attribution[1] === 'decisions'
      ? (analysis.all_decisions[index]?.decided_by ?? null)
      : (analysis.all_action_items[index]?.assignee ?? null);
  }

  const match = path.match(
    /^(?:topic:(\d+):(title|summary|point|question)(?::(\d+))?|all_(decisions|action_items):(\d+))$/u,
  );
  if (!match) return null;
  if (match[4]) {
    const index = Number(match[5]);
    return match[4] === 'decisions'
      ? (analysis.all_decisions[index]?.text ?? null)
      : (analysis.all_action_items[index]?.text ?? null);
  }
  const topic = analysis.topics[Number(match[1])];
  if (!topic) return null;
  if (match[2] === 'title') return topic.title;
  if (match[2] === 'summary') return topic.summary;
  const index = Number(match[3]);
  return match[2] === 'point'
    ? (topic.key_points[index]?.text ?? null)
    : (topic.open_questions[index] ?? null);
};

const replaceTextAtPath = (
  analysis: AnalysisDocumentV3,
  path: string,
  text: string,
): void => {
  if (path === 'title') analysis.title = text;
  else if (path === 'overview') analysis.overview = text;
  else if (path === 'recent_win:win' && analysis.recent_win)
    analysis.recent_win.win = text;
  else if (path === 'recent_win:why_it_counts' && analysis.recent_win)
    analysis.recent_win.why_it_counts = text;
  else {
    const attribution = path.match(
      /^all_(decisions|action_items):(\d+):(decided_by|assignee)$/u,
    );
    if (attribution) {
      const index = Number(attribution[2]);
      if (attribution[1] === 'decisions') {
        const decision = analysis.all_decisions[index];
        if (decision) decision.decided_by = text;
      } else {
        const action = analysis.all_action_items[index];
        if (action) action.assignee = text;
      }
      return;
    }
    const match = path.match(
      /^(?:topic:(\d+):(title|summary|point|question)(?::(\d+))?|all_(decisions|action_items):(\d+))$/u,
    );
    if (!match) return;
    if (match[4]) {
      const item =
        match[4] === 'decisions'
          ? analysis.all_decisions[Number(match[5])]
          : analysis.all_action_items[Number(match[5])];
      if (item) item.text = text;
      return;
    }
    const topic = analysis.topics[Number(match[1])];
    if (!topic) return;
    if (match[2] === 'title') topic.title = text;
    else if (match[2] === 'summary') topic.summary = text;
    else if (match[2] === 'point') {
      const point = topic.key_points[Number(match[3])];
      if (point) point.text = text;
    } else if (match[2] === 'question') {
      const index = Number(match[3]);
      if (topic.open_questions[index] !== undefined)
        topic.open_questions[index] = text;
    }
  }
};

const isAttributionUse = (
  text: string,
  start: number,
  end: number,
): boolean => {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const sentenceStart = start === 0 || /[.!?]\s+$/u.test(before);
  const possessive = /^(?:['’]s)\b/u.test(after);
  const attributionLabel = /^\s*[:—]/u.test(after);
  const subjectVerb =
    /^\s+(?:is|was|has|had|will|would|can|could|should|said|says|noted|shared|explained|described|confirmed|asked|suggested|recommended|decided|agreed|expects?|intends?|wants?|needs?|owns?|leads?|works?|continues?|remains?)\b/iu.test(
      after,
    );
  return possessive || attributionLabel || (sentenceStart && subjectVerb);
};

export const buildMeetingNotesSpeakerReferences = (input: {
  analysis: AnalysisDocumentV3;
  transcriptJson: string;
  speakerDisplayNames: Readonly<Record<string, string>>;
}): MeetingNotesSpeakerReferences | undefined => {
  const segments = parseTranscriptSegments(input.transcriptJson);
  const provenance = input.analysis.generation_metadata?.source_provenance;
  if (!provenance) return undefined;
  const blocks: Record<string, MeetingNotesSpeakerReference[]> = {};

  for (const [path, sourceBlock] of Object.entries(provenance.blocks)) {
    const text = textAtPath(input.analysis, path);
    if (!text) continue;
    const speakers = new Set(
      sourceBlock.sources
        .map(({ segment }) => String(segments[segment]?.speaker ?? '').trim())
        .filter(Boolean),
    );
    if (speakers.size !== 1) continue;
    const speaker = speakers.values().next().value as string;
    const sourceName = input.speakerDisplayNames[speaker]?.trim() || speaker;
    if (!sourceName) continue;

    const references: MeetingNotesSpeakerReference[] = [];
    const lowerText = text.toLowerCase();
    const lowerSourceName = sourceName.toLowerCase();
    let offset = 0;
    while (offset < text.length) {
      let start = text.indexOf(sourceName, offset);
      const matchLen = sourceName.length;
      if (start < 0 && sourceName === speaker) {
        start = lowerText.indexOf(lowerSourceName, offset);
      }
      if (start < 0) break;
      const actualSourceName = text.slice(start, start + matchLen);
      const end = start + matchLen;
      if (isAttributionUse(text, start, end)) {
        references.push({ speaker, sourceName: actualSourceName, start, end });
      }
      offset = end;
    }
    if (references.length > 0) blocks[path] = references.slice(0, 16);

    const structuredPath = path.startsWith('all_decisions:')
      ? `${path}:decided_by`
      : path.startsWith('all_action_items:')
        ? `${path}:assignee`
        : null;
    const structuredName = structuredPath
      ? textAtPath(input.analysis, structuredPath)
      : null;
    if (
      structuredPath &&
      structuredName &&
      (structuredName === sourceName ||
        (sourceName === speaker &&
          structuredName.toLowerCase() === lowerSourceName))
    ) {
      blocks[structuredPath] = [
        {
          speaker,
          sourceName: structuredName,
          start: 0,
          end: structuredName.length,
        },
      ];
    }
  }

  return Object.keys(blocks).length > 0
    ? { schema_version: 1, blocks }
    : undefined;
};

const unresolvedSpeakerName = (speaker: string): string => {
  if (speaker === 'Me') return 'Local speaker';
  if (speaker === 'Them') return 'The other participant';
  const numbered = speaker.match(/^(?:Remote\s+)?Speaker\s+(\d+)$/iu);
  return numbered ? `Remote speaker ${numbered[1]}` : speaker;
};

export const projectMeetingNotesSpeakerReferences = (
  analysis: AnalysisDocumentV3,
  speakerDisplayNames: Readonly<Record<string, string>>,
): AnalysisDocumentV3 => {
  const artifact = analysis.generation_metadata?.speaker_references;
  if (
    !artifact ||
    artifact.schema_version !== 1 ||
    !artifact.blocks ||
    typeof artifact.blocks !== 'object' ||
    Array.isArray(artifact.blocks)
  ) {
    return analysis;
  }
  const projected = structuredClone(analysis);
  for (const [path, references] of Object.entries(artifact.blocks).slice(
    0,
    256,
  )) {
    const original = textAtPath(projected, path);
    if (!original || !Array.isArray(references)) continue;
    let text = original;
    for (const reference of [...references].sort((a, b) => b.start - a.start)) {
      if (
        !reference ||
        typeof reference.speaker !== 'string' ||
        typeof reference.sourceName !== 'string' ||
        !Number.isSafeInteger(reference.start) ||
        !Number.isSafeInteger(reference.end) ||
        reference.start < 0 ||
        reference.end <= reference.start ||
        text.slice(reference.start, reference.end) !== reference.sourceName
      ) {
        continue;
      }
      const displayName =
        speakerDisplayNames[reference.speaker]?.trim() ||
        unresolvedSpeakerName(reference.speaker);
      text = `${text.slice(0, reference.start)}${displayName}${text.slice(reference.end)}`;
    }
    replaceTextAtPath(projected, path, text);
  }
  return projected;
};
