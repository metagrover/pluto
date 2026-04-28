/**
 * Suggested Queries Engine
 *
 * Generates context-aware sample questions for the Ask Pluto interface,
 * grounded in the user's actual meeting data. Prioritized by actionability
 * signals and diversified across categories.
 *
 * Data sources (in priority order):
 *   1. mid_json   — MID frontmatter (participants, topics, decisions, action items)
 *   2. analysis_json — v3 analysis schema (topics, all_action_items, all_decisions)
 *   3. Meeting title + metadata — always available as a last resort
 */

import * as db from '../db';
import type { MidFrontmatter } from './intelligenceTypes';

// =============================================
// Helpers
// =============================================

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength).trim() + '…';
}

function pickRandom<T>(array: T[]): T | null {
  if (array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Returns a human-friendly relative time label for a meeting date.
 * Examples: "yesterday's", "today's", "Monday's", "last week's", "the March 5"
 */
function getTemporalLabel(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today's";
  if (diffDays === 1) return "yesterday's";
  if (diffDays >= 2 && diffDays <= 6) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    return `${dayName}'s`;
  }
  if (diffDays >= 7 && diffDays <= 13) return "last week's";
  return null; // Too old for temporal framing
}

// =============================================
// Data extraction from analysis_json (v3 fallback)
// =============================================

interface V3Extracted {
  topics: string[];
  actionItems: Array<{ description: string; assignee?: string; status?: string }>;
  decisions: Array<{ description: string }>;
}

function extractFromV3Analysis(analysisJson: string | null | undefined): V3Extracted | null {
  if (!analysisJson || typeof analysisJson !== 'string') return null;
  try {
    const analysis = JSON.parse(analysisJson);
    if (analysis.analysis_schema_version !== 3) return null;

    const topics: string[] = [];
    if (Array.isArray(analysis.topics)) {
      for (const t of analysis.topics) {
        if (t.title && typeof t.title === 'string') {
          topics.push(t.title);
        }
      }
    }

    const actionItems: V3Extracted['actionItems'] = [];
    if (Array.isArray(analysis.all_action_items)) {
      for (const a of analysis.all_action_items) {
        if (a.text || a.description) {
          actionItems.push({
            description: a.text || a.description,
            assignee: a.assignee,
            status: a.status || 'active',
          });
        }
      }
    }

    const decisions: V3Extracted['decisions'] = [];
    if (Array.isArray(analysis.all_decisions)) {
      for (const d of analysis.all_decisions) {
        if (d.text || d.description) {
          decisions.push({ description: d.text || d.description });
        }
      }
    }

    return { topics, actionItems, decisions };
  } catch {
    return null;
  }
}

// =============================================
// Core engine
// =============================================

interface Candidate {
  tier: number; // 0 (highest priority) to 3 (lowest)
  category: string;
  query: string;
}

export function generateSuggestedQueries(): string[] {
  console.log('[suggestedQueries] Generating dynamic suggested queries...');
  const meetings = db.getMeetings() as any[];
  if (!meetings || meetings.length === 0) {
    return [];
  }

  const recentMeetings = meetings.slice(0, 10);
  const candidates: Candidate[] = [];

  // ── Global frequency & deduplication trackers ──────────────
  const topicFrequency: Record<string, number> = {};
  const projectFrequency: Record<string, number> = {};
  const participantFrequency: Record<string, number> = {};
  // Track assignees globally to deduplicate "What's assigned to X?" across meetings
  const globalAssignees: Record<string, number> = {};

  // ── First pass: frequency collection across all sources ────
  for (const m of recentMeetings) {
    let mid: MidFrontmatter | null = null;
    try {
      if (typeof m.mid_json === 'string' && m.mid_json.trim()) {
        mid = JSON.parse(m.mid_json);
      }
    } catch {
      // Ignore
    }

    if (mid) {
      if (Array.isArray(mid.topics)) {
        for (const t of mid.topics) {
          if (t.name) topicFrequency[t.name] = (topicFrequency[t.name] || 0) + 1;
        }
      }
      if (Array.isArray(mid.projects)) {
        for (const p of mid.projects) {
          if (p.name) projectFrequency[p.name] = (projectFrequency[p.name] || 0) + 1;
        }
      }
      if (Array.isArray(mid.participants)) {
        for (const p of mid.participants) {
          if (p.name) participantFrequency[p.name] = (participantFrequency[p.name] || 0) + 1;
        }
      }
      if (Array.isArray(mid.action_items)) {
        for (const a of mid.action_items) {
          if (a.assignee && a.status === 'active') {
            globalAssignees[a.assignee] = (globalAssignees[a.assignee] || 0) + 1;
          }
        }
      }
    }

    // Also collect from v3 analysis if MID is missing
    if (!mid) {
      const v3 = extractFromV3Analysis(m.analysis_json);
      if (v3) {
        for (const t of v3.topics) {
          topicFrequency[t] = (topicFrequency[t] || 0) + 1;
        }
        for (const a of v3.actionItems) {
          if (a.assignee && a.status !== 'completed') {
            globalAssignees[a.assignee] = (globalAssignees[a.assignee] || 0) + 1;
          }
        }
      }
    }
  }

  // ── Second pass: Candidate generation ──────────────────────
  for (const m of recentMeetings) {
    const mTitle = truncate(m.title, 40);
    const temporalLabel = getTemporalLabel(m.started_at || m.created_at);
    // Use temporal framing when available: "yesterday's Sprint Review" vs "Sprint Review"
    const framedTitle = temporalLabel ? `${temporalLabel} ${mTitle}` : mTitle;

    let mid: MidFrontmatter | null = null;
    try {
      if (typeof m.mid_json === 'string' && m.mid_json.trim()) {
        mid = JSON.parse(m.mid_json);
      }
    } catch {
      // Ignore
    }

    // Fall back to v3 analysis when MID is missing
    const v3 = !mid ? extractFromV3Analysis(m.analysis_json) : null;

    // ── P0: Action Accountability ──
    const activeItems: Array<{ description: string; assignee?: string }> = [];
    if (mid && Array.isArray(mid.action_items)) {
      activeItems.push(...mid.action_items.filter((a) => a.status === 'active'));
    } else if (v3) {
      activeItems.push(
        ...v3.actionItems.filter((a) => a.status !== 'completed'),
      );
    }

    if (activeItems.length > 0) {
      candidates.push({
        tier: 0,
        category: 'action_general',
        query: `What action items came out of ${framedTitle}?`,
      });
    }

    // ── P1: Decision Tracking ──
    const decisions: Array<{ description: string }> =
      mid && Array.isArray(mid.decisions) ? mid.decisions : v3?.decisions || [];

    if (decisions.length > 0) {
      const decision = pickRandom(decisions);
      if (decision?.description) {
        // Try to pair with a topic for richer queries
        const topicNames = mid?.topics?.map((t) => t.name).filter(Boolean) || v3?.topics || [];
        if (topicNames.length > 0) {
          const topic = pickRandom(topicNames);
          if (topic) {
            candidates.push({
              tier: 1,
              category: 'decision_topic',
              query: `What was decided about ${truncate(topic, 30)}?`,
            });
          }
        } else {
          candidates.push({
            tier: 1,
            category: 'decision_meeting',
            query: `What decisions were made in ${framedTitle}?`,
          });
        }

        // Specific decision rationale query
        candidates.push({
          tier: 1,
          category: 'decision_rationale',
          query: `Why did we decide to ${truncate(decision.description, 50)}?`,
        });
      }
    }

    // ── P2: Cross-meeting Continuity (topics) ──
    const topicNames = mid?.topics?.map((t) => t.name).filter(Boolean) || v3?.topics || [];
    for (const name of topicNames) {
      if (name && topicFrequency[name] > 1) {
        const variants = [
          `How has ${truncate(name, 30)} evolved across meetings?`,
          `What's the latest update on ${truncate(name, 30)}?`,
          `Has ${truncate(name, 30)} come up before?`,
        ];
        candidates.push({
          tier: 2,
          category: 'continuity_topic',
          query: pickRandom(variants)!,
        });
        break; // One per meeting is enough
      }
    }

    // ── P2: Cross-meeting Continuity (projects) ──
    if (mid && Array.isArray(mid.projects)) {
      for (const p of mid.projects) {
        if (p.name && projectFrequency[p.name] > 1) {
          const variants = [
            `What are the open blockers for ${truncate(p.name, 30)}?`,
            `How is ${truncate(p.name, 30)} progressing?`,
          ];
          candidates.push({
            tier: 2,
            category: 'continuity_project',
            query: pickRandom(variants)!,
          });
          break;
        }
      }
    }

    // ── P3: Recap (always available — just needs a title) ──
    const variants = [
      `Give me a recap of ${framedTitle}`,
      `What were the key takeaways from ${framedTitle}?`,
      `What did we cover in ${framedTitle}?`,
    ];
    candidates.push({
      tier: 3,
      category: 'recap',
      query: pickRandom(variants)!,
    });
  }

  // ── Global candidates (not per-meeting) ────────────────────

  // P0: Deduplicated assignee queries — pick top assignee by count
  const sortedAssignees = Object.entries(globalAssignees)
    .sort((a, b) => b[1] - a[1]);
  if (sortedAssignees.length > 0) {
    const [topAssignee] = sortedAssignees[0];
    candidates.push({
      tier: 0,
      category: 'action_assignee',
      query: `What's assigned to ${topAssignee}?`,
    });
    // Add a second if available for variety
    if (sortedAssignees.length > 1) {
      const [secondAssignee] = sortedAssignees[1];
      candidates.push({
        tier: 0,
        category: 'action_assignee_alt',
        query: `What's assigned to ${secondAssignee}?`,
      });
    }
  }

  // P2: People-centric cross-meeting queries
  const sortedParticipants = Object.entries(participantFrequency)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
  if (sortedParticipants.length > 0) {
    const [topPerson] = sortedParticipants[0];
    const variants = [
      `Which meetings has ${topPerson} been in recently?`,
      `What has ${topPerson} been involved in?`,
      `Summarize ${topPerson}'s recent contributions`,
    ];
    candidates.push({
      tier: 2,
      category: 'continuity_person',
      query: pickRandom(variants)!,
    });
  }

  // ── Temporal summary queries ───────────────────────────────
  const latestMeeting = recentMeetings[0];
  if (latestMeeting) {
    const latestDate = new Date(latestMeeting.started_at || latestMeeting.created_at || '');
    const now = new Date();
    const diffDays = Math.round(
      (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays <= 7 && recentMeetings.length >= 2) {
      candidates.push({
        tier: 3,
        category: 'temporal_summary',
        query: diffDays <= 1
          ? "Summarize today's meetings"
          : 'What happened in my meetings this week?',
      });
    }
  }

  // ── Selection: pick 3 diverse, prioritized queries ─────────

  // Shuffle within tiers for variety, then stable-sort by tier
  const shuffledCandidates = shuffle(candidates);
  shuffledCandidates.sort((a, b) => a.tier - b.tier);

  const selectedQueries: string[] = [];
  const usedCategories = new Set<string>();

  // First pass: one per category, respecting tier order
  for (const candidate of shuffledCandidates) {
    if (selectedQueries.length >= 3) break;
    if (selectedQueries.includes(candidate.query)) continue;
    if (!usedCategories.has(candidate.category)) {
      selectedQueries.push(candidate.query);
      usedCategories.add(candidate.category);
    }
  }

  // Second pass: fill remaining slots if we don't have 3 distinct categories
  if (selectedQueries.length < 3) {
    for (const candidate of shuffledCandidates) {
      if (selectedQueries.length >= 3) break;
      if (!selectedQueries.includes(candidate.query)) {
        selectedQueries.push(candidate.query);
      }
    }
  }

  console.log(
    `[suggestedQueries] Generated ${candidates.length} candidates, selected ${selectedQueries.length}`,
  );
  return selectedQueries;
}
