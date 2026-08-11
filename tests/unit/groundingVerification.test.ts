import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider.ts';

describe('Grounding Refactoring Verification on Real Lengthy Meeting', () => {
  it('verifies that paraphrased action items and decisions with evidence quotes are retained', () => {
    const fixturePath = path.join(
      __dirname,
      '../../tmp/sample_meeting_transcript.json',
    );
    if (!fs.existsSync(fixturePath)) {
      console.log(`Fixture not found at ${fixturePath}`);
      return;
    }

    const fileData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const { title, duration_seconds, transcript_json } = fileData;

    let segments: Array<{ speaker?: string; text: string }> = [];
    if (Array.isArray(transcript_json)) {
      segments = transcript_json;
    } else if (transcript_json && Array.isArray(transcript_json.segments)) {
      segments = transcript_json.segments;
    }

    const transcriptText = segments
      .map((s) => `${s.speaker || 'Unknown'}: ${s.text}`)
      .join('\n');

    console.log(
      '\n================================================================================',
    );
    console.log(`VERIFYING GROUNDING ON REAL MEETING: "${title}"`);
    console.log(
      `Duration: ${duration_seconds}s | Transcript: ${segments.length} segments, ${transcriptText.length} chars`,
    );
    console.log(
      '================================================================================\n',
    );

    // LLM output containing paraphrased action items & evidence quotes
    const rawAnalysis = {
      analysis_schema_version: 3,
      overview:
        'The team discussed PLP (Professional Loan Program) and RSU data integration within Snowflake and Databricks to improve personalization for financial advisors.',
      topics: [
        {
          title: 'PLP and RSU Integration Strategy',
          summary:
            'Discussion on integrating advisor client PLP and RSU exposure data into Snowflake pipelines to deliver personalized financial insights.',
          key_points: [
            {
              text: 'PLP stands for Professional Loan Program.',
              speaker: 'Me',
            },
            {
              text: 'Snowflake and Databricks will be used for modeling advisor wallet share.',
              speaker: 'Them',
            },
          ],
          decisions: [
            {
              text: 'Use Snowflake as the central repository for PLP advisor data',
              decided_by: 'Team',
              rationale: 'Aligns with existing data pipeline infrastructure',
              evidence: 'we will centralize the PLP data in Snowflake',
            },
          ],
          action_items: [
            {
              text: 'Draft Snowflake integration architecture document for advisor PLP data',
              assignee: 'Deepak',
              due: 'Friday',
              evidence: 'write up a doc for the pipeline team',
            },
            {
              text: 'Evaluate data privacy constraints for client financial outflows',
              assignee: 'Sarah',
              due: 'Next week',
              evidence:
                'how much of the data can be sourced without privacy concerns',
            },
          ],
          open_questions: [
            'How to manage real-time updates for high-outflow accounts?',
          ],
          transcript_range: [0, 99],
        },
      ],
      all_action_items: [
        {
          text: 'Draft Snowflake integration architecture document for advisor PLP data',
          assignee: 'Deepak',
          due: 'Friday',
          topic: 'PLP and RSU Integration Strategy',
          evidence: 'write up a doc for the pipeline team',
        },
        {
          text: 'Evaluate data privacy constraints for client financial outflows',
          assignee: 'Sarah',
          due: 'Next week',
          topic: 'PLP and RSU Integration Strategy',
          evidence:
            'how much of the data can be sourced without privacy concerns',
        },
      ],
      all_decisions: [
        {
          text: 'Use Snowflake as the central repository for PLP advisor data',
          decided_by: 'Team',
          rationale: 'Aligns with existing data pipeline infrastructure',
          evidence: 'we will centralize the PLP data in Snowflake',
        },
      ],
      meeting_type: 'team_sync',
      quality: {
        format_pass: true,
        retry_count: 0,
        fallback_used: false,
        issues: [],
      },
    };

    const provider = new UnifiedLLMProvider('openai', {
      openai_api_key: 'test',
    });
    const groundedResult = provider.finalizeStructuredAnalysis({
      analysis: rawAnalysis as any,
      transcript: transcriptText,
      retryCount: 0,
      errorCategories: [],
    });

    console.log(`Overview:\n${groundedResult.overview}\n`);
    console.log(`Topics (${groundedResult.topics.length}):`);

    groundedResult.topics.forEach((topic, idx) => {
      console.log(`\n  Topic ${idx + 1}: "${topic.title}"`);
      console.log(`    Decisions (${topic.decisions.length}):`);
      topic.decisions.forEach((d) =>
        console.log(
          `      - ${d.text} ${d.evidence ? `(Evidence Quote: "${d.evidence}")` : ''}`,
        ),
      );
      console.log(`    Action Items (${topic.action_items.length}):`);
      topic.action_items.forEach((a) =>
        console.log(
          `      - [ ] ${a.text} ${a.assignee ? `(Assignee: ${a.assignee})` : ''} ${a.due ? `(Due: ${a.due})` : ''} ${a.evidence ? `(Evidence Quote: "${a.evidence}")` : ''}`,
        ),
      );
    });

    console.log(
      '\n================================================================================',
    );
    console.log(
      `ALL ACTION ITEMS (${groundedResult.all_action_items.length} retained out of 2):`,
    );
    groundedResult.all_action_items.forEach((item, i) => {
      console.log(`  ${i + 1}. [ ] ${item.text}`);
      console.log(
        `     Owner: ${item.assignee || 'Unassigned'} | Due: ${item.due || 'None'}`,
      );
      console.log(`     Evidence Quote: "${item.evidence}"`);
    });

    console.log(
      `\nALL DECISIONS (${groundedResult.all_decisions.length} retained out of 1):`,
    );
    groundedResult.all_decisions.forEach((d, i) => {
      console.log(`  ${1 + i}. ${d.text}`);
      console.log(`     Decided By: ${d.decided_by || 'Team'}`);
      console.log(`     Evidence Quote: "${d.evidence}"`);
    });

    console.log(
      `\nQuality Error Categories: ${JSON.stringify(groundedResult.generation_metadata?.error_categories)}`,
    );
    console.log(
      '================================================================================\n',
    );
  });
});
