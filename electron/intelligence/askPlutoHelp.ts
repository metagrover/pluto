// Product guidance lives here rather than being invented from meeting notes.
// Keep connection steps aligned with docs/chatgpt-connection.md and Settings.
export const buildPlutoHelpReply = (query: string): string | null => {
  const text = query.normalize('NFKC').replace(/[’]/g, "'").trim();
  const helpRequest =
    /\b(?:how (?:do|can|should|to)|help|set ?up|connect|troubleshoot|not working|doesn't work|won't work|where (?:is|are|can|do)|why)\b/i.test(
      text,
    );
  if (!helpRequest) return null;
  // A discussion about a feature in meeting evidence is still a meeting query.
  if (
    /\b(?:what did|who|decided|discussed|committed|assigned|said|last meeting|in (?:the|our|my) meeting|integration project|launch plan)\b/i.test(
      text,
    )
  )
    return null;

  if (
    /\bchat\s*gpt\b/i.test(text) &&
    /\b(?:connect\w*|setup|set ?up|plugin|access|integrat\w*|use)\b/i.test(text)
  ) {
    return 'To connect Pluto to ChatGPT on this Mac:\n\n1. Open **Settings → Advanced → ChatGPT connection**. Allow meeting-note access, then click **Connect to ChatGPT**.\n2. Fully quit ChatGPT (⌘Q) and reopen it to load the plugin.\n3. In Pluto, click **Start a ChatGPT chat**. In the new Work chat, type **@** and select **Pluto** (or **Pluto (Development)** for a development build).\n\nKeep Pluto running with access enabled. You need ChatGPT Desktop with local plugin support. Retrieved notes are sent to OpenAI; raw transcripts and audio are not shared.\n\nIf it still fails, tell me the connection status or error shown in Settings.\n\n[Open ChatGPT connection settings](/settings/advanced)';
  }
  if (
    /\b(?:start|record|recording|capture)\b/i.test(text) &&
    /\b(?:record\w*|audio|microphone)\b/i.test(text)
  ) {
    return 'To record a meeting, use the recording button in Pluto’s sidebar. Allow microphone and system-audio access when macOS asks. Stop recording when the meeting ends; Pluto then processes the transcript and notes.\n\nIf recording will not start, tell me the error you see and whether microphone or system audio is affected.\n\n[Open meeting settings](/settings/meetings)';
  }
  if (
    /\bmeetings?\b/i.test(text) &&
    /\b(?:missing|showing|show up|appear|see|find)\b/i.test(text) &&
    /\b(?:not|aren't|isn't|can't|missing|don't)\b/i.test(text)
  ) {
    return 'Where are the meetings missing: Pluto’s meeting list or ChatGPT?\n\nIn Pluto, check the meeting list and any active search or filters. In ChatGPT, keep the Pluto installation containing your meetings running with note access enabled, then start a new Work chat and select its Pluto plugin with **@**. Development and release builds have separate plugins.\n\nI can’t determine the cause from this question alone. Tell me which screen is empty and any connection error shown.\n\n[Open ChatGPT connection settings](/settings/advanced)';
  }
  if (
    /\b(?:settings?|permissions?)\b/i.test(text) ||
    (/\bpluto\b/i.test(text) &&
      /\b(?:setup|set ?up|install\w*|connect\w*|configur\w*|error|not working)\b/i.test(
        text,
      ))
  ) {
    return 'Which Pluto setting or step is giving you trouble? Tell me what you’re trying to do and the status or error shown, and I can help you work through it.\n\n[Open Pluto settings](/settings/advanced)';
  }
  return null;
};
