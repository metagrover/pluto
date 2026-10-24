import { invokeNotesAction, invokeNotesConnection } from './notesConnection';

export const getClaudeConnectionStatus = () =>
  invokeNotesConnection('PLUTO_CLAUDE_GET_STATUS');
export const setClaudeConnectionEnabled = (enabled: boolean) =>
  invokeNotesConnection('PLUTO_CLAUDE_SET_ENABLED', { enabled });
export const openClaude = () => invokeNotesAction('PLUTO_CLAUDE_OPEN');
export const openClaudeSetupGuide = () =>
  invokeNotesAction('PLUTO_CLAUDE_OPEN_SETUP_GUIDE');
