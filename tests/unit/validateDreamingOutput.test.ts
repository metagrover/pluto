import { describe, expect, it } from 'vitest';
import type { DreamingInputPackage } from '../../electron/dreaming/types';
import {
  generateItemFingerprint,
  validateProjectDreamingOutput,
  validatePersonDreamingOutput,
} from '../../electron/dreaming/validateDreamingOutput';

describe('validateDreamingOutput', () => {
  const sampleProjectPackage: DreamingInputPackage = {
    entityId: 'proj-1',
    entityType: 'project',
    entityName: 'Billing V2',
    recentMeetingNotes: [
      {
        meetingId: 'm-101',
        title: 'Sprint 1',
        startedAt: '2026-08-01',
        notesContent: 'Discussed Stripe integration',
      },
    ],
    negativeConstraints: ['dismissed-old-milestone'],
  };

  it('validates and accepts valid project output with markdown fences', () => {
    const raw = `\`\`\`json
    {
      "status": "updated",
      "dossier_summary": "Migration to Stripe is underway.",
      "milestones": [
        {
          "name": "Stripe Elements connected",
          "status": "in_progress",
          "source_meeting_id": "m-101",
          "evidence_snippet": "Discussed Stripe integration"
        }
      ],
      "associated_commitments": [
        {
          "task": "Test webhooks",
          "owner_name": "Bob",
          "source_meeting_id": "m-101"
        }
      ],
      "suggested_aliases": ["Billing Redesign"]
    }
    \`\`\``;

    const result = validateProjectDreamingOutput(raw, sampleProjectPackage);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('updated');
    expect(result?.dossier_summary).toBe('Migration to Stripe is underway.');
    expect(result?.milestones).toHaveLength(1);
    expect(result?.milestones?.[0].name).toBe('Stripe Elements connected');
    expect(result?.associated_commitments).toHaveLength(1);
    expect(result?.suggested_aliases).toEqual(['Billing Redesign']);
  });

  it('rejects milestones citing non-existent meeting IDs', () => {
    const raw = JSON.stringify({
      status: 'updated',
      milestones: [
        {
          "name": "Fake milestone",
          "status": "completed",
          "source_meeting_id": "fake-meeting-999",
          "evidence_snippet": "hallucinated quote"
        }
      ]
    });

    const result = validateProjectDreamingOutput(raw, sampleProjectPackage);
    expect(result?.milestones).toHaveLength(0);
  });

  it('prunes milestones matching negative constraints', () => {
    const raw = JSON.stringify({
      status: 'updated',
      milestones: [
        {
          "name": "Dismissed Old Milestone",
          "status": "completed",
          "source_meeting_id": "m-101",
          "evidence_snippet": "Discussed Stripe integration"
        }
      ]
    });

    const result = validateProjectDreamingOutput(raw, sampleProjectPackage);
    expect(result?.milestones).toHaveLength(0);
  });

  it('validates person output properly', () => {
    const samplePersonPackage: DreamingInputPackage = {
      entityId: 'person-1',
      entityType: 'person',
      entityName: 'Alice',
      recentMeetingNotes: [
        {
          meetingId: 'm-101',
          title: 'Sprint 1',
          startedAt: '2026-08-01',
          notesContent: 'Alice leads backend',
        },
      ],
      negativeConstraints: [],
    };

    const raw = JSON.stringify({
      status: 'updated',
      headline: 'Backend Lead for Billing',
      current_focus: 'Working on Stripe API integration',
      recent_collaborators: ['Bob', 'Charlie'],
      suggested_aliases: ['Alice Smith']
    });

    const result = validatePersonDreamingOutput(raw, samplePersonPackage);
    expect(result).not.toBeNull();
    expect(result?.headline).toBe('Backend Lead for Billing');
    expect(result?.recent_collaborators).toEqual(['Bob', 'Charlie']);
  });

  it('generates consistent normalized fingerprints', () => {
    expect(generateItemFingerprint('Stripe Elements connected')).toBe('stripe-elements-connected');
    expect(generateItemFingerprint('   Stripe   Elements connected!  ')).toBe('stripe-elements-connected');
  });
});
