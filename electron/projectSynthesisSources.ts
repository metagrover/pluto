import { setImmediate } from 'node:timers/promises';
import type { ProjectThemeSource } from './projectThemeSynthesis';

export async function collectProjectSynthesisSources<Meeting>({
  listMeetings,
  buildSource,
  shouldContinue,
}: {
  listMeetings: () => Meeting[];
  buildSource: (meeting: Meeting) => ProjectThemeSource | null;
  shouldContinue: () => boolean;
}): Promise<ProjectThemeSource[] | null> {
  if (!shouldContinue()) return null;
  const sources: ProjectThemeSource[] = [];
  for (const meeting of listMeetings()) {
    if (!shouldContinue()) return null;
    const source = buildSource(meeting);
    if (source) sources.push(source);
    // Source projection performs synchronous DB work; keep IPC responsive.
    await setImmediate();
  }
  return shouldContinue() ? sources : null;
}
