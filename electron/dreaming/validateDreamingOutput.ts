import type {
  DreamingCommitmentProposal,
  DreamingInputPackage,
  DreamingMilestoneProposal,
  PersonDreamingOutput,
  ProjectDreamingOutput,
} from './types';

export const generateItemFingerprint = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const cleanJson = (raw: string): string => {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
};

export const validateProjectDreamingOutput = (
  raw: string,
  pkg: DreamingInputPackage,
): ProjectDreamingOutput | null => {
  try {
    const cleaned = cleanJson(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const validMeetingIds = new Set(
      pkg.recentMeetingNotes.map((n) => n.meetingId),
    );
    const negativeSet = new Set(
      pkg.negativeConstraints.map((c) => c.toLowerCase().trim()),
    );

    const status = parsed.status === 'updated' ? 'updated' : 'no_change';
    const dossier_summary =
      typeof parsed.dossier_summary === 'string'
        ? parsed.dossier_summary.trim()
        : undefined;

    const milestones: DreamingMilestoneProposal[] = [];
    if (Array.isArray(parsed.milestones)) {
      for (const m of parsed.milestones) {
        if (!m || typeof m !== 'object') continue;
        const name = typeof m.name === 'string' ? m.name.trim() : '';
        const source_meeting_id =
          typeof m.source_meeting_id === 'string'
            ? m.source_meeting_id.trim()
            : '';
        const evidence_snippet =
          typeof m.evidence_snippet === 'string'
            ? m.evidence_snippet.trim()
            : '';
        const rawStatus = m.status;
        const milestoneStatus =
          rawStatus === 'completed' ||
          rawStatus === 'in_progress' ||
          rawStatus === 'planned'
            ? rawStatus
            : 'in_progress';

        if (!name || !source_meeting_id) continue;
        if (!validMeetingIds.has(source_meeting_id)) continue;

        const fingerprint = generateItemFingerprint(name);
        if (negativeSet.has(fingerprint)) continue;

        milestones.push({
          name,
          status: milestoneStatus,
          source_meeting_id,
          evidence_snippet,
        });
      }
    }

    const associated_commitments: DreamingCommitmentProposal[] = [];
    if (Array.isArray(parsed.associated_commitments)) {
      for (const c of parsed.associated_commitments) {
        if (!c || typeof c !== 'object') continue;
        const task = typeof c.task === 'string' ? c.task.trim() : '';
        const owner_name =
          typeof c.owner_name === 'string' ? c.owner_name.trim() : '';
        const source_meeting_id =
          typeof c.source_meeting_id === 'string'
            ? c.source_meeting_id.trim()
            : '';

        if (!task || !source_meeting_id) continue;
        if (!validMeetingIds.has(source_meeting_id)) continue;

        const fingerprint = generateItemFingerprint(task);
        if (negativeSet.has(fingerprint)) continue;

        associated_commitments.push({
          task,
          owner_name,
          source_meeting_id,
        });
      }
    }

    const suggested_aliases: string[] = [];
    if (Array.isArray(parsed.suggested_aliases)) {
      for (const a of parsed.suggested_aliases) {
        if (typeof a === 'string' && a.trim() && a.trim() !== pkg.entityName) {
          const aliasName = a.trim();
          const fp = generateItemFingerprint(aliasName);
          if (!negativeSet.has(fp) && !suggested_aliases.includes(aliasName)) {
            suggested_aliases.push(aliasName);
          }
        }
      }
    }

    return {
      status,
      dossier_summary,
      milestones,
      associated_commitments,
      suggested_aliases,
    };
  } catch {
    return null;
  }
};

export const validatePersonDreamingOutput = (
  raw: string,
  pkg: DreamingInputPackage,
): PersonDreamingOutput | null => {
  try {
    const cleaned = cleanJson(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const negativeSet = new Set(
      pkg.negativeConstraints.map((c) => c.toLowerCase().trim()),
    );

    const status = parsed.status === 'updated' ? 'updated' : 'no_change';
    const headline =
      typeof parsed.headline === 'string' ? parsed.headline.trim() : undefined;
    const current_focus =
      typeof parsed.current_focus === 'string'
        ? parsed.current_focus.trim()
        : undefined;

    const recent_collaborators: string[] = [];
    if (Array.isArray(parsed.recent_collaborators)) {
      for (const c of parsed.recent_collaborators) {
        if (
          typeof c === 'string' &&
          c.trim() &&
          !recent_collaborators.includes(c.trim())
        ) {
          recent_collaborators.push(c.trim());
        }
      }
    }

    const suggested_aliases: string[] = [];
    if (Array.isArray(parsed.suggested_aliases)) {
      for (const a of parsed.suggested_aliases) {
        if (typeof a === 'string' && a.trim() && a.trim() !== pkg.entityName) {
          const aliasName = a.trim();
          const fp = generateItemFingerprint(aliasName);
          if (!negativeSet.has(fp) && !suggested_aliases.includes(aliasName)) {
            suggested_aliases.push(aliasName);
          }
        }
      }
    }

    return {
      status,
      headline,
      current_focus,
      recent_collaborators,
      suggested_aliases,
    };
  } catch {
    return null;
  }
};
