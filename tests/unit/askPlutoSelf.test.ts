import { describe, expect, it } from 'vitest';

import {
  addressConfirmedSelf,
  resolveAskPlutoSelfReference,
} from '../../electron/intelligence/askPlutoSelf';

describe('Ask Pluto confirmed self reference', () => {
  it('resolves personal questions to the confirmed name for retrieval', () => {
    expect(
      resolveAskPlutoSelfReference(
        'Summarize my recent contributions',
        'Punit Grover',
      ),
    ).toMatchObject({
      refersToSelf: true,
      retrievalQuery: "Summarize Punit Grover's recent contributions",
    });
    expect(
      resolveAskPlutoSelfReference('What did I ask about?', 'Punit Grover')
        .retrievalQuery,
    ).toBe('What did Punit Grover ask about?');
  });

  it('recognizes the confirmed name and aliases without changing unrelated topics', () => {
    expect(
      resolveAskPlutoSelfReference(
        "Summarize Punit Grover's recent contributions",
        'Punit Grover',
      ).refersToSelf,
    ).toBe(true);
    expect(
      resolveAskPlutoSelfReference('What did PG decide?', 'Punit Grover', [
        'PG',
      ]),
    ).toMatchObject({
      refersToSelf: true,
      retrievalQuery: 'What did Punit Grover decide?',
    });
    expect(
      resolveAskPlutoSelfReference(
        'What do you know about me?',
        'Punit Grover',
      ),
    ).toMatchObject({
      refersToSelf: true,
      retrievalQuery: 'What do you know about Punit Grover?',
    });
    expect(
      resolveAskPlutoSelfReference(
        'Tell me more about the layout',
        'Punit Grover',
      ).refersToSelf,
    ).toBe(false);
  });

  it('requires a confirmed identity for personal attribution', () => {
    expect(resolveAskPlutoSelfReference('What did I say?')).toMatchObject({
      refersToSelf: true,
      retrievalQuery: 'What did I say?',
    });
    expect(
      resolveAskPlutoSelfReference('Who am I?', 'Punit Grover'),
    ).toMatchObject({
      refersToSelf: true,
      asksIdentity: true,
    });
  });

  it('addresses already validated third-person answers directly', () => {
    expect(
      addressConfirmedSelf(
        "Punit Grover asked about the table. Punit Grover's feedback was recorded.\n- Punit Grover was assigned a task.",
        'Punit Grover',
      ),
    ).toBe(
      'You asked about the table. Your feedback was recorded.\n- You were assigned a task.',
    );
    expect(
      addressConfirmedSelf('Sam asked about the table.', 'Punit Grover'),
    ).toBe('Sam asked about the table.');
  });

  it('addresses repeated third-person mentions in a general meeting summary', () => {
    const question = 'What happened in the planning meeting?';
    expect(
      resolveAskPlutoSelfReference(question, 'Avery Chen').refersToSelf,
    ).toBe(false);
    expect(
      addressConfirmedSelf(
        'During the meeting, Avery Chen asked where to set up. Avery Chen also asked about the schedule. Avery Chen noted that the room was small.',
        'Avery Chen',
      ),
    ).toBe(
      'During the meeting, you asked where to set up. You also asked about the schedule. You noted that the room was small.',
    );
  });
});
