import { describe, expect, it } from 'vitest';
import {
  classifyLiveMeetingQuery,
  createLiveMeetingContextIndex,
} from '../../electron/intelligence/liveMeetingContextIndex';
import {
  LIVE_MEETING_COMMANDS,
  LIVE_MEETING_SHORTCUT_HELP,
  parseLiveMeetingCommand,
} from '../../src/utils/liveMeetingCommands';
import { parseSlashCommand } from '../../src/utils/slashCommands';

describe('live meeting beta shortcut gate', () => {
  it('does not advertise shortcuts that failed acceptance', () => {
    expect(LIVE_MEETING_COMMANDS).toHaveLength(0);
    expect(LIVE_MEETING_SHORTCUT_HELP).toContain('unavailable in this beta');
    expect(LIVE_MEETING_SHORTCUT_HELP).toContain('specific question');
  });
  it.each(['/recap', '/catch-me-up', '/decisions', '/actions', '/ask-next'])(
    'does not recognize the retired shortcut %s',
    (name) => {
      expect(parseLiveMeetingCommand(name).kind).toBe('unknown');
      expect(parseLiveMeetingCommand(`${name} about the workshop`).kind).toBe(
        'unknown',
      );
    },
  );
  it('keeps other chat catalogs independent and preserves arguments', () => {
    const people = [{ name: '/brief', description: 'Person brief' }];
    const workspace = [{ name: '/recap', description: 'Workspace overview' }];
    expect(parseSlashCommand('  /BRIEF  recent work  ', people)).toMatchObject({
      kind: 'command',
      argument: 'recent work',
    });
    expect(parseSlashCommand('/recap', workspace).kind).toBe('command');
    expect(parseLiveMeetingCommand('/recap').kind).toBe('unknown');
    expect(parseSlashCommand('/brief', workspace).kind).toBe('unknown');
    expect(
      parseSlashCommand('How does /recap work?', LIVE_MEETING_COMMANDS).kind,
    ).toBe('none');
  });
  it('preserves specific questions and requested time ranges', () => {
    const index = createLiveMeetingContextIndex();
    index.ingest(
      'm',
      Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        speaker: 'Me',
        timestampMs: i * 60000,
        confirmed: true,
        text: `We discussed workshop topic ${i}.`,
      })),
    );
    expect(
      parseLiveMeetingCommand('What did we say about the venue?').kind,
    ).toBe('none');
    expect(classifyLiveMeetingQuery('Summarize this meeting so far.')).toBe(
      'meeting_summary',
    );
    expect(
      index.select('m', 'Catch me up on the recent discussion.').temporalRange
        ?.startMs,
    ).toBe(7 * 60000);
    expect(
      index.select('m', 'Catch me up on the last 5 minutes').temporalRange
        ?.startMs,
    ).toBe(5 * 60000);
  });
});
