export interface SlashCommandDefinition {
  name: string;
  description: string;
}

/** Parse only a command at the start of a message; each surface supplies its catalog. */
export const parseSlashCommand = <T extends SlashCommandDefinition>(
  input: string,
  commands: readonly T[],
) => {
  const match = input.trim().match(/^(\/[^\s]*)(?:\s+([\s\S]*))?$/);
  if (!match) return { kind: 'none' as const };
  const command = commands.find((item) => item.name === match[1].toLowerCase());
  return command
    ? { kind: 'command' as const, command, argument: (match[2] || '').trim() }
    : { kind: 'unknown' as const, name: match[1] };
};
