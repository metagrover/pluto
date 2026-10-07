import { parseSlashCommand } from './slashCommands';

// Disabled after live Phi acceptance checks; specific questions remain in beta.
export const LIVE_MEETING_COMMANDS: ReadonlyArray<{
  name: string;
  description: string;
  task: 'recap' | 'catch_up' | 'decision' | 'action' | 'advice';
  question: string;
}> = [];

export const LIVE_MEETING_SHORTCUT_HELP = LIVE_MEETING_COMMANDS.length
  ? `Unknown shortcut. Try ${LIVE_MEETING_COMMANDS.map((command) => command.name).join(', ')}.`
  : 'Shortcuts are unavailable in this beta. Ask a specific question about this meeting.';

export const parseLiveMeetingCommand = (input: string) => {
  const result = parseSlashCommand(input, LIVE_MEETING_COMMANDS);
  if (result.kind !== 'command') return result;
  return {
    ...result,
    question: result.argument
      ? `${result.command.question} Additional request: ${result.argument}`
      : result.command.question,
  };
};
