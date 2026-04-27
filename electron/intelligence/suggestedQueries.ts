import * as db from '../db';
import type { MidFrontmatter } from './intelligenceTypes';

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
  return str.slice(0, maxLength).trim() + '...';
}

function pickRandom<T>(array: T[]): T | null {
  if (array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

interface Candidate {
  tier: number; // 0 (highest priority) to 3 (lowest)
  category: string;
  query: string;
}

export function generateSuggestedQueries(): string[] {
  console.log('[suggestedQueries] Generating dynamic suggested queries...');
  const meetings = db.getMeetings() as any[];
  if (!meetings || meetings.length === 0) {
    return []; // No meetings yet
  }

  // Get up to 10 recent meetings to build candidates from
  const recentMeetings = meetings.slice(0, 10);
  const candidates: Candidate[] = [];

  // Track frequencies of topics/projects across recent meetings
  const topicFrequency: Record<string, number> = {};
  const projectFrequency: Record<string, number> = {};

  // First pass: frequency collection
  for (const m of recentMeetings) {
    let mid: MidFrontmatter | null = null;
    try {
      if (typeof m.mid_json === 'string' && m.mid_json.trim()) {
        mid = JSON.parse(m.mid_json);
      }
    } catch {
      // Ignore parse errors
    }

    if (mid) {
      if (Array.isArray(mid.topics)) {
        for (const t of mid.topics) {
          if (t.name) {
            topicFrequency[t.name] = (topicFrequency[t.name] || 0) + 1;
          }
        }
      }
      if (Array.isArray(mid.projects)) {
        for (const p of mid.projects) {
          if (p.name) {
            projectFrequency[p.name] = (projectFrequency[p.name] || 0) + 1;
          }
        }
      }
    }
  }

  // Second pass: Candidate generation
  for (const m of recentMeetings) {
    const mTitle = truncate(m.title, 40);

    let mid: MidFrontmatter | null = null;
    try {
      if (typeof m.mid_json === 'string' && m.mid_json.trim()) {
        mid = JSON.parse(m.mid_json);
      }
    } catch {
      // Ignore
    }

    // P0: Action Accountability
    if (mid && Array.isArray(mid.action_items)) {
      const activeItems = mid.action_items.filter((a) => a.status === 'active');
      if (activeItems.length > 0) {
        candidates.push({
          tier: 0,
          category: 'action_general',
          query: `What action items came out of ${mTitle}?`,
        });

        // Random assignees
        const assignees = activeItems.map((a) => a.assignee).filter(Boolean);
        if (assignees.length > 0) {
          const assignee = pickRandom(assignees);
          if (assignee) {
            candidates.push({
              tier: 0,
              category: 'action_assignee',
              query: `What's assigned to ${assignee}?`,
            });
          }
        }
      }
    }

    // P1: Decision Tracking
    if (mid && Array.isArray(mid.decisions) && mid.decisions.length > 0) {
      const decision = pickRandom(mid.decisions);
      if (decision && decision.description) {
        // Find a related topic if possible to enrich the query
        let dQuery = '';
        if (mid.topics && mid.topics.length > 0) {
          const topic = pickRandom(mid.topics);
          if (topic && topic.name) {
            dQuery = `What was decided about ${truncate(topic.name, 30)}?`;
          } else {
            dQuery = `What decisions were made in ${mTitle}?`;
          }
        } else {
          dQuery = `What decisions were made in ${mTitle}?`;
        }

        candidates.push({
          tier: 1,
          category: 'decision',
          query: dQuery,
        });

        // Specific decision rationale query
        const dSnippet = truncate(decision.description, 30);
        candidates.push({
          tier: 1,
          category: 'decision_specific',
          query: `Why did we decide to ${dSnippet}?`,
        });
      }
    }

    // P2: Cross-meeting Continuity
    if (mid) {
      if (Array.isArray(mid.topics)) {
        for (const t of mid.topics) {
          if (t.name && topicFrequency[t.name] > 1) {
            const variants = [
              `How has ${truncate(t.name, 30)} evolved across meetings?`,
              `What's the latest update on ${truncate(t.name, 30)}?`,
              `Has ${truncate(t.name, 30)} come up before?`,
            ];
            candidates.push({
              tier: 2,
              category: 'continuity_topic',
              query: pickRandom(variants)!,
            });
          }
        }
      }
      if (Array.isArray(mid.projects)) {
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
          }
        }
      }
    }

    // P3: Recap
    // Rely on meetings having analysis or transcripts
    if (m.analysis_json || m.transcript_json) {
      const variants = [
        `Give me a recap of ${mTitle}`,
        `What were the key takeaways from ${mTitle}?`,
        `What did we cover in ${mTitle}?`,
      ];
      candidates.push({
        tier: 3,
        category: 'recap',
        query: pickRandom(variants)!,
      });
    }
  }

  // Shuffle candidates within their tiers to provide variety
  const shuffledCandidates = shuffle(candidates);

  // Sort by tier (0 first)
  shuffledCandidates.sort((a, b) => a.tier - b.tier);

  // We want 3 queries, diverse categories
  const selectedQueries: string[] = [];
  const usedCategories = new Set<string>();

  for (const candidate of shuffledCandidates) {
    if (selectedQueries.length >= 3) break;

    // De-duplicate same exact queries
    if (selectedQueries.includes(candidate.query)) continue;

    // Ensure category diversity if possible
    if (!usedCategories.has(candidate.category)) {
      selectedQueries.push(candidate.query);
      usedCategories.add(candidate.category);
    }
  }

  // If we couldn't find 3 distinct categories, fall back to adding whatever is available
  if (selectedQueries.length < 3) {
    for (const candidate of shuffledCandidates) {
      if (selectedQueries.length >= 3) break;
      if (!selectedQueries.includes(candidate.query)) {
        selectedQueries.push(candidate.query);
      }
    }
  }

  return selectedQueries;
}
