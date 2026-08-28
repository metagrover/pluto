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

  it('drops generic empty-analysis output when substantive topics exist', () => {
    const collapsed = collapseOversizedTopics([
      topic(
        'Conversion tracking',
        'No substantive discussion or outcomes were recorded in the provided transcript slice. No substantive discussion or outcome was recorded in the provided transcript slice.',
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        topic(
          `Substantive topic ${index + 1}`,
          `A concrete outcome ${index + 1} was recorded.`,
        ),
      ),
    ]);

    expect(collapsed).toHaveLength(6);
    expect(
      collapsed.some((section) =>
        /no substantive discussion/i.test(
          `${section.summary} ${section.key_points.map((point) => point.text).join(' ')}`,
        ),
      ),
    ).toBe(false);
  });

  it('drops generic filler disclaimers emitted by a local topic pass', () => {
    const collapsed = collapseOversizedTopics([
      topic(
        'No substantive content available in transcript slice',
        'The provided transcript slice contains only filler and no factual data, decisions, or commitments.',
      ),
      topic('Release planning', 'The release target remains tentative.'),
    ]);

    expect(collapsed).toEqual([
      expect.objectContaining({ title: 'Release planning' }),
    ]);
  });

  it('keeps grounded commitments even when a topic has a generic summary', () => {
    const collapsed = collapseOversizedTopics([
      {
        ...topic(
          'Implementation follow-up',
          'No substantive discussion was recorded in the provided transcript slice.',
        ),
        action_items: [
          {
            text: 'Publish the implementation notes',
            evidence: 'I will publish the implementation notes.',
          },
        ],
      },
      topic('Delivery state', 'The delivery remains on schedule.'),
    ]);

    expect(collapsed.flatMap((section) => section.action_items)).toContainEqual(
      expect.objectContaining({ text: 'Publish the implementation notes' }),
    );
    expect(
      collapsed.some((section) =>
        /no substantive discussion/i.test(section.summary),
      ),
    ).toBe(false);
  });
});
