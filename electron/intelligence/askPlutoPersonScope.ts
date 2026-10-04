import type { AskPlutoResearchTask } from './askPlutoConversation';

export const shouldUsePersonFocusedEvidence = (
  query: string,
  task: AskPlutoResearchTask,
  inheritedPersonScope = false,
): boolean => {
  if (task === 'draft') return false;
  if (
    /\b(?:what(?:'s| is)|what does)\s+.{1,80}\s+(?:working on|focused on|doing|work on|focus on|do|own|expect)\b|\b(?:what is assigned to|who (?:said|asked|requested|assigned|decided)|tell me about|who is)\b|\bwhat do you think (?:will|would) satisfy\b|\b(?:his|her|their|[\p{L}'-]+(?:'s|’s)) expectations?\b/iu.test(
      query,
    )
  )
    return true;
  if (
    /\b(?:present|show|demonstrate|send|share)\b[\s\S]{0,60}\bto\b|\b(?:prepare|prep|onboarding)\b[\s\S]{0,80}\b(?:meeting|session|with|for)\b/i.test(
      query,
    )
  )
    return false;
  return inheritedPersonScope;
};
