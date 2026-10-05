import { describe, expect, it } from 'vitest';
import { buildPlutoHelpReply } from '../../electron/intelligence/askPlutoHelp';

describe('Ask Pluto product help', () => {
  it.each([
    'How do I make the chat GPT connection work here?',
    'Help me connect Pluto to ChatGPT',
    'Why is my ChatGPT connection not working?',
    'How do I use ChatGPT with Pluto?',
  ])('answers connection setup from product guidance: %s', (query) => {
    const answer = buildPlutoHelpReply(query);
    expect(answer).toContain('Settings → Advanced → ChatGPT connection');
    expect(answer).toContain('Fully quit ChatGPT');
    expect(answer).toContain('type **@**');
    expect(answer).toContain('Retrieved notes are sent to OpenAI');
    expect(answer).toContain('(/settings/advanced)');
    expect(answer).not.toMatch(/confirm your identity|API key|tunnel/i);
  });

  it('answers recording setup and asks for the actual error on failure', () => {
    const answer = buildPlutoHelpReply('How do I start recording?');
    expect(answer).toContain('sidebar');
    expect(answer).toContain('microphone and system-audio access');
    expect(answer).toContain('tell me the error');
    expect(answer).toContain('(/settings/meetings)');
  });

  it('does not invent a cause for missing meetings', () => {
    const answer = buildPlutoHelpReply('Why aren’t my meetings showing up?');
    expect(answer).toContain('Pluto’s meeting list or ChatGPT');
    expect(answer).toContain('can’t determine the cause');
  });

  it('asks for a specific setting when guidance is missing', () => {
    expect(
      buildPlutoHelpReply('How do I configure Pluto shortcuts?'),
    ).toContain('Which Pluto setting or step');
    expect(buildPlutoHelpReply('How do I change my settings?')).toContain(
      'Which Pluto setting or step',
    );
  });

  it.each([
    'What did I commit to?',
    'What feedback did I receive?',
    'How did we decide to connect ChatGPT in the last meeting?',
    'What did we discuss about Pluto settings?',
    'How do we connect the ChatGPT integration project to the launch plan?',
    'Summarize my meetings this week',
  ])('leaves meeting and project questions for retrieval: %s', (query) => {
    expect(buildPlutoHelpReply(query)).toBeNull();
  });
});
