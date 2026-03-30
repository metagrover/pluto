import { describe, expect, it } from 'vitest';
import { renderMidToMarkdown } from '../../electron/intelligence/midRenderer';
import type { MidFrontmatter } from '../../electron/intelligence/intelligenceTypes';

// =============================================
// Helpers
// =============================================

const mockMid = (overrides: Partial<MidFrontmatter> = {}): MidFrontmatter => ({
  mid_version: 1,
  meeting_id: 'meeting-abc-123',
  title: 'Sprint Planning Q2',
  occurred_at: '2026-03-29T10:00:00-07:00',
  duration_seconds: 3600,
  participants: [
    { entity_id: 'ent-sarah', name: 'Sarah Chen', role: 'Engineering Lead' },
    { entity_id: 'ent-alex', name: 'Alex Rivera' },
  ],
  projects: [{ entity_id: 'ent-api', name: 'API Migration' }],
  topics: [
    { entity_id: 'ent-t1', name: 'Timeline Planning', importance: 'high' },
    { entity_id: 'ent-t2', name: 'Code Review Process', importance: 'medium' },
  ],
  action_items: [
    {
      entity_id: 'ent-ai-1',
      description: 'Send API spec to team by Friday',
      assignee: 'Sarah Chen',
      due_date: '2026-04-04T00:00:00Z',
      status: 'active',
    },
    {
      entity_id: 'ent-ai-2',
      description: 'Set up GraphQL playground',
      status: 'completed',
    },
  ],
  decisions: [
    {
      entity_id: 'ent-dec-1',
      description: 'Use GraphQL for new endpoints',
      rationale: 'Better type safety and query flexibility',
    },
  ],
  signals: {
    continuity: ['API migration timeline is Q2-critical'],
    accountability_risks: ['No owner assigned for staging deployment'],
    decision_impacts: ['GraphQL choice affects mobile team'],
  },
  evidence_spans: [],
  ...overrides,
});

// =============================================
// Tests
// =============================================

describe('MID Renderer', () => {
  describe('Section output', () => {
    it('renders title as h2 heading', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('## Sprint Planning Q2');
    });

    it('renders participants list', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('Sarah Chen (Engineering Lead)');
      expect(md).toContain('Alex Rivera');
    });

    it('renders projects', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('**Projects:** API Migration');
    });

    it('renders topics with importance badges', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('## Key Topics');
      expect(md).toContain('Timeline Planning 🔴');
      expect(md).toContain('Code Review Process 🟡');
    });

    it('renders action items as checkboxes', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('## Action Items');
      expect(md).toContain('- [ ] Send API spec to team by Friday');
      expect(md).toContain('- [x] Set up GraphQL playground');
    });

    it('renders action item assignee and due date', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('*(Sarah Chen)*');
      // Due date rendering depends on locale/timezone; just verify it's there
      expect(md).toMatch(/due Apr \d/);
    });

    it('renders decisions with rationale', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('## Decisions');
      expect(md).toContain('**Use GraphQL for new endpoints**');
      expect(md).toContain('Rationale: Better type safety and query flexibility');
    });

    it('renders signals section', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('## Signals');
      expect(md).toContain('**Continuity:**');
      expect(md).toContain('API migration timeline is Q2-critical');
      expect(md).toContain('**Accountability Risks:**');
      expect(md).toContain('⚠️ No owner assigned for staging deployment');
    });

    it('renders duration in the header', () => {
      const md = renderMidToMarkdown(mockMid());
      expect(md).toContain('1h 0m');
    });
  });

  describe('Empty section handling', () => {
    it('omits topics section when no topics', () => {
      const md = renderMidToMarkdown(mockMid({ topics: [] }));
      expect(md).not.toContain('## Key Topics');
    });

    it('omits action items section when no action items', () => {
      const md = renderMidToMarkdown(mockMid({ action_items: [] }));
      expect(md).not.toContain('## Action Items');
    });

    it('omits decisions section when no decisions', () => {
      const md = renderMidToMarkdown(mockMid({ decisions: [] }));
      expect(md).not.toContain('## Decisions');
    });

    it('omits signals section when all signal arrays are empty', () => {
      const md = renderMidToMarkdown(
        mockMid({
          signals: {
            continuity: [],
            accountability_risks: [],
            decision_impacts: [],
          },
        }),
      );
      expect(md).not.toContain('## Signals');
    });

    it('omits participants line when no participants', () => {
      const md = renderMidToMarkdown(mockMid({ participants: [] }));
      expect(md).not.toContain('**Participants:**');
    });

    it('omits projects line when no projects', () => {
      const md = renderMidToMarkdown(mockMid({ projects: [] }));
      expect(md).not.toContain('**Projects:**');
    });
  });

  describe('Edge cases', () => {
    it('handles null occurred_at', () => {
      const md = renderMidToMarkdown(mockMid({ occurred_at: null }));
      // Should not crash, just omit the date
      expect(md).toContain('## Sprint Planning Q2');
    });

    it('handles zero duration', () => {
      const md = renderMidToMarkdown(mockMid({ duration_seconds: 0 }));
      expect(md).not.toContain('Duration:');
    });

    it('renders minutes-only duration correctly', () => {
      const md = renderMidToMarkdown(mockMid({ duration_seconds: 1800 }));
      expect(md).toContain('30m');
      expect(md).not.toMatch(/\d+h/);
    });
  });
});
