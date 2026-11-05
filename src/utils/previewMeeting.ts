import type { Meeting } from '../types';

// Fictional screenshot scenario; never sourced from a user profile.
const now = new Date().toISOString();

export const previewMeeting: Meeting = {
  id: 'preview-pricing-review',
  title: 'Q4 Launch & Customer Pricing',
  meeting_type: 'Recording',
  created_at: '2026-10-06T10:00:00-07:00',
  started_at: '2026-10-06T10:00:00-07:00',
  duration_seconds: 42 * 60,
  finalization_status: 'finalized',
  transcript_status: 'validated',
  transcript_validated_at: now,
  user_notes:
    'Agree on team pricing, confirm the launch date, and check customer trial plans.',
  transcript_json: JSON.stringify({
    lifecycleStatus: 'validated',
    segments: [
      {
        speaker: 'Maya Chen',
        start: 120,
        end: 145,
        text: "Based on customer feedback, let's set the team price at $45 per seat and keep the basic plan at $20 so new teams can try it easily.",
      },
      {
        speaker: 'David Kim',
        start: 160,
        end: 182,
        text: 'That fits what customers are asking for. Acme Corp is ready to start their 30-day trial next week.',
      },
      {
        speaker: 'Alex Rivera',
        start: 210,
        end: 230,
        text: 'The setup for team accounts is ready in testing. We can launch it on October 15th.',
      },
      {
        speaker: 'Avery Taylor',
        start: 250,
        end: 272,
        text: 'We also made inviting team members much simpler. It now takes less than two minutes.',
      },
    ],
  }),
  analysis_schema_version: 3,
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview:
      'The team agreed on pricing and launch dates. Team plans will cost $45 per seat, and the basic plan will stay at $20. Acme Corp will start their trial next week, and the new setup will go live on October 15th.',
    all_decisions: [
      {
        text: 'Set team plan price at $45 per seat with simple setup included.',
        decided_by: 'Maya Chen',
        evidence:
          "Maya Chen: Based on customer feedback, let's set the team price at $45 per seat and keep the basic plan at $20 so new teams can try it easily.",
      },
      {
        text: 'Keep basic plan at $20 so small teams can start quickly.',
        decided_by: 'Maya Chen',
        evidence:
          'Maya Chen: ...and keep the basic plan at $20 so new teams can try it easily.',
      },
      {
        text: 'Launch the new team setup on October 15th.',
        decided_by: 'Alex Rivera',
        evidence:
          'Alex Rivera: The setup for team accounts is ready in testing. We can launch it on October 15th.',
      },
    ],
    all_action_items: [
      {
        text: 'Send the new pricing sheet to Sarah in sales',
        assignee: 'You',
        due: 'Thursday',
        topic: 'Customer Pricing',
      },
      {
        text: 'Finish testing the team invite steps',
        assignee: 'Avery Taylor',
        due: 'Today',
        topic: 'Team Setup',
      },
      {
        text: 'Confirm launch date with the Acme Corp team',
        assignee: 'David Kim',
        due: 'Friday',
        topic: 'Customer Trials',
      },
    ],
    recent_win: {
      win: 'New team setup time cut by half',
      why_it_counts:
        'New teams can now set up their accounts and invite members in under three minutes.',
      evidence: 'Tested with eight customer teams with no drop-offs.',
      source: 'Q4 Launch & Customer Pricing',
      owner: 'Product & Design',
      ownership: 'shared',
    },
    topics: [
      {
        title: 'Team Pricing & Plans',
        summary:
          'The team agreed to set the team plan at $45 per seat and keep the basic plan at $20.',
        key_points: [
          { text: 'Team plan includes fast support and member invites.' },
          { text: 'Basic plan stays at $20 for single users.' },
        ],
        decisions: [],
        action_items: [],
        open_questions: [
          'Should we offer an annual discount for small businesses?',
        ],
        transcript_range: [0, 2],
      },
      {
        title: 'Customer Trial & Launch Date',
        summary:
          'Acme Corp starts testing next week, and public launch is set for October 15th.',
        key_points: [
          { text: 'Acme Corp will test with 120 team members.' },
          { text: 'Engineering confirmed the system is ready for launch.' },
        ],
        decisions: [],
        action_items: [],
        open_questions: [],
        transcript_range: [2, 4],
      },
    ],
    meeting_type: 'team_sync',
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
  }),
};
