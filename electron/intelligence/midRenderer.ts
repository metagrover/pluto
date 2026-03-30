/**
 * MID Renderer
 *
 * On-demand rendering of MidFrontmatter → Markdown.
 * Used for display purposes only — the Markdown is never stored.
 */

import type { MidFrontmatter } from './intelligenceTypes';

/**
 * Render a MidFrontmatter object as human-readable Markdown.
 * Omits empty sections rather than rendering "None" placeholders.
 */
export function renderMidToMarkdown(mid: MidFrontmatter): string {
  const sections: string[] = [];

  // --- Summary header with metadata ---
  const dateLine = mid.occurred_at
    ? `*${new Date(mid.occurred_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}*`
    : '';
  const durationLine =
    mid.duration_seconds > 0
      ? `*Duration: ${formatDuration(mid.duration_seconds)}*`
      : '';
  const metaLine = [dateLine, durationLine].filter(Boolean).join(' · ');

  sections.push(`## ${mid.title}`);
  if (metaLine) sections.push(metaLine);

  // --- Participants ---
  if (mid.participants.length > 0) {
    const names = mid.participants
      .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
      .join(', ');
    sections.push(`\n**Participants:** ${names}`);
  }

  // --- Projects ---
  if (mid.projects.length > 0) {
    const names = mid.projects.map((p) => p.name).join(', ');
    sections.push(`**Projects:** ${names}`);
  }

  // --- Topics ---
  if (mid.topics.length > 0) {
    sections.push('\n## Key Topics');
    for (const topic of mid.topics) {
      const badge =
        topic.importance === 'high'
          ? ' 🔴'
          : topic.importance === 'medium'
            ? ' 🟡'
            : '';
      sections.push(`- ${topic.name}${badge}`);
    }
  }

  // --- Action Items ---
  if (mid.action_items.length > 0) {
    sections.push('\n## Action Items');
    for (const item of mid.action_items) {
      const checkbox = item.status === 'completed' ? '[x]' : '[ ]';
      const assignee = item.assignee ? ` *(${item.assignee})*` : '';
      const due = item.due_date
        ? ` — due ${formatDate(item.due_date)}`
        : '';
      sections.push(`- ${checkbox} ${item.description}${assignee}${due}`);
    }
  }

  // --- Decisions ---
  if (mid.decisions.length > 0) {
    sections.push('\n## Decisions');
    for (const decision of mid.decisions) {
      sections.push(`- **${decision.description}**`);
      if (decision.rationale) {
        sections.push(`  *Rationale: ${decision.rationale}*`);
      }
    }
  }

  // --- Signals ---
  const hasSignals =
    mid.signals.continuity.length > 0 ||
    mid.signals.accountability_risks.length > 0 ||
    mid.signals.decision_impacts.length > 0;

  if (hasSignals) {
    sections.push('\n## Signals');
    if (mid.signals.continuity.length > 0) {
      sections.push('**Continuity:**');
      for (const s of mid.signals.continuity) sections.push(`- ${s}`);
    }
    if (mid.signals.accountability_risks.length > 0) {
      sections.push('**Accountability Risks:**');
      for (const s of mid.signals.accountability_risks)
        sections.push(`- ⚠️ ${s}`);
    }
    if (mid.signals.decision_impacts.length > 0) {
      sections.push('**Decision Impacts:**');
      for (const s of mid.signals.decision_impacts) sections.push(`- ${s}`);
    }
  }

  return sections.join('\n');
}

// =============================================
// Helpers
// =============================================

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
