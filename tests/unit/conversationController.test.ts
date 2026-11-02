import { describe, expect, it } from 'vitest';
import {
  buildConversationBoundaryReply,
  buildConversationalReplyPrompt,
  buildNamedPersonNoEvidenceReply,
  buildNoEvidenceDraftReply,
  buildSocialReply,
  decideConversationTurn,
  isDialogueOnlyClarification,
  isExplicitInformationRequest,
  parseConversationActionProposal,
} from '../../electron/intelligence/conversationController';

describe('conversation controller', () => {
  it('drafts a neutral check-in after no evidence without inventing a prior item', () => {
    const reply = buildNoEvidenceDraftReply(
      'Draft a short message to Morgan about it.',
    );
    expect(reply).toContain('Hi Morgan');
    expect(reply).not.toContain('Subject:');
    expect(reply).not.toContain('previous conversation');
  });
  it('asks for the recipient when a no-evidence draft has no addressee', () => {
    expect(buildNoEvidenceDraftReply('Draft a message about it.')).toContain(
      'Who should the message go to',
    );
  });
  it('keeps a missing person requirement distinct from a missing attribution', () => {
    expect(
      buildNamedPersonNoEvidenceReply(
        'What is needed for Beta Reviewer?',
        'Beta Reviewer',
      ),
    ).toContain('specific requirement for Beta Reviewer');
    expect(
      buildNamedPersonNoEvidenceReply(
        'Who said we need to present this to Beta Reviewer?',
        'Beta Reviewer',
      ),
    ).toContain('does not identify who said that');
    expect(
      buildNamedPersonNoEvidenceReply(
        'What is needed for Beta Reviewer, and who said it?',
        'Beta Reviewer',
      ),
    ).toContain('does not identify a requirement for Beta Reviewer');
  });
  it('builds a dialogue-first prompt for a conversation-only turn', () => {
    const prompt = buildConversationalReplyPrompt({
      query: 'Nothing at this time.',
      turns: [
        { role: 'user', content: 'Hi', turnMode: 'social' },
        {
          role: 'assistant',
          content: 'Hello. What would be useful to work through?',
          turnMode: 'social',
        },
        { role: 'user', content: "Thanks, that'd be all." },
        {
          role: 'assistant',
          content: "Anytime. I'll be here when you need me.",
          turnMode: 'social',
        },
      ],
    });

    expect(prompt).toContain("User: Thanks, that'd be all.");
    expect(prompt).toContain('User: Nothing at this time.');
    expect(prompt).toContain(
      'If the user is ending or pausing the conversation, close naturally and do not ask another question.',
    );
    expect(prompt).toContain(
      'do not search, cite, or invent meeting, project, or people information',
    );
    expect(prompt).toContain('Prefer conversational understatement');
    expect(prompt).toContain(
      'The latest message closes or pauses the conversation.',
    );
  });

  it.each([
    'Nothing at this time.',
    'Not right now',
    "That's all",
    'All good for now.',
  ])('treats a general conversation closing as social: %s', (query) => {
    expect(decideConversationTurn({ query, hasPriorAssistant: true })).toEqual({
      mode: 'social',
      retrieval: 'none',
      usesPriorTurn: true,
    });
  });

  it('keeps a first-turn greeting out of retrieval', () => {
    expect(
      decideConversationTurn({
        query: 'Hello!',
        hasPriorAssistant: false,
      }),
    ).toEqual({
      mode: 'social',
      retrieval: 'none',
      usesPriorTurn: false,
    });
  });

  it('answers trivial conversation boundaries without invoking a model', () => {
    expect(buildConversationBoundaryReply('Hi')).toBe(
      'Hey — what’s on your mind?',
    );
    expect(buildConversationBoundaryReply("Thanks, that's all.")).toBe(
      'Got it — take care.',
    );
    expect(buildConversationBoundaryReply("Thanks, that'd be all.")).toBe(
      'Got it — take care.',
    );
    expect(buildConversationBoundaryReply('Nothing at this time.')).toBe(
      'Got it — take care.',
    );
    expect(buildConversationBoundaryReply('That is a great insight.')).toBe(
      null,
    );
  });

  it.each([
    ['That is a great insight.', 'social', 'none'],
    ['Thanks, that was helpful.', 'social', 'none'],
    ['What do you mean by that?', 'clarify', 'reuse'],
    ["I'm not convinced that is right.", 'challenge', 'fresh'],
    ["No, that's incorrect.", 'challenge', 'fresh'],
    ['No, that’s wrong.', 'challenge', 'fresh'],
    ["That's not correct.", 'challenge', 'fresh'],
    ['Tell me more in detail.', 'expand', 'fresh'],
    ['Draft a follow-up email from that.', 'draft', 'reuse'],
    ['Save that as a note.', 'act', 'reuse'],
    ['Separately, what changed on Project Atlas?', 'topic_switch', 'fresh'],
    ['What changed on Project Atlas?', 'lookup', 'fresh'],
    ['What is wrong with the design?', 'lookup', 'fresh'],
  ] as const)('routes %s as %s with %s retrieval', (query, mode, retrieval) => {
    expect(
      decideConversationTurn({ query, hasPriorAssistant: true }),
    ).toMatchObject({ mode, retrieval });
  });

  it('does not mistake a request containing praise for a social-only turn', () => {
    expect(
      decideConversationTurn({
        query: 'Great insight. Can you explain why it matters?',
        hasPriorAssistant: true,
      }).retrieval,
    ).not.toBe('none');
  });

  it.each([
    ['Great, explain the tradeoffs.', 'lookup', 'fresh'],
    ['I would like more detail about the release.', 'lookup', 'fresh'],
    ['Thanks, but the release was completed yesterday.', 'challenge', 'fresh'],
    ['Create a summary of this discussion.', 'draft', 'reuse'],
    ['Compare this with our other projects.', 'lookup', 'reuse'],
  ] as const)(
    'treats %s as a substantive %s turn',
    (query, mode, retrieval) => {
      expect(
        decideConversationTurn({ query, hasPriorAssistant: true }),
      ).toMatchObject({
        mode,
        retrieval,
      });
    },
  );

  it('separates clear information requests from ambiguous statements', () => {
    expect(isExplicitInformationRequest('What should I focus on?')).toBe(true);
    expect(isExplicitInformationRequest('Tell me about the release')).toBe(
      true,
    );
    expect(isExplicitInformationRequest('Nothing at this time.')).toBe(false);
    expect(isExplicitInformationRequest('Great, explain the tradeoffs.')).toBe(
      true,
    );
    expect(
      isExplicitInformationRequest(
        'I would like more detail about the release.',
      ),
    ).toBe(true);
    expect(isExplicitInformationRequest('Project Atlas')).toBe(false);
    expect(isExplicitInformationRequest('what can you help me with?')).toBe(
      false,
    );
    expect(isExplicitInformationRequest('who are you?')).toBe(false);
    expect(isExplicitInformationRequest('how can you help?')).toBe(false);
  });

  it.each([
    'what can you help me with?',
    'What can you do?',
    'Hi Pluto, how can you help me?',
    'Tell me about yourself.',
    'Who are you?',
  ])('answers a capability question directly: %s', (query) => {
    expect(decideConversationTurn({ query, hasPriorAssistant: false })).toEqual(
      {
        mode: 'social',
        retrieval: 'none',
        usesPriorTurn: false,
      },
    );
    expect(buildConversationBoundaryReply(query)).toContain(
      'synthesized meeting notes',
    );
    expect(buildSocialReply({ query })).toContain('synthesized meeting notes');
  });

  it.each([
    'Can you help me find decisions about Atlas?',
    'What can you tell me about the release?',
    'Tell me about your meeting with Morgan.',
    'Who are you meeting with tomorrow?',
    'Hi, summarize the release discussion.',
    'Thanks, what are my next steps?',
  ])('keeps a substantive request out of capability replies: %s', (query) => {
    expect(isExplicitInformationRequest(query)).toBe(true);
    expect(
      decideConversationTurn({ query, hasPriorAssistant: true }).mode,
    ).not.toBe('social');
    expect(buildConversationBoundaryReply(query)).toBeNull();
  });

  it('does not replace an unanswered clarification with a capability menu', () => {
    expect(buildSocialReply({ query: 'What do you mean by that?' })).toBe(
      "I couldn't finish that reply just now. Please try again.",
    );
  });

  it.each(['What do you mean by that?', 'Can you clarify?', 'Explain that.'])(
    'keeps a dialogue-only clarification in context: %s',
    (query) => {
      expect(isDialogueOnlyClarification(query)).toBe(true);
    },
  );
  it.each([
    'Can you clarify the Orion launch decision?',
    'Help me understand the hiring restrictions',
  ])(
    'allows a clarification with its own subject to retrieve evidence: %s',
    (query) => {
      expect(isDialogueOnlyClarification(query)).toBe(false);
      expect(
        decideConversationTurn({ query, hasPriorAssistant: true }),
      ).toMatchObject({ mode: 'lookup', retrieval: 'fresh' });
    },
  );

  it('grounds a social reply in the prior answer without retrieving again', () => {
    expect(
      buildSocialReply({
        query: 'That is a great insight.',
        previousAnswer:
          'The release risk is the handoff between the pilot and production.',
      }),
    ).toContain('handoff between the pilot and production');
  });

  it('does not echo assistant-introduction boilerplate as a takeaway', () => {
    expect(
      buildSocialReply({
        query: 'That is a great insight.',
        previousAnswer:
          "Hi! I'm Pluto, your AI meeting assistant. Ask me anything about your meeting history.",
      }),
    ).toBe(
      "Ha — I'll take the compliment, but we haven't gotten to an insight yet. What do you want to dig into?",
    );
  });

  it('does not invent a takeaway from a prior social turn', () => {
    expect(
      buildSocialReply({
        query: 'That is a great insight.',
        previousAnswer: 'Happy to help.',
        previousTurnMode: 'social',
      }),
    ).toBe(
      "Ha — I'll take the compliment, but we haven't gotten to an insight yet. What do you want to dig into?",
    );
  });

  it('does not mistake a dated-status caveat for the insight being praised', () => {
    expect(
      buildSocialReply({
        query: 'That is a useful insight.',
        previousAnswer:
          "I can't verify its status today. The newest project note I found is from Sep 20.",
      }),
    ).toBe("I'm glad it helped.");
  });

  it('prepares an explicit commitment for confirmation', () => {
    expect(
      parseConversationActionProposal(
        'Create a commitment to send the release note tomorrow.',
      ),
    ).toEqual({
      kind: 'create_commitment',
      text: 'send the release note tomorrow',
      label: 'Add commitment',
    });
    expect(parseConversationActionProposal('Save that.')).toBeNull();
  });
});
