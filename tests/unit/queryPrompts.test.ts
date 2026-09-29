import { describe, expect, it } from 'vitest';

import {
  anchorRelativeSourceDates,
  getAskPlutoPrompt,
} from '../../electron/intelligence/queryPrompts';

describe('getAskPlutoPrompt', () => {
  it('treats an older person profile as a dated picture for coaching', () => {
    const prompt = getAskPlutoPrompt(
      'How should I coach him?',
      [
        {
          meeting_id: 'person:gamma',
          meeting_title: 'Gamma profile',
          mid: null,
          evidence_text:
            '[Person profile]: Gamma\n[Profile as of]: 2025-04-10T12:00:00Z\n[Current work]: Deployment review',
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
      [],
      'None',
      'analysis',
    );

    expect(prompt).toContain('PERSON PROFILE RECENCY:');
    expect(prompt).toContain('This question is about Gamma, not the user');
    expect(prompt).toContain(
      'last recorded picture, not confirmed current work',
    );
    expect(prompt).toContain("Begin with the profile's as-of date");
  });

  it('does not turn a draft to a person into another profile summary', () => {
    const profile = {
      meeting_id: 'person:gamma',
      meeting_title: 'Gamma profile',
      mid: null,
      evidence_text:
        '[Person profile]: Gamma\n[Profile as of]: 2025-04-10T12:00:00Z\n[Last recorded work]: Deployment review',
      score: 1,
      score_breakdown: {
        fts_rank: 1,
        graph_proximity: 0,
        recency_decay: 1,
        mention_weight: 0,
      },
    };
    const prompt = getAskPlutoPrompt(
      'Draft a short follow-up message to Gamma about it.',
      [profile],
      'factual',
      [],
      'None',
      'draft',
      undefined,
      { previousAnswer: 'The database query update seemed most urgent.' },
    );

    expect(prompt).toContain('Write only the requested copy-ready draft');
    expect(prompt).toContain('Do not present inferred urgency');
    expect(prompt).not.toContain("Begin with the profile's as-of date");
    expect(prompt).not.toContain("Describe Gamma's work in the third person");
    expect(prompt).toContain('without combining adjacent workstreams');
  });

  it('anchors relative wording in older synthesized notes to the source date', () => {
    expect(
      anchorRelativeSourceDates(
        '[Meeting date]: 2025-04-10\nReview five samples today and run the pipeline next Tuesday.',
      ),
    ).toContain('on the meeting date (2025-04-10)');
    expect(
      anchorRelativeSourceDates(
        '[Meeting date]: 2025-04-10\nReview five samples today and run the pipeline next Tuesday.',
      ),
    ).toContain('the Tuesday after the meeting (2025-04-10)');
  });
  it('uses confirmed self identity for address without treating it as meeting evidence', () => {
    const prompt = getAskPlutoPrompt(
      'Summarize my recent contributions',
      [],
      'factual',
      [],
      'None',
      'lookup',
      undefined,
      undefined,
      'Alpha User',
    );
    expect(prompt).toContain('name is Alpha User');
    expect(prompt).toContain('Address supported facts about this person as');
    expect(prompt).toContain('does not prove who spoke');
  });

  it('asks a follow-up for additional supported context from the same meeting', () => {
    const prompt = getAskPlutoPrompt(
      'Add supported context for UI and Layout Refinements.',
      [
        {
          meeting_id: 'ui-layout',
          meeting_title: 'UI and Layout Refinements',
          mid: null,
          evidence_text:
            'The capability to add multiple calendars has been added.',
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
      [],
      'None',
      'analysis',
      undefined,
      { previousAnswer: 'The team decided to hide the button.' },
    );

    expect(prompt).toContain('same meeting scope');
    expect(prompt).toContain('Do not restate the earlier answer');
    expect(prompt).toContain('The team decided to hide the button.');
    expect(prompt).toContain('multiple calendars');
  });

  it('labels local artifacts and preserves source-wide absence wording', () => {
    const prompt = getAskPlutoPrompt(
      'What did the launch note say?',
      [
        {
          meeting_id: 'artifact-1',
          source_id: 'artifact-1',
          source_type: 'artifact',
          meeting_title: 'Launch note',
          mid: null,
          evidence_text: 'The staged launch starts Friday.',
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
    );

    expect(prompt).toContain('Local artifact: "Launch note" (ID: artifact-1)');
    expect(prompt).toContain('[Context 1] Local artifact');
    expect(prompt).toContain('Provenance is attached by Pluto');
    expect(prompt).not.toContain('CITATION RULES');
    expect(prompt).toContain(
      'Do not conclude that the underlying source lacks the information',
    );
  });

  it('includes bounded conversation and the resolved meeting title', () => {
    const prompt = getAskPlutoPrompt(
      'Why did that change?',
      [
        {
          meeting_id: 'meeting-2',
          meeting_title: 'Current product review',
          mid: null,
          evidence_text: 'The launch moved to Friday.',
          score: 1,
          score_breakdown: {
            fts_rank: 0,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
      [
        { role: 'user', content: 'What changed?' },
        {
          role: 'assistant',
          content: 'The launch moved from Thursday to Friday.',
        },
      ],
    );

    expect(prompt).toContain('Meeting: "Current product review"');
    expect(prompt).toContain('User: What changed?');
    expect(prompt).toContain(
      'Pluto: The launch moved from Thursday to Friday.',
    );
  });

  it('keeps large temporal meeting sets inside the foreground context budget', () => {
    const context = Array.from({ length: 20 }, (_, index) => ({
      meeting_id: `meeting-${index}`,
      meeting_title: `Meeting ${index}`,
      mid: null,
      evidence_text: `Evidence ${index} ${'detail '.repeat(800)}`,
      score: 1,
      score_breakdown: {
        fts_rank: 1,
        graph_proximity: 0,
        recency_decay: 1,
        mention_weight: 0,
      },
    }));

    const prompt = getAskPlutoPrompt(
      "Summarize today's meetings",
      context,
      'temporal',
    );

    expect(context.every((source) => prompt.includes(source.meeting_id))).toBe(
      true,
    );
    expect(prompt.length).toBeLessThan(12_000);
    expect(prompt).toContain('Write a rich, readable breakdown');
    expect(prompt).toContain('Write like a thoughtful colleague');
    expect(prompt).toContain('Do not add headings');
    expect(prompt).not.toContain('Topics: None');
    expect(prompt).not.toContain('Decisions: None');
    expect(prompt).not.toContain('Action Items: None');
    expect(prompt).toContain('using one bullet for each meeting');
    expect(prompt).not.toContain(
      'Use markdown bullet points to list key items',
    );
  });

  it('asks for a useful evidence-close answer that survives local validation', () => {
    const prompt = getAskPlutoPrompt(
      'What happened in the current meeting?',
      [
        {
          meeting_id: 'meeting-1',
          meeting_title: 'Recording review',
          mid: null,
          evidence_text:
            'The recorder consistently misses the first twenty seconds of audio.',
          score: 1,
          score_breakdown: {
            fts_rank: 0,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
    );

    expect(prompt).toContain('synthesize and rephrase this healthy context');
    expect(prompt).toContain('Write like a thoughtful colleague');
    expect(prompt).toContain('natural, connected sentences');
    expect(prompt).toContain(
      'Cover the relevant decision, reason, owner, deadline, and next step',
    );
    expect(prompt).toContain(
      'a broad question should cover its material supported details',
    );
    expect(prompt).toContain('up to 260 words');
    expect(prompt).toContain('Make every point self-contained');
    expect(prompt).toContain('Address each distinct part of the user');
    expect(prompt).toContain(
      'instead of substituting adjacent project history',
    );
    expect(prompt).toContain('"an application"');
    expect(prompt).not.toContain('smallest set of directly supporting sources');
    expect(prompt).toContain('Provenance is attached by Pluto');
    expect(prompt).toContain(
      'Never begin with “Based on the meeting evidence provided”',
    );
    expect(prompt).toContain(
      'If you cannot confirm the answer from what was retrieved',
    );
    expect(prompt).toContain('“My interpretation is…”');
    expect(prompt).toContain(
      'distinguish your judgment from recorded facts in natural language',
    );
  });

  it('asks for a useful per-meeting breakdown when several meetings are in scope', () => {
    const context = Array.from({ length: 3 }, (_, index) => ({
      meeting_id: `meeting-${index}`,
      meeting_title: `Review ${index}`,
      mid: null,
      evidence_text: `[Occurred]: 2026-08-2${index}\n[Transcript]: Project ${index} was reviewed.`,
      score: 1,
      score_breakdown: {
        fts_rank: 0,
        graph_proximity: 0,
        recency_decay: 1,
        mention_weight: 0,
      },
    }));

    const prompt = getAskPlutoPrompt(
      'Show me a breakdown of my recent meetings',
      context,
      'factual',
    );

    expect(prompt).toContain('Cover each meeting that has meaningful evidence');
    expect(prompt).toContain('up to 260 words');
    expect(prompt).toContain('do not spend output on an uncited overview');
    expect(prompt).not.toContain('natural, connected sentences');
  });

  it('includes user corrections as constraints rather than meeting evidence', () => {
    const prompt = getAskPlutoPrompt(
      'Who owns pricing approval?',
      [],
      'factual',
      [],
      'These are explicit user corrections, not meeting evidence.\n1. Replace "Sam owns pricing approval" with "Alex owns pricing approval".',
    );

    expect(prompt).toContain('User corrections:');
    expect(prompt).toContain('Alex owns pricing approval');
    expect(prompt).toContain(
      'Never cite a user correction as meeting evidence',
    );
  });

  it('does not turn participation into ownership for assignee questions', () => {
    const prompt = getAskPlutoPrompt(
      'What else is assigned to Gamma?',
      [],
      'factual',
    );

    expect(prompt).toContain('Search every provided source');
    expect(prompt).toContain(
      'Separate items that explicitly name the person as owner from possible follow-ups',
    );
    expect(prompt).toContain(
      'Never convert participation, discussion, or an unnamed owner into an assignment',
    );

    const analyticalExpansion = getAskPlutoPrompt(
      'Tell me more about what is assigned to Jordan.',
      [],
      'factual',
      [],
      'None',
      'analysis',
    );
    expect(analyticalExpansion).toContain(
      'Provide a thoughtful evidence-grounded analysis',
    );
    expect(analyticalExpansion).toContain(
      'Never convert participation, discussion, or an unnamed owner into an assignment',
    );
  });

  it('gives analytical requests an evidence-safe reflection contract', () => {
    const prompt = getAskPlutoPrompt(
      'What could I have done better as a manager?',
      [],
      'factual',
      [],
      'None',
      'analysis',
    );

    expect(prompt).toContain(
      'Separate direct observations from interpretation',
    );
    expect(prompt).toContain('only when at least two sources support it');
    expect(prompt).toContain(
      'identify one primary theme only when multiple explicit signals converge',
    );
    expect(prompt).toContain('strengths as well as opportunities');
    expect(prompt).toContain('Prefix each recommendation with “Suggestion:”');
    expect(prompt).toContain('Never diagnose personality');
    expect(prompt).toContain('Use up to 300 words');
  });

  it('treats omitted draft statements as leads rather than meeting facts', () => {
    const prompt = getAskPlutoPrompt(
      'Find additional supported contributions by Alpha User.',
      [],
      'factual',
      [],
      'None',
      'analysis',
      {
        claims: ['Alpha requested a larger workspace.'],
        previousAnswer: 'Alpha asked about the kitchen table.',
      },
    );

    expect(prompt).toContain('They are search leads, not established facts');
    expect(prompt).toContain('Alpha requested a larger workspace.');
    expect(prompt).toContain('Do not repeat the previous answer');
    expect(prompt).toContain(
      'only additional details that this fresh context directly supports',
    );
    expect(prompt).toContain(
      'A participant list or calendar invitation does not prove who spoke',
    );
    expect(prompt).not.toContain('Prefix each recommendation');
    expect(prompt).toContain(
      'Do not conclude that the underlying source lacks the information',
    );
  });

  it('never places raw transcript passages inside the follow-up prompt budget', () => {
    const prompt = getAskPlutoPrompt(
      'Find another contribution.',
      [
        {
          meeting_id: 'meeting-1',
          meeting_title: 'Workspace review',
          mid: null,
          evidence_text: 'Old notes '.repeat(500),
          transcript_passages: [
            {
              quote: 'Alpha: We need a larger workspace.',
              speaker: 'Alpha',
              start_segment_index: 1,
              end_segment_index: 1,
              source_revision: 'revision-1',
              trust_status: 'grounded',
            },
          ],
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
      [],
      'None',
      'analysis',
      { claims: ['Alpha requested a larger workspace.'], previousAnswer: '' },
    );

    expect(prompt).not.toContain('Alpha: We need a larger workspace.');
    expect(prompt).toContain('Old notes');
  });

  it('keeps drafting conversational while grounding factual details', () => {
    const prompt = getAskPlutoPrompt(
      'Draft a short follow-up email about that.',
      [],
      'factual',
      [{ role: 'user', content: 'Use a warm but direct tone.' }],
      'None',
      'draft',
      {
        expansionReview: {
          previousAnswer: 'The pipeline is the most urgent item.',
        },
      },
    );

    expect(prompt).toContain('Write only the requested copy-ready draft');
    expect(prompt).toContain('Return exactly one draft');
    expect(prompt).toContain('Do not add a preface, commentary, options');
    expect(prompt).toContain('audience, goal, and tone');
    expect(prompt).toContain('every factual detail from the provided context');
    expect(prompt).toContain(
      'Do not include evidence-policy narration, context labels, or a sources section',
    );
    expect(prompt).not.toContain('CITATION RULES');
    expect(prompt).toContain('under 80 words');
    expect(prompt).toContain('Omit a sign-off for a chat message');
    expect(prompt).toContain('Use it only to identify the one item');
    expect(prompt).not.toContain(
      'Add useful supported context without repeating these sentences',
    );
  });

  it('bounds each source before sending it to the synchronous chat model', () => {
    const prompt = getAskPlutoPrompt(
      'What is the main topic?',
      [
        {
          meeting_id: 'meeting-1',
          meeting_title: 'Current meeting',
          evidence_text: `${'e'.repeat(5_000)}EVIDENCE_END`,
          mid: {
            topics: [{ name: `${'t'.repeat(1_000)}TOPIC_END` }],
            decisions: [{ description: `${'d'.repeat(1_000)}DECISION_END` }],
            action_items: [{ description: `${'a'.repeat(1_000)}ACTION_END` }],
          },
          score: 1,
          score_breakdown: {
            fts_rank: 0,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
    );

    expect(prompt).not.toContain('EVIDENCE_END');
    expect(prompt).not.toContain('TOPIC_END');
    expect(prompt).not.toContain('DECISION_END');
    expect(prompt).not.toContain('ACTION_END');
    expect(prompt.length).toBeLessThan(8_000);
  });

  it('includes executive chief of staff guidance for planning queries', () => {
    const prompt = getAskPlutoPrompt(
      'what should i focus on?',
      [],
      'analysis',
      [],
      'None',
      'analysis',
      { isPlanningQuery: true },
    );

    expect(prompt).toContain('Act as an executive Chief of Staff');
    expect(prompt).toContain('Immediate Priorities & Commitments');
    expect(prompt).toContain('Active Work Streams & Projects');
    expect(prompt).toContain('Open Loops & Attention Items');
    expect(prompt).toContain('Never quote conversational chit-chat');
  });

  it('includes attribution dispute instructions when user objects to attributed entity', () => {
    const prompt = getAskPlutoPrompt(
      'give me my accomplishments',
      [],
      'factual',
      [],
      'None',
      'lookup',
      { disputedEntity: 'Gamma' },
    );

    expect(prompt).toContain('ATTRIBUTION DISPUTE:');
    expect(prompt).toContain('NOT Gamma');
    expect(prompt).toContain('Do NOT attribute any claims to Gamma');
  });

  it('includes project context and grounding instructions when querying about a specific project', () => {
    const prompt = getAskPlutoPrompt(
      'what is the status of pluto?',
      [],
      'factual',
      [],
      'None',
      'lookup',
      {
        projectContext: {
          name: 'pluto',
          displayTitle: 'Pluto App',
          asOf: '2025-01-01T00:00:00Z',
          latestNoteAt: '2025-02-01T00:00:00Z',
        },
      },
    );

    expect(prompt).toContain('PROJECT CONTEXT & GROUNDING:');
    expect(prompt).toContain('Pluto App');
    expect(prompt).toContain('Clearly distinguish delivered milestones');
    expect(prompt).toContain(
      'A past target date does not prove a release slipped',
    );
    expect(prompt).toContain('last recorded state on that date');
    expect(prompt).toContain('before today');
    expect(prompt).toContain(
      'Do not turn its past follow-ups into actions due today',
    );
  });

  it('does not inject unrelated meeting-wide topics into a project section prompt', () => {
    const context = [
      {
        meeting_id: 'mixed-meeting',
        meeting_title: 'Weekly planning',
        mid: {
          title: 'Weekly planning',
          topics: [{ name: 'Unrelated certification program' }],
          decisions: [{ description: 'Approve an unrelated event' }],
          action_items: [{ description: 'Review an unrelated form' }],
        },
        evidence_kind: 'section',
        evidence_text:
          '[Project: Project Atlas]\n[Meeting date]: 2026-09-20\nThe Project Atlas pipeline is being prepared for release.',
        score: 1,
        score_breakdown: {
          fts_rank: 1,
          graph_proximity: 1,
          recency_decay: 1,
          mention_weight: 1,
        },
      },
    ];
    const prompt = getAskPlutoPrompt(
      'Tell me more about Project Atlas pipeline.',
      context as Parameters<typeof getAskPlutoPrompt>[1],
      'factual',
      [],
      'None',
      'analysis',
      { projectContext: { name: 'Project Atlas' } },
    );

    expect(prompt).toContain('Project Atlas pipeline is being prepared');
    expect(prompt).not.toContain('Unrelated certification program');
    expect(prompt).not.toContain('Approve an unrelated event');
    expect(prompt).not.toContain('Review an unrelated form');
  });

  it('reconsiders challenged answers without claiming bounded search proves absence', () => {
    const prompt = getAskPlutoPrompt(
      'That does not seem current. Reconsider it.',
      [],
      'factual',
      [],
      'None',
      'lookup',
      { conversationMode: 'challenge' },
    );

    expect(prompt).toContain('Re-evaluate the prior answer');
    expect(prompt).toContain('latest dated supported picture');
    expect(prompt).toContain(
      'Do not claim that newer notes do not exist just because this bounded search did not retrieve them',
    );
  });

  it('asks for a structured, human project briefing on analytical follow-ups', () => {
    const prompt = getAskPlutoPrompt(
      'Tell me more about Project Atlas.',
      [],
      'factual',
      [],
      'None',
      'analysis',
      {
        projectContext: {
          name: 'project-atlas',
          displayTitle: 'Project Atlas',
        },
        isPlanningQuery: true,
      },
    );

    expect(prompt).toContain('Answer the exact project question first');
    expect(prompt).toContain('do not fill a fixed template');
    expect(prompt).toContain('thoughtful collaborator');
    expect(prompt).toContain('Use up to 360 words');
    expect(prompt).toContain(
      'Omit unrelated agenda topics even when they came from the same contributing meeting',
    );
    expect(prompt).toContain(
      'If structure helps, use at most two short bold labels',
    );
    expect(prompt).not.toContain('**Where things stand**');
    expect(prompt).not.toContain('Act as an executive Chief of Staff');
    expect(prompt).not.toContain('Do not add headings');
  });

  it('lets the model interpret arbitrary follow-ups from structured active context', () => {
    const prompt = getAskPlutoPrompt(
      "I think you hovered over larger topics and didn't give enough detail.",
      [],
      'factual',
      [
        {
          role: 'user',
          content: 'Tell me more about Project Atlas.',
        },
        {
          role: 'assistant',
          content: 'The team generated 15 profiles.',
        },
      ],
      'None',
      'lookup',
      {
        activeConversationContext: {
          anchor: 'Tell me more about Project Atlas.',
          meetingIds: ['atlas-review'],
          topic: {
            kind: 'project',
            id: 'project-atlas',
            label: 'Project Atlas',
          },
        },
      },
    );

    expect(prompt).toContain('ACTIVE CONVERSATION CONTEXT:');
    expect(prompt).toContain('previous exchange was grounded in Project Atlas');
    expect(prompt).toContain(
      'continues, critiques, redirects, or asks to deepen',
    );
    expect(prompt).toContain('If the user clearly changed topics');
    expect(prompt).toContain('Do not require the user to use a special phrase');
    expect(prompt).toContain(
      'Do not introduce adjacent workstreams merely because they appear',
    );
    expect(prompt).toContain(
      'Treat the earlier answer as conversational orientation, not as evidence',
    );
  });

  it('keeps project relationships, attribution, and inferred expectations explicit', () => {
    const prompt = getAskPlutoPrompt(
      'What is needed for Beta Reviewer? Is it for Project Atlas, and who said it?',
      [],
      'factual',
      [],
      'None',
      'lookup',
    );

    expect(prompt).toContain('Preserve source boundaries');
    expect(prompt).toContain(
      'do not transfer a fact between people, projects, or initiatives',
    );
    expect(prompt).toContain('does not identify who said or assigned it');
    expect(prompt).toContain(
      'Participation or second-person wording does not prove ownership',
    );
    expect(prompt).toContain(
      'For inferred expectations, say “My interpretation is…” rather than “they expect”',
    );
    expect(prompt).toContain("separate Pluto's judgment from recorded facts");

    const expectationPrompt = getAskPlutoPrompt(
      'What do you think will satisfy Alpha Contact in terms of their expectations?',
      [],
      'factual',
      [],
      'None',
      'analysis',
    );
    expect(expectationPrompt).toContain('Begin with “My interpretation is…”');
    expect(expectationPrompt).toContain(
      'Use only synthesized context that explicitly names the person',
    );
    expect(prompt).toContain('Answer the attribution question directly');
    expect(prompt).toContain(
      'An action item addressed to “you” does not identify who created or assigned it',
    );
  });

  it('answers coaching follow-ups instead of repeating the priority inventory', () => {
    const prompt = getAskPlutoPrompt(
      'Do you have any feedback for me?',
      [],
      'factual',
      [
        {
          role: 'user',
          content: 'What should I focus on immediately?',
        },
        {
          role: 'assistant',
          content: 'Focus first on pipeline reliability.',
        },
      ],
      'None',
      'analysis',
      {
        expansionReview: {
          previousAnswer: 'Focus first on pipeline reliability.',
        },
        activeConversationContext: {
          anchor: 'What should I focus on immediately?',
          meetingIds: [],
        },
        isPlanningQuery: true,
      },
    );

    expect(prompt).toContain(
      'Answer the user’s current question about the earlier priority briefing',
    );
    expect(prompt).toContain('candid, constructive feedback');
    expect(prompt).toContain('two or three specific observations');
    expect(prompt).not.toContain(
      'Act as an executive Chief of Staff and strategic partner',
    );
  });

  it('enforces synthesized-only guidance and omits transcript passages', () => {
    const prompt = getAskPlutoPrompt(
      'Summarize our active priorities and roadmap',
      [
        {
          meeting_id: 'meeting-1',
          meeting_title: 'Roadmap review',
          mid: null,
          evidence_text: 'The team aligned on the mobile milestone.',
          transcript_passages: [
            {
              quote: 'Raw conversational chat that should be omitted',
              speaker: 'Sam',
              start_segment_index: 0,
              end_segment_index: 1,
              source_revision: 'rev-1',
              trust_status: 'grounded',
            },
          ],
          score: 1,
          score_breakdown: {
            fts_rank: 1,
            graph_proximity: 0,
            recency_decay: 1,
            mention_weight: 0,
          },
        },
      ],
      'factual',
      [],
      'None',
      'analysis',
      {
        omissionReview: {
          claims: ['Mobile milestone is prioritized'],
          previousAnswer: 'Previous answer text',
        },
      },
    );

    expect(prompt).toContain(
      'ONLY the synthesized meeting notes, people profiles, and project profiles in Context',
    );
    expect(prompt).toContain('[Source 1] Meeting: "Roadmap review"');
    expect(prompt).toContain('CITATION RULES');
    expect(prompt).toContain(
      'Never invent facts or use raw transcript dialogue.',
    );
    expect(prompt).not.toContain(
      'Raw conversational chat that should be omitted',
    );
  });
});
