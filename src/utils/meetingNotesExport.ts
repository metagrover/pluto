import type { MeetingCalendarContext } from '../../electron/calendar/types';
import type { Meeting, TranscriptSegment } from '../types';
import type {
  MeetingNotesBlock,
  MeetingNotesDocumentModel,
  MeetingNotesSection,
} from './meetingNotesDocument';
import { meetingTimestamp } from './meetingOrdering';

export interface MeetingNotesExportOptions {
  meeting: Meeting;
  documentModel: MeetingNotesDocumentModel;
  calendarContext?: MeetingCalendarContext | null;
  transcriptSegments?: TranscriptSegment[];
}

/**
 * Builds a clean, sanitized filename for exporting meeting notes.
 * Format: [sanitized-title]-[YYYY-MM-DD].md
 * Falls back to pluto-session-[id]-[YYYY-MM-DD].md if title is missing or only special characters.
 */
export function buildMeetingExportFilename(
  title: string,
  dateValue: string | number | Date,
  meetingId: string | number,
): string {
  const dateObj = new Date(dateValue);
  const dateStr = !Number.isNaN(dateObj.getTime())
    ? dateObj.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const cleanSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const maxSlugLength = 50;
  const truncatedSlug =
    cleanSlug.length > maxSlugLength
      ? cleanSlug.slice(0, maxSlugLength).replace(/-+$/, '')
      : cleanSlug;

  const baseName = truncatedSlug || `pluto-session-${meetingId}`;
  return `${baseName}-${dateStr}.md`;
}

function formatOutcomeBlock(block: MeetingNotesBlock): string {
  const check = block.completed ? '[x]' : '[ ]';
  const metaParts: string[] = [];

  if (block.blockType === 'decision' && block.speaker) {
    metaParts.push(`Decided by: ${block.speaker}`);
  } else if (block.blockType === 'action') {
    if (block.assignee) metaParts.push(`Assignee: ${block.assignee}`);
    if (block.due) metaParts.push(`Due: ${block.due}`);
  }

  const metaStr = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : '';
  return `- ${check} ${block.text}${metaStr}`;
}

function formatSectionBlocks(section: MeetingNotesSection): string[] {
  const lines: string[] = [];

  for (const block of section.blocks) {
    if (section.kind === 'outcomes') {
      lines.push(formatOutcomeBlock(block));
    } else if (section.kind === 'current_read') {
      lines.push(block.text);
      lines.push('');
    } else if (section.kind === 'open_questions') {
      lines.push(`- ${block.text}`);
    } else {
      // Discussion / topic sections
      const isSummary =
        block.id.endsWith('-summary') || block.id.includes('summary');
      if (isSummary) {
        lines.push(block.text);
        lines.push('');
      } else {
        const prefix = block.speaker ? `- ${block.speaker}: ` : '- ';
        lines.push(`${prefix}${block.text}`);
      }
    }
  }

  return lines;
}

/**
 * Transforms a meeting and its structured notes document model into clean,
 * portable Markdown, complete with calendar context, attendees, and user edits,
 * while excluding raw transcript JSON or debug metadata.
 */
export function formatMeetingNotesAsMarkdown({
  meeting,
  documentModel,
  calendarContext,
  transcriptSegments,
}: MeetingNotesExportOptions): string {
  const lines: string[] = [];

  // Title
  const title = meeting.title?.trim() || 'Untitled Session';
  lines.push(`# ${title}`);
  lines.push('');

  // Metadata block
  const timestamp = meetingTimestamp(meeting);
  const formattedDate = new Date(timestamp).toLocaleString([], {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  lines.push(`- **Date:** ${formattedDate}`);

  if (typeof meeting.duration_seconds === 'number') {
    const duration =
      meeting.duration_seconds < 60
        ? '< 1 min'
        : `${Math.floor(meeting.duration_seconds / 60)} min`;
    lines.push(`- **Duration:** ${duration}`);
  }

  if (calendarContext?.event) {
    const eventTitle = calendarContext.event.title?.trim();
    const calendarTitle = calendarContext.calendarTitle?.trim();
    if (eventTitle) {
      lines.push(
        `- **Calendar Event:** ${eventTitle}${calendarTitle ? ` (${calendarTitle})` : ''}`,
      );
    }

    if (calendarContext.event.organizer) {
      const { name, email } = calendarContext.event.organizer;
      const orgStr = name && email ? `${name} <${email}>` : name || email;
      if (orgStr) {
        lines.push(`- **Organizer:** ${orgStr}`);
      }
    }

    if (
      Array.isArray(calendarContext.event.attendees) &&
      calendarContext.event.attendees.length > 0
    ) {
      const attendees: string[] = [];
      const seen = new Set<string>();

      for (const attendee of calendarContext.event.attendees) {
        const identifier = attendee.name || attendee.email;
        if (!identifier || seen.has(identifier)) continue;
        seen.add(identifier);
        attendees.push(identifier);
      }

      if (attendees.length > 0) {
        lines.push(`- **Attendees:** ${attendees.join(', ')}`);
      }
    }
  } else if (transcriptSegments && transcriptSegments.length > 0) {
    const speakers = Array.from(
      new Set(
        transcriptSegments
          .map((segment) => String(segment.speaker || '').trim())
          .filter(
            (speaker) =>
              Boolean(speaker) && speaker.toLowerCase() !== 'unknown',
          ),
      ),
    );

    if (speakers.length > 0) {
      lines.push(`- **Participants:** ${speakers.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // Fallback for unanalyzed meetings (no enhanced notes model)
  if (!documentModel.hasAnalysis) {
    const scratchpad = documentModel.sections.find(
      (section) => section.kind === 'scratchpad',
    );
    const content =
      scratchpad?.blocks.map((block) => block.text).join('\n\n') ||
      meeting.user_notes?.trim() ||
      'No notes recorded.';
    lines.push(content);
    return lines.join('\n').trimEnd();
  }

  // Structured sections
  for (const section of documentModel.sections) {
    // When analysis exists, user notes have been synthesized into topic points
    // and inline continuation rows, so omit standalone scratchpad section.
    if (section.kind === 'scratchpad') continue;
    if (section.blocks.length === 0) continue;

    lines.push(`## ${section.title}`);
    lines.push('');

    const sectionLines = formatSectionBlocks(section);
    lines.push(...sectionLines);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
