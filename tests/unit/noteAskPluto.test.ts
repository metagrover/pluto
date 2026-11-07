import { describe, expect, it } from 'vitest';
import {
  NOTE_ASK_PLUTO_LIMITS,
  buildNoteAskPlutoPrompt,
  describeNoteAskPlutoFailure,
  generateWithMemoryFallback,
  noteContentForPrompt,
  parseNoteAskPlutoRequest,
  parseSuggestedTasks,
} from '../../electron/intelligence/noteAskPluto';

const valid = {
  requestId: 'note-ask-1',
  noteId: 'note-1',
  intent: 'ask',
  query: 'What did we decide?',
};

describe('parseNoteAskPlutoRequest', () => {
  it('keeps only ChatGPT as a one-question answer choice', () => {
    const chosen = parseNoteAskPlutoRequest({
      ...valid,
      answerWith: 'chatgpt',
    });
    expect(chosen.ok && chosen.request.answerWith).toBe('chatgpt');
    const other = parseNoteAskPlutoRequest({ ...valid, answerWith: 'gemini' });
    expect(other.ok && 'answerWith' in other.request).toBe(false);
  });

  it('accepts a well-formed request and trims the query', () => {
    const result = parseNoteAskPlutoRequest({ ...valid, query: '  Why?  ' });
    expect(result).toEqual({
      ok: true,
      request: { ...valid, query: 'Why?' },
    });
  });

  it('allows an empty query for quick actions but not for free questions', () => {
    expect(
      parseNoteAskPlutoRequest({ ...valid, intent: 'summarize', query: '' }).ok,
    ).toBe(true);
    expect(parseNoteAskPlutoRequest({ ...valid, query: '  ' }).ok).toBe(false);
  });

  it('rejects unknown intents, bad ids and oversized input', () => {
    expect(parseNoteAskPlutoRequest({ ...valid, intent: 'delete' }).ok).toBe(
      false,
    );
    expect(parseNoteAskPlutoRequest({ ...valid, noteId: 'a b' }).ok).toBe(
      false,
    );
    expect(
      parseNoteAskPlutoRequest({
        ...valid,
        selection: 'x'.repeat(NOTE_ASK_PLUTO_LIMITS.selectionChars + 1),
      }).ok,
    ).toBe(false);
    expect(
      parseNoteAskPlutoRequest({
        ...valid,
        turns: Array.from({ length: 7 }, () => ({
          role: 'user',
          content: 'hi',
        })),
      }).ok,
    ).toBe(false);
  });
});

describe('buildNoteAskPlutoPrompt', () => {
  const note = {
    title: 'Offsite',
    targetName: 'Maya',
    content: 'Ship sync first.\n[task: Send roadmap]\n[task:done: Book room]',
  };

  it('grounds the prompt in the note and spells out task state', () => {
    const prompt = buildNoteAskPlutoPrompt({
      note,
      request: { ...valid, intent: 'ask' } as never,
      today: new Date('2026-11-03T12:00:00Z'),
    });
    expect(prompt).toContain('Use only the note below');
    expect(prompt).toContain('<note title="Offsite" linked_to="Maya">');
    expect(prompt).toContain('- [ ] (task) Send roadmap');
    expect(prompt).toContain('- [x] (task) Book room');
    expect(prompt).toContain('Today is 2026-11-03.');
    expect(prompt).toContain('User: What did we decide?');
  });

  it('focuses on the selection and fills in quick-action questions', () => {
    const prompt = buildNoteAskPlutoPrompt({
      note,
      request: {
        ...valid,
        intent: 'summarize',
        query: '',
        selection: 'Ship sync first.',
      } as never,
    });
    expect(prompt).toContain('<selection>\nShip sync first.\n</selection>');
    expect(prompt).toContain('User: Summarize this note.');
  });

  it('adds recent meetings with the person, named so answers can cite them', () => {
    const prompt = buildNoteAskPlutoPrompt({
      note,
      request: { ...valid, intent: 'ask' } as never,
      relatedMeetings: [
        {
          title: 'Maya / me 1:1',
          date: 'Oct 30',
          notes: 'Maya owns the roadmap.',
        },
        { title: 'Empty', date: null, notes: '   ' },
        { title: 'Kickoff', date: 'Oct 1', notes: 'Scope agreed.' },
        { title: 'Planning', date: 'Sep 20', notes: 'Budget set.' },
        { title: 'Too many', date: 'Sep 1', notes: 'Dropped.' },
      ],
    });
    expect(prompt).toContain('the recent meetings with Maya');
    expect(prompt).toContain('[Maya / me 1:1]');
    expect(prompt).toContain(
      '<meeting name="Maya / me 1:1, Oct 30">\nMaya owns the roadmap.\n</meeting>',
    );
    expect(prompt).not.toContain('name="Empty"');
    expect(prompt).toContain('name="Planning, Sep 20"');
    expect(prompt).not.toContain('Too many');
    expect(prompt).not.toContain('Use only the note below');
  });
});

