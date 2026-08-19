import { describe, expect, it } from 'vitest';

import type { TopicSection } from '../../electron/llm/analysisTypes';
import { collapseOversizedTopics } from '../../electron/llm/unifiedProvider';

const topic = (title: string, summary: string): TopicSection => ({
  title,
  summary,
  key_points: [{ text: summary }],
  decisions: [],
  action_items: [],
  open_questions: [],
});

describe('analysis topic compaction', () => {
  it('never exposes a dozens-of-topics extraction dump', () => {
    const topics = Array.from({ length: 48 }, (_, index) =>
      topic(`Architecture area ${index + 1}`, `Constraint ${index + 1}`),
    );

    const collapsed = collapseOversizedTopics(topics);

    expect(collapsed).toHaveLength(6);
    expect(collapsed.every((section) => section.summary.length > 0)).toBe(true);
  });

  it('does not let housekeeping name a cluster when substantive content exists', () => {
    const collapsed = collapseOversizedTopics([
      topic('Screen sharing', 'The screen was shared.'),
      {
        ...topic('API deployment', 'The API will use the existing service.'),
        decisions: [{ text: 'Keep the existing API service.' }],
      },
      ...Array.from({ length: 5 }, (_, index) =>
        topic(`Deployment constraint ${index}`, `Constraint ${index}`),
      ),
    ]);

    expect(
      collapsed.some((section) => section.title === 'Screen sharing'),
    ).toBe(false);
  });
});
