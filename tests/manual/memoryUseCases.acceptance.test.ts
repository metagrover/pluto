import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-memory-use-cases-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => fixture.directory },
}));

import * as db from '../../electron/db';
import { isExplicitInformationRequest } from '../../electron/intelligence/conversationController';
import {
  buildAssigneeActionRecall,
  enforceSynthesizedOnlyContext,
  parseQuery,
  retrieveContext,
} from '../../electron/intelligence/queryEngine';
import { getAskPlutoPrompt } from '../../electron/intelligence/queryPrompts';
import {
  readResponsePreferences,
  updateResponsePreference,
} from '../../electron/intelligence/responsePreferences';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { createWorkspaceChatStore } from '../../electron/workspaceChatStore';

// Opt-in acceptance: real database/FTS and production retrieval/prompt functions.
// Unmet product expectations deliberately fail; no memory implementation is mocked.
const observations: Array<Record<string, unknown>> = [];
const reportPath = path.resolve(
  'artifacts/ask-pluto-benchmark/memory-use-cases.json',
);
const preference = 'Keep my preparation briefs under 60 words.';
const now = new Date('2026-10-19T12:00:00Z');
const model = process.env.PLUTO_MEMORY_USE_CASES_MODEL;

beforeAll(() => {
  db.setSetting('llm_provider', 'ollama');
  db.setSetting('ollama_model', model || 'gemma4:12b');
  db.setSetting('ollama_fast_model', 'phi4-mini:3.8b');
  for (const meeting of [
    {
      id: 'staffing',
      title: 'Operations review',
      started_at: '2026-10-16T12:00:00Z',
      enhanced_notes:
        'A headcount freeze remains in effect. No additional positions may be opened until finance approves the budget.',
      transcript_json: JSON.stringify({ text: 'RAW_TRANSCRIPT_SENTINEL' }),
    },
    {
      id: 'launch-earlier',
      title: 'Delivery review',
      started_at: '2026-10-01T12:00:00Z',
      enhanced_notes:
        'The Beacon launch target is October 20. Sam owns final signoff. Payment testing is complete.',
    },
    {
      id: 'launch-later',
      title: 'Delivery review',
      started_at: '2026-10-16T12:00:00Z',
      enhanced_notes:
        'The Beacon launch target changed to October 27. Alex now owns final signoff. Payment testing is blocked. October 27 is conditional on security approval; security approval has not been granted.',
    },
    {
      id: 'decision-earlier',
      title: 'Design review',
      started_at: '2026-10-01T12:00:00Z',
      enhanced_notes:
        'The dashboard navigation will use a persistent left sidebar.',
    },
    {
      id: 'decision-later',
      title: 'Design review',
      started_at: '2026-10-16T12:00:00Z',
      enhanced_notes:
        'The previous layout decision was reversed. Use a compact top bar instead.',
    },
    {
      id: 'edited',
      title: 'Acceptance review',
      started_at: '2026-10-16T12:00:00Z',
      enhanced_notes: 'The release is approved. Sam owns signoff.',
    },
    {
      id: 'completed-source',
      title: 'Follow-up review',
      started_at: '2026-10-16T12:00:00Z',
      enhanced_notes: 'Alex will send the acceptance report.',
    },
  ])
    db.saveMeeting(meeting);
});