describe('parseSuggestedTasks', () => {
  it('reads bullet and numbered lines and skips tasks already in the note', () => {
    const answer = [
      'Here are the follow-ups:',
      '- **Send roadmap**',
      '* Confirm launch date with design.',
      '2. Draft pricing options',
      '- Confirm launch date with design',
    ].join('\n');
    expect(parseSuggestedTasks(answer, 'Notes\n[task: Send roadmap]')).toEqual([
      'Confirm launch date with design',
      'Draft pricing options',
    ]);
  });

  it('returns nothing when the model has no new tasks', () => {
    expect(parseSuggestedTasks('No new tasks.')).toEqual([]);
  });

  it('keeps note lines other than tasks unchanged for the prompt', () => {
    expect(noteContentForPrompt('# Title\n- [ ] Check')).toBe(
      '# Title\n- [ ] Check',
    );
  });
});

describe('describeNoteAskPlutoFailure', () => {
  it('names memory pressure from the local model guard', () => {
    const error = new Error('Not enough free memory to load the model.');
    error.name = 'LocalModelMemoryError';
    const result = describeNoteAskPlutoFailure(error);
    expect(result.error).toContain('low on memory');
    expect(result.detail).toBe(
      'LocalModelMemoryError: Not enough free memory to load the model.',
    );
  });

  it('separates an unreachable model from timeouts', () => {
    expect(
      describeNoteAskPlutoFailure(new TypeError('fetch failed')).error,
    ).toContain('could not reach your AI model');
    const timeout = new Error('The operation timed out.');
    timeout.name = 'TimeoutError';
    expect(describeNoteAskPlutoFailure(timeout).error).toContain(
      'took too long',
    );
  });

  it('keeps the detail short and on one line', () => {
    const { detail } = describeNoteAskPlutoFailure(
      new Error(`line one\nline two ${'x'.repeat(400)}`),
    );
    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(240);
  });
});

describe('generateWithMemoryFallback', () => {
  const memoryError = () => {
    const error = new Error('Not enough memory to safely load the model.');
    error.name = 'LocalModelMemoryError';
    return error;
  };

  it('answers with the quick model when memory protection refuses the main one', async () => {
    const result = await generateWithMemoryFallback({
      primary: async () => {
        throw memoryError();
      },
      fallback: async () => 'Quick answer',
      canFallBack: () => true,
    });
    expect(result).toEqual({ answer: 'Quick answer', usedFallback: true });
  });

  it('uses the main model when it loads', async () => {
    const result = await generateWithMemoryFallback({
      primary: async () => 'Full answer',
      fallback: async () => 'Quick answer',
      canFallBack: () => true,
    });
    expect(result).toEqual({ answer: 'Full answer', usedFallback: false });
  });

  it('does not fall back for other errors, without a quick model, or after output started', async () => {
    const quick = async () => 'Quick answer';
    await expect(
      generateWithMemoryFallback({
        primary: async () => {
          throw new TypeError('fetch failed');
        },
        fallback: quick,
        canFallBack: () => true,
      }),
    ).rejects.toThrow('fetch failed');
    await expect(
      generateWithMemoryFallback({
        primary: async () => {
          throw memoryError();
        },
        fallback: null,
        canFallBack: () => true,
      }),
    ).rejects.toThrow('Not enough memory');
    await expect(
      generateWithMemoryFallback({
        primary: async () => {
          throw memoryError();
        },
        fallback: quick,
        canFallBack: () => false,
      }),
    ).rejects.toThrow('Not enough memory');
  });
});

it('omits non-actionable and completed bullets from task suggestions', () => {
  expect(
    parseSuggestedTasks(
      '- No new tasks.\n- The launch is on Friday.\n- Review the proposed changes below.\n- [x] Send the old proposal\n- Send the approved proposal to Finance.',
    ),
  ).toEqual(['Send the approved proposal to Finance']);
});
