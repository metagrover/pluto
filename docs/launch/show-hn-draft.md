# Show HN draft

## Title (pick one, all under 80 characters)

1. Show HN: Pluto – Open-source Granola alternative that turns meetings into tasks
2. Show HN: Pluto – Private meeting notes for Mac with a built-in task list
3. Show HN: Pluto – Local, open-source meeting notes that track what you promised

Recommended: **1**. It names a product readers already know, then says what's different.

**URL:** https://github.com/metagrover/pluto

## Text

Hi HN, I built Pluto, a meeting notes app for Mac. No bot joins your call, and it's free and open source under the MIT license.

I tried a few meeting notetakers and kept hitting the same problem: I'd get a nice summary and then forget what I'd agreed to do. The notes ended up in one app and my tasks in another, with nothing connecting them. So in Pluto the follow-ups from a meeting go on the same task list as the to-dos you write yourself. You can ask "what do I owe Sam?" and get an answer that links back to the transcript it came from.

How it works:

- It records your mic and system audio, so it works with Zoom, Meet, Teams or anything else that plays sound.
- Transcription always runs on your Mac. It uses NVIDIA's Parakeet TDT 0.6B v3 model through FluidAudio, in a native Swift runtime. Speaker diarization runs locally too, and Voice ID can recognize people you've confirmed before.
- For summaries and Q&A you choose the model: local models through Ollama (fully offline), your existing ChatGPT plan, or any model on OpenRouter.
- Each person and project gets a page that pulls together their meetings, decisions and open tasks.
- Optional read-only MCP connections let Claude Desktop or ChatGPT Desktop search your meeting notes.
- Data lives in a local SQLite database, which you can encrypt at setup. No account, no telemetry.

It's an Electron app with React and TypeScript, plus Swift for audio capture and transcription.

Current limits: it's Apple Silicon only (M1 or later, macOS 14.2+). On-device AI needs Ollama installed separately. Speaker names still need a human check. Every note and answer links to the transcript so you can verify it.

I'd love feedback, especially on transcription quality across accents and on whether the meeting-to-task flow fits how you work.

## Posting checklist

- [ ] Cut a stable 1.0 release first. Visitors land on the Releases page, which currently lists only release candidates.
- [ ] Update the GitHub repo description to match the new README hero. Right now it says "Intelligent meeting notes for Mac."
- [ ] Add GitHub topics: granola-alternative, open-source, privacy, offline-first, macos, transcription, speech-to-text, ollama, mcp, electron, task-management.
- [ ] Post on a weekday between 8 and 10 a.m. US Eastern. Stay around for the first 2–3 hours to answer comments.
- [ ] Don't ask people to upvote. HN penalizes it.
- [ ] Have an honest answer ready for "how is this different from Yogurt / Granola / Hyprnote?" Suggested answer: meetings feed one task list and people/project pages, and you can bring your own model.
