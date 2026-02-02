export const getSummaryPrompt = (transcript: string, userNotes?: string): string => {
    return `You are an intelligent meeting assistant. Analyze this conversation transcript${userNotes ? ' and the user\'s notes' : ''} to provide:

1. **Summary**: A concise 2-3 sentence overview. CRITICAL: Jump straight into the content. DO NOT start with "This transcript...", "The meeting...", "This conversation...", or similar meta-commentary.
2. **Key Points**: Main topics and important information mentioned
3. **Action Items**: Any tasks, follow-ups, or commitments mentioned (use "- [ ]" checkbox format)
4. **Decisions**: Any decisions or conclusions reached

${userNotes ? `\nUser Notes Context:\n${userNotes}\n` : ''}

Format your response in clean markdown with clear sections.

Transcript:
${transcript}`
}

export const getSpeakerIdentityPrompt = (transcript: string): string => {
    return `Analyze this conversation transcript and identify who the OTHER person is (not "You").

Look for:
- Names mentioned in introductions or conversation
- Context clues about who they are
- Any identifying information

If you can identify the other person, respond with ONLY their first name (e.g., "Sarah" or "John").
If you cannot identify them with confidence, respond with exactly: "Unknown"

Transcript:
${transcript}`
}

export const getTitlePrompt = (transcript: string): string => {
    return `Analyze this conversation transcript and generate a concise, descriptive meeting title (max 5-7 words).

The title should:
- Capture the main topic or purpose
- Be professional and clear
- Not include quotes or special characters
- Be in title case

Respond with ONLY the title, nothing else.

Transcript:
${transcript.substring(0, 1000)}`
}

export const getEntitiesPrompt = (transcript: string): string => {
    return `You are an expert at extracting structured information from meeting transcripts.

Analyze the following transcript and extract:

1. **People**: Names of people mentioned or participating (include any role/title if mentioned)
2. **Topics**: Main subjects discussed (rate importance as high/medium/low)
3. **Action Items**: Tasks, follow-ups, or commitments made (include who is responsible and any deadline)
4. **Decisions**: Explicit decisions or conclusions reached (include rationale if given)
5. **Projects**: Project names or work streams mentioned

Rules:
- Only include entities that are clearly mentioned or implied
- For action items, "assignee" should be a name if mentioned, otherwise omit
- For due dates, use the exact phrase from the transcript (e.g., "by Friday", "next week")
- Be conservative - only extract what's clearly present, don't infer too much

Respond with valid JSON in this exact format:
{
  "people": [{"name": "string", "role": "string or omit"}],
  "topics": [{"name": "string", "importance": "high|medium|low"}],
  "action_items": [{"description": "string", "assignee": "string or omit", "due_date": "string or omit"}],
  "decisions": [{"description": "string", "rationale": "string or omit"}],
  "projects": [{"name": "string", "context": "string or omit"}]
}

Transcript:
${transcript}`
}