afterAll(() => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        fixtureDate: now.toISOString(),
        scope:
          'Synthetic database, FTS, retrieval, chat store, and prompt inputs; not Electron IPC or UI acceptance.',
        model: model || null,
        fixtureDirectory:
          process.env.PLUTO_MEMORY_KEEP_PROFILE === '1'
            ? fixture.directory
            : null,
        observations,
      },
      null,
      2,
    )}\n`,
  );
  db.db.close();
  if (process.env.PLUTO_MEMORY_KEEP_PROFILE !== '1')
    fs.rmSync(fixture.directory, { recursive: true, force: true });
});

const recall = async (query: string, meetingIds: string[]) => {
  // This matches main.ts for a new, explicit information request.
  const parsed = await parseQuery(query, {
    useModelClassification: !isExplicitInformationRequest(query),
    now,
  });
  const context = enforceSynthesizedOnlyContext(
    await retrieveContext(parsed, { query, meetingIds, expandQuery: true }),
  );
  observations.push({
    query,
    scope: meetingIds,
    parsed,
    retrieved: context.map((source) => ({
      id: source.meeting_id,
      evidence: source.evidence_text,
      revision: source.source_revision,
    })),
  });
  return context;
};

describe('Meaning-based recall', { timeout: 30_000 }, () => {
  it('retrieves a staffing restriction using the saved wording', async () => {
    const context = await recall('What is the headcount freeze?', ['staffing']);
    expect(context.map((source) => source.meeting_id)).toEqual(['staffing']);
    expect(context[0].evidence_text).not.toContain('RAW_TRANSCRIPT_SENTINEL');
  });

  it('retrieves the same restriction when asked about hiring constraints', async () => {
    const context = await recall('What are the hiring constraints?', [
      'staffing',
    ]);
    expect(context.map((source) => source.meeting_id)).toContain('staffing');
  });

  it('retrieves the same restriction when asked about recruiting limits', async () => {
    const context = await recall('What limits recruiting?', ['staffing']);
    expect(context.map((source) => source.meeting_id)).toContain('staffing');
  });

  it('does not turn an unrelated question into a staffing answer', async () => {
    expect(await recall('What is the lunch menu?', ['staffing'])).toEqual([]);
  });

  it('finds hiring restrictions across a workspace with unrelated notes', async () => {
    const context = await recall(
      'What are the hiring constraints?',
      db.getAskPlutoMeetingHeaders().map((row) => String(row.id)),
    );
    expect(context.map((source) => source.meeting_id)).toContain('staffing');
  });
});

describe('User preferences', () => {
  it('retains an explicit preference when reopening the same chat', () => {
    updateResponsePreference(preference, db);
    const store = createWorkspaceChatStore(db.db);
    const thread = store.createThread();
    store.appendMessage({
      threadId: thread.id,
      role: 'user',
      content: preference,
    });
    const reopened = createWorkspaceChatStore(db.db);
    const prompt = getAskPlutoPrompt(
      'Prepare a brief for the next Beacon review.',
      [],
      'factual',
      reopened.listMessages(thread.id),
      'None',
      'lookup',
      { responseWordLimit: readResponsePreferences(db).preparation },
    );
    observations.push({
      case: 'same-chat-preference',
      inPrompt: prompt.includes('fewer than 60 words'),
    });
    expect(prompt.includes('fewer than 60 words')).toBe(true);
  });

  it('retains an explicit preference after it leaves the recent-turn window', () => {
    updateResponsePreference(preference, db);
    const store = createWorkspaceChatStore(db.db);
    const thread = store.createThread();
    store.appendMessage({
      threadId: thread.id,
      role: 'user',
      content: preference,
    });
    for (let index = 0; index < 3; index++) {
      store.appendMessage({
        threadId: thread.id,
        role: 'user',
        content: 'What is the Beacon target?',
      });
      store.appendMessage({
        threadId: thread.id,
        role: 'assistant',
        content: 'October 27, conditional on security approval.',
      });
    }
    const prompt = getAskPlutoPrompt(
      'Prepare a brief for the next Beacon review.',
      [],
      'factual',
      store.listMessages(thread.id),
      'None',
      'lookup',
      { responseWordLimit: readResponsePreferences(db).preparation },
    );
    observations.push({
      case: 'older-same-chat-preference',
      savedMessages: store.listMessages(thread.id).length,
      inPrompt: prompt.includes('fewer than 60 words'),
    });
    expect(prompt.includes('fewer than 60 words')).toBe(true);
  });

  it('makes an explicit preparation preference available in a fresh chat', () => {
    updateResponsePreference(preference, db);
    const store = createWorkspaceChatStore(db.db);
    const original = store.createThread();
    store.appendMessage({
      threadId: original.id,
      role: 'user',
      content: preference,
    });
    const fresh = store.createThread();
    const prompt = getAskPlutoPrompt(
      'Prepare a brief for the next Beacon review.',
      [],
      'factual',
      store.listMessages(fresh.id),
      'None',
      'lookup',
      { responseWordLimit: readResponsePreferences(db).preparation },
    );
    observations.push({
      case: 'cross-chat-preference',
      originalStillSaved:
        store.listMessages(original.id)[0].content === preference,
      newMemory: fresh.memory,
      inPrompt: prompt.includes('fewer than 60 words'),
    });
    expect(prompt.includes('fewer than 60 words')).toBe(true);
  });
});

describe('Changing facts and source lifecycle', () => {
  it('retrieves both dated launch plans for a comparison with a shared name', async () => {
    const query = 'What changed in the Beacon launch plan?';
    const context = await recall(query, ['launch-earlier', 'launch-later']);
    expect(context.map((source) => source.meeting_id)).toEqual(
      expect.arrayContaining(['launch-earlier', 'launch-later']),
    );
    const prompt = getAskPlutoPrompt(
      query,
      context,
      'comparative',
      [],
      'None',
      'comparison',
    );
    expect(prompt).toContain('2026-10-01');
    expect(prompt).toContain('2026-10-16');
    expect(prompt).toContain('conditional on security approval');
  });

  it('does not infer a reversal from an unlinked ambiguous reference', async () => {
    const context = await recall('What changed in dashboard navigation?', [
      'decision-earlier',
      'decision-later',
    ]);
    expect(context.map((source) => source.meeting_id)).toEqual([
      'decision-earlier',
    ]);
  });

  it('retrieves both decisions when they share an explicit entity association', async () => {
    const topic = db.upsertEntity({
      id: 'navigation-topic',
      type: 'topic',
      name: 'Dashboard navigation',
    });
    for (const meetingId of ['decision-earlier', 'decision-later']) {
      db.addMeetingEntity({ meeting_id: meetingId, entity_id: topic.id });
    }
    const context = await recall('What changed in dashboard navigation?', [
      'decision-earlier',
      'decision-later',
    ]);
    expect(context.map((source) => source.meeting_id)).toEqual(
      expect.arrayContaining(['decision-earlier', 'decision-later']),
    );
  });

  it('follows a single stored topic when comparison wording names only the note', async () => {
    const context = await recall(
      'What changed in the persistent left sidebar?',
      db.getAskPlutoMeetingHeaders().map((row) => String(row.id)),
    );
    expect(context.map((source) => source.meeting_id).sort()).toEqual(
      ['decision-earlier', 'decision-later'].sort(),
    );
  });

  it('uses a corrected note and changes its source revision', async () => {
    const before = await recall('Who owns release signoff?', ['edited']);
    expect(before).toHaveLength(1);
    db.saveMeeting({
      ...db.getAskPlutoMeeting('edited'),
      id: 'edited',
      enhanced_notes: 'The release is not approved. Alex owns signoff.',
    });
    const after = await recall('Who owns release signoff?', ['edited']);
    expect(after).toHaveLength(1);
    expect(after[0].evidence_text).toContain('Alex owns signoff');
    expect(after[0].evidence_text).not.toContain('Sam owns signoff');
    expect(after[0].source_revision).not.toBe(before[0].source_revision);
  });

  it('stops retrieving a deleted source', async () => {
    db.deleteMeeting('edited');
    expect(await recall('Who owns release signoff?', ['edited'])).toEqual([]);
  });

  it('does not reopen a completed commitment from older note wording', () => {
    const person = db.upsertEntity({
      id: 'memory-self',
      type: 'person',
      name: 'Alex',
    });
    db.identityStore.setSelfPersonId(person.id);
    db.upsertEntity({
      id: 'memory-completed',
      type: 'action_item',
      name: 'Send the acceptance report',
      assigned_to: person.id,
      status: 'completed',
      metadata: {
        source_meeting_id: 'completed-source',
        owner_source: 'user',
        commitment_state: 'confirmed',
        full_description: 'Send the acceptance report.',
      },
    });
    const result = buildAssigneeActionRecall(
      'What are my open commitments?',
      db.getAskPlutoMeetings(),
    );
    const canonical = db.getCanonicalPersonCommitments(person.id);
    observations.push({
      case: 'completed-commitment',
      answer: result?.answer,
      canonical,
    });
    expect(result).not.toBeNull();
    expect(canonical?.open).toEqual([]);
    expect(canonical?.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'completed',
          sourceMeetingId: 'completed-source',
        }),
      ]),
    );
    expect(result?.answer).not.toMatch(/Alex will send/);
  });
});

describe.skipIf(!model)('Local model answer from retrieved evidence', () => {
  it('preserves the old target, new owner, blocker, and unapproved condition', async () => {
    const query =
      'What changed in the Beacon launch plan, who owns signoff, and is October 27 confirmed?';
    const context = await recall(query, ['launch-earlier', 'launch-later']);
    const provider = new UnifiedLLMProvider('ollama', {
      ollama_model: model,
      ollama_fast_model: model,
      ollama_seed: 42,
    });
    const answer = await provider.answerAskPluto(
      getAskPlutoPrompt(
        query,
        context,
        'comparative',
        [],
        'None',
        'comparison',
      ),
      { mode: 'deep', signal: AbortSignal.timeout(120_000) },
    );
    observations.push({ case: 'local-timeline-answer', model, answer });
    expect(answer).toMatch(/(?:October|Oct\.?)\s+20/i);
    expect(answer).toMatch(/(?:October|Oct\.?)\s+27/i);
    expect(answer).toMatch(/Alex/);
    expect(answer).toMatch(/block/i);
    expect(answer).toMatch(
      /conditional|not confirmed|not (?:yet )?approved|pending|not (?:yet )?(?:been )?granted/i,
    );
    expect(answer).not.toMatch(
      /Alex[^.!?]{0,35}(?:owns?|handles?)[^.!?]{0,25}security approval/i,
    );
  }, 130_000);
});
