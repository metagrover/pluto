import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(
  () =>
    `/tmp/pluto-semantic-${process.pid}-${Math.random().toString(16).slice(2)}`,
);
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
import {
  commitmentRecord,
  previewPendingCommitmentCleanup,
} from '../../electron/commitmentReconciliation';
import * as db from '../../electron/db';
import { extractAndProcessEntities } from '../../electron/entityPipeline';

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

const action = (id: string, state = 'possible', owner?: string) =>
  db.upsertEntity({
    id,
    type: 'action_item',
    name: id,
    status: 'active',
    dedupe_by_name: false,
    metadata: {
      commitment_state: state,
      origin: 'extraction',
      source_meeting_id: 'source',
      assignee_name: owner,
    },
  });

describe('durable semantic commitment identity', () => {
  it('hides retired commitments from the edge-free global graph fallback', () => {
    db.saveMeeting({ id: 'source', title: 'Canonical source' });
    const canonical = action('graph-fallback-canonical', 'confirmed');
    const retired = action('graph-fallback-retired');
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: retired.id,
        canonicalId: canonical.id,
        meetingId: 'source',
        description: retired.name,
        reason: 'Same obligation',
      },
    ]);
    const doc = db.upsertKnowledgeDoc({
      scope_type: 'global',
      scope_key: 'global',
      title: 'Global knowledge',
    });
    const graph = db.getKnowledgeGraph(doc.id);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((node) => node.id)).toContain(canonical.id);
    expect(graph.nodes.map((node) => node.id)).not.toContain(retired.id);
    expect(db.getEntity(retired.id)).toEqual(retired);
  });

  it('projects global and project graph endpoints and labels onto canonical commitments without rewriting source edges', () => {
    db.saveMeeting({ id: 'graph-source', title: 'Graph source' });
    const canonical = action('graph-canonical', 'confirmed');
    const retired = action('graph-retired');
    const project = db.upsertEntity({
      id: 'graph-project',
      type: 'project',
      name: 'Graph project',
    });
    const edge = db.linkEntities({
      source_entity_id: project.id,
      target_entity_id: retired.id,
      relationship: 'relates_to',
      meeting_id: 'graph-source',
      state: 'confirmed',
      source: 'user',
      evidence_quote: 'Original source edge',
    });
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: retired.id,
        canonicalId: canonical.id,
        meetingId: 'graph-source',
        description: retired.name,
        reason: 'Same obligation',
      },
    ]);
    for (const scope of [
      { scope_type: 'global' as const, scope_key: 'global' },
      { scope_type: 'project' as const, scope_key: project.id },
    ]) {
      const doc = db.upsertKnowledgeDoc({ ...scope, title: 'Graph knowledge' });
      const graph = db.getKnowledgeGraph(doc.id);
      expect(graph.nodes.map((node) => node.id)).toContain(canonical.id);
      expect(graph.nodes.map((node) => node.id)).not.toContain(retired.id);
      expect(graph.edges).toContainEqual({
        ...edge,
        source_label: project.name,
        target_entity_id: canonical.id,
        target_label: canonical.name,
      });
      expect(
        graph.edges.some(
          (item) =>
            item.source_entity_id === retired.id ||
            item.target_entity_id === retired.id,
        ),
      ).toBe(false);
    }
    db.restoreCommitmentAlias(retired.id);
    expect(db.getEntityLinks(retired.id)).toContainEqual(edge);
    expect(db.getEntity(retired.id)).toEqual(retired);
  });

  it('tags maintenance plans with the current semantic verification contract', async () => {
    const report = await previewPendingCommitmentCleanup(
      async () => '{"decisions":[]}',
    );
    expect(report).toHaveProperty(
      'reviewVersion',
      'resolved-owner-identity-v2',
    );
  });
  it('retains a blocker attached to a retired source action on its active canonical identity', () => {
    db.saveMeeting({ id: 'blocked-alias-source', title: 'Blocker source' });
    const canonical = action('blocked-alias-canonical', 'confirmed');
    const retired = action('blocked-alias-retired');
    const blocker = action('blocked-alias-blocker', 'confirmed');
    const edge = db.linkEntities({
      source_entity_id: retired.id,
      target_entity_id: blocker.id,
      relationship: 'blocked_by',
      meeting_id: 'blocked-alias-source',
      evidence_meeting_id: 'blocked-alias-source',
      evidence_quote: 'Waiting for the dependency',
      state: 'confirmed',
      source: 'user',
    });
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: retired.id,
        canonicalId: canonical.id,
        meetingId: 'blocked-alias-source',
        description: retired.name,
        reason: 'Same obligation',
      },
    ]);
    expect(db.getBlockedActionItems()).toContainEqual({
      ...canonical,
      blocker_entity_id: blocker.id,
      blocker_name: blocker.name,
      blocker_meeting_id: edge.evidence_meeting_id,
      blocker_evidence_quote: edge.evidence_quote,
      blocker_updated_at: edge.updated_at,
      blocker_relationship_state: edge.state,
    });
    expect(
      db.getBlockedActionItems().some((item) => item.id === retired.id),
    ).toBe(false);
    db.restoreCommitmentAlias(retired.id);
    expect(db.getEntityLinks(retired.id)).toContainEqual(edge);
    expect(
      db.getBlockedActionItems().some((item) => item.id === retired.id),
    ).toBe(true);
    expect(
      db.getBlockedActionItems().some((item) => item.id === canonical.id),
    ).toBe(false);
  });

  it('stops treating an active alias of a completed canonical dependency as a blocker', () => {
    db.saveMeeting({
      id: 'completed-blocker-source',
      title: 'Completed blocker source',
    });
    const blocked = action('completed-blocker-action', 'confirmed');
    const canonical = action('completed-blocker-canonical', 'confirmed');
    const retired = action('completed-blocker-retired');
    db.updateEntityStatus(canonical.id, 'completed');
    const edge = db.linkEntities({
      source_entity_id: blocked.id,
      target_entity_id: retired.id,
      relationship: 'blocked_by',
      meeting_id: 'completed-blocker-source',
      state: 'confirmed',
      source: 'user',
    });
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: retired.id,
        canonicalId: canonical.id,
        meetingId: 'completed-blocker-source',
        description: retired.name,
        reason: 'Same obligation',
      },
    ]);
    expect(
      db.getBlockedActionItems().some((item) => item.id === blocked.id),
    ).toBe(false);
    db.restoreCommitmentAlias(retired.id);
    expect(db.getEntityLinks(blocked.id)).toContainEqual(edge);
    expect(db.getBlockedActionItems()).toContainEqual(
      expect.objectContaining({
        id: blocked.id,
        blocker_entity_id: retired.id,
      }),
    );
  });

  it('projects duplicate project links onto the canonical without exposing retired search results', () => {
    db.saveMeeting({ id: 'source', title: 'Canonical source' });
    const canonical = action('search-canonical', 'confirmed');
    const pending = action('uniqueretiredsuggestion');
    const project = db.upsertEntity({
      id: 'alias-project',
      type: 'project',
      name: 'Alias project',
    });
    const edge = db.linkEntities({
      source_entity_id: project.id,
      target_entity_id: pending.id,
      relationship: 'relates_to',
      meeting_id: 'source',
      state: 'confirmed',
      source: 'user',
      evidence_quote: 'Same project',
    });
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: pending.id,
        canonicalId: canonical.id,
        meetingId: 'source',
        description: pending.name,
        reason: 'Same obligation',
      },
    ]);
    expect(
      db
        .getRelatedEntities(project.id)
        .some((entity) => entity.id === canonical.id),
    ).toBe(true);
    expect(
      db
        .getRelatedEntities(canonical.id)
        .some((entity) => entity.id === project.id),
    ).toBe(true);
    expect(db.getEntityLinks(canonical.id)).toContainEqual({
      ...edge,
      target_entity_id: canonical.id,
    });
    expect(commitmentRecord(canonical).context).not.toContain('Alias project');
    expect(commitmentRecord(pending).context).toContain('Alias project');
    expect(
      db
        .searchEntities('uniqueretiredsuggestion')
        .some((entity) => entity.id === pending.id),
    ).toBe(false);
    expect(
      db
        .searchEntitiesWithMeetingContext('uniqueretiredsuggestion')
        .some((entity) => entity.id === pending.id),
    ).toBe(false);
    db.restoreCommitmentAlias(pending.id);
    expect(
      db
        .getRelatedEntities(project.id)
        .some((entity) => entity.id === pending.id),
    ).toBe(true);
    expect(db.getEntityLinks(pending.id)).toContainEqual(edge);
    expect(db.getEntityLinks(canonical.id)).not.toContainEqual(
      expect.objectContaining({ id: edge.id }),
    );
  });
  it('keeps two fresh ambiguous occurrences when semantic review cannot establish identity', async () => {
    db.saveMeeting({ id: 'ambiguous-source', title: 'Ambiguous source' });
    const result = await extractAndProcessEntities(
      {
        extractEntities: async () => ({
          people: [],
          topics: [],
          projects: [],
          decisions: [],
          relationships: [],
          action_items: [
            { description: 'Send the report' },
            { description: 'Send the report' },
          ],
        }),
        synthesizeKnowledgeDocument: async (prompt: string) => {
          const payload = JSON.parse(
            prompt.slice(prompt.lastIndexOf('\nINPUT\n') + 7),
          );
          return JSON.stringify({
            decisions: payload.candidates.map((item: { id: string }) => ({
              candidateId: item.id,
              decision: 'uncertain',
              matchId: null,
              reason: 'No owner or occurrence evidence',
            })),
          });
        },
      },
      'Two unspecified reports were discussed.',
      'ambiguous-source',
    );
    expect(
      new Set(
        result.entities
          .filter((e) => e.type === 'action_item')
          .map((e) => e.id),
      ).size,
    ).toBe(2);
  });

  it('keeps descendant source provenance visible through alias chains', () => {
    db.saveMeeting({ id: 'source', title: 'Canonical source' });
    db.saveMeeting({ id: 'descendant-source', title: 'Descendant source' });
    const first = action('first-canonical');
    const final = action('final-canonical', 'confirmed');
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: 'descendant',
        canonicalId: first.id,
        meetingId: 'descendant-source',
        description: 'Repeated report',
        reason: 'Same obligation',
      },
    ]);
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: first.id,
        canonicalId: final.id,
        meetingId: 'source',
        description: first.name,
        reason: 'Same obligation',
      },
    ]);
    expect(
      db
        .getMeetingEntities('descendant-source')
        .some((entity) => entity.id === final.id),
    ).toBe(true);
    expect(
      db
        .getEntityMeetings(final.id)
        .some((meeting) => meeting.id === 'descendant-source'),
    ).toBe(true);
    db.restoreCommitmentAlias(first.id);
    expect(
      db
        .getMeetingEntities('descendant-source')
        .some((entity) => entity.id === first.id),
    ).toBe(true);
  });

  it('invalidates a review when an incoming project relationship changes', () => {
    const target = action('incoming-link-target');
    const project = db.upsertEntity({
      id: 'incoming-project',
      type: 'project',
      name: 'Cedar',
    });
    const revision = db.getCommitmentQueueRevision();
    db.linkEntities({
      source_entity_id: project.id,
      target_entity_id: target.id,
      relationship: 'relates_to',
    });
    expect(db.getCommitmentQueueRevision()).not.toBe(revision);
  });
  it('compares identical descriptions with distinct project evidence instead of collapsing their IDs', async () => {
    db.saveMeeting({ id: 'two-projects', title: 'Two projects' });
    const result = await extractAndProcessEntities(
      {
        extractEntities: async () => ({
          people: [],
          topics: [],
          projects: [],
          decisions: [],
          relationships: [],
          action_items: [
            {
              description: 'Send report',
              assignee: 'Alex',
              evidence: 'Alex will send the Cedar report.',
            },
            {
              description: 'Send report',
              assignee: 'Alex',
              evidence: 'Alex will send the Birch report.',
            },
          ],
        }),
        synthesizeKnowledgeDocument: async (prompt: string) => {
          const payload = JSON.parse(
            prompt.slice(prompt.lastIndexOf('\nINPUT\n') + 7),
          );
          return JSON.stringify({
            decisions: payload.candidates.map((item: { id: string }) => ({
              candidateId: item.id,
              decision: 'distinct',
              matchId: null,
              reason: 'Different project deliverables',
            })),
          });
        },
      },
      'Alex will send both reports.',
      'two-projects',
    );
    expect(
      new Set(
        result.entities
          .filter((e) => e.type === 'action_item')
          .map((e) => e.id),
      ).size,
    ).toBe(2);
  });

  it('uses current user-edited title and deadline when comparing history', () => {
    const entity = db.upsertEntity({
      id: 'edited',
      type: 'action_item',
      name: 'Edited deliverable',
      due_date: '2026-10-01',
      metadata: {
        full_description: 'Old deliverable',
        source_due_date: 'Friday',
        commitment_state: 'confirmed',
      },
    });
    expect(commitmentRecord(entity)).toMatchObject({
      text: 'Edited deliverable',
      due: '2026-10-01',
    });
  });
  it('uses current explicit reassignment over the original extracted owner', () => {
    const owner = db.upsertEntity({
      id: 'reassigned-owner',
      type: 'person',
      name: 'Blair',
    });
    const entity = db.upsertEntity({
      id: 'reassigned',
      type: 'action_item',
      name: 'Publish report',
      assigned_to: owner.id,
      metadata: { assignee_name: 'Alex', commitment_state: 'confirmed' },
    });
    expect(commitmentRecord(entity).owner).toBe('Blair');
  });

  it('removes only alias-created source links when restoring an incorrect cross-meeting match', () => {
    db.saveMeeting({ id: 'other-source', title: 'Other project' });
    const canonical = action('cross-canonical', 'confirmed');
    const pending = action('cross-pending');
    db.ensureMeetingEntity({
      meeting_id: 'other-source',
      entity_id: pending.id,
      context: 'Independent original source',
    });
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: pending.id,
        canonicalId: canonical.id,
        meetingId: 'other-source',
        description: pending.name,
        reason: 'Same obligation',
      },
    ]);
    expect(
      db.getEntityMeetings(canonical.id).some((m) => m.id === 'other-source'),
    ).toBe(true);
    db.restoreCommitmentAlias(pending.id);
    expect(
      db.getEntityMeetings(canonical.id).some((m) => m.id === 'other-source'),
    ).toBe(false);
    expect(
      db.getEntityMeetings(pending.id).some((m) => m.id === 'other-source'),
    ).toBe(true);
  });

  it('invalidates comparisons when a historical source title changes', () => {
    const entity = action('title-source-task');
    db.saveMeeting({ id: 'title-source', title: 'Project Cedar' });
    db.ensureMeetingEntity({
      meeting_id: 'title-source',
      entity_id: entity.id,
    });
    const revision = db.getCommitmentQueueRevision();
    db.saveMeeting({ id: 'title-source', title: 'Project Birch' });
    expect(db.getCommitmentQueueRevision()).not.toBe(revision);
  });
  it('restores a newly matched extraction with original ownership and evidence', () => {
    db.saveMeeting({ id: 'restore-new-source', title: 'Restore a new alias' });
    const canonical = action('restore-new-canonical', 'confirmed');
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: 'restore-new',
        canonicalId: canonical.id,
        meetingId: 'restore-new-source',
        description: 'Send the report',
        reason: 'Same obligation',
        original: {
          owner: 'Alex',
          due: 'Friday',
          normalizedDue: '2026-09-04T00:00:00.000Z',
          evidence: 'Alex will send the report.',
        },
      },
    ]);
    db.restoreCommitmentAlias('restore-new');
    expect(db.resolveCommitmentIdentity('restore-new')?.id).toBe('restore-new');
    expect(db.getEntity('restore-new')?.due_date).toBe(
      '2026-09-04T00:00:00.000Z',
    );
    expect(JSON.parse(db.getEntity('restore-new')!.metadata!)).toMatchObject({
      assignee_name: 'Alex',
      source_due_date: 'Friday',
      source_evidence: 'Alex will send the report.',
      commitment_state: 'possible',
    });
    expect(
      db
        .getEntityMeetings(canonical.id)
        .some((m) => m.id === 'restore-new-source'),
    ).toBe(false);
  });

  it('checks current user state after model work and writes nothing on a stale result', async () => {
    db.saveMeeting({
      id: 'model-race',
      title: 'Race source',
      transcript_json: JSON.stringify([
        { speaker: 'Alex', text: 'I will handle the incoming candidate.' },
      ]),
    });
    const target = action('model-race-target', 'possible', 'Alex');
    const provider = {
      extractEntities: async () => ({
        people: [],
        topics: [],
        projects: [],
        decisions: [],
        relationships: [],
        action_items: [
          { description: 'An incoming candidate', assignee: 'Alex' },
        ],
      }),
      synthesizeKnowledgeDocument: async (prompt: string) => {
        db.updateActionCommitmentState(target.id, 'confirmed');
        if (
          !JSON.parse(prompt.slice(prompt.lastIndexOf('\nINPUT\n') + 7))
            .candidates
        )
          return JSON.stringify({
            status: 'unresolved',
            personId: null,
            speaker: null,
            ownershipKind: 'ambiguous',
            evidence: [],
            identityEvidence: [],
            reason: 'Unclear owner.',
          });
        const payload = JSON.parse(
          prompt.slice(prompt.lastIndexOf('\nINPUT\n') + 7),
        );
        return JSON.stringify({
          decisions: payload.candidates.map((item: { id: string }) => ({
            candidateId: item.id,
            decision: 'distinct',
            matchId: null,
            reason: 'Different obligation',
          })),
        });
      },
    };
    await expect(
      extractAndProcessEntities(provider, 'Source evidence', 'model-race'),
    ).rejects.toThrow('commitment_reconciliation_stale');
    expect(db.getMeetingEntities('model-race')).toEqual([]);
    expect(
      JSON.parse(db.getEntity(target.id)!.metadata!).commitment_state,
    ).toBe('confirmed');
  });
  it('reconciles paraphrases through the production extraction boundary and caches their identity', async () => {
    db.saveMeeting({
      id: 'semantic-source',
      title: 'Synthetic release review',
      transcript_json: JSON.stringify([
        { speaker: 'Alex', text: 'I will publish the launch checklist.' },
      ]),
    });
    db.upsertEntity({
      id: 'semantic-person',
      type: 'person',
      name: 'Alex',
      dedupe_by_name: false,
    });
    db.identityStore.setBinding('semantic-source', {
      speaker: 'Alex',
      personId: 'semantic-person',
      individual: true,
      source: 'user',
      sourceRevision: 'v1',
      evidence: [],
    });
    const canonical = db.upsertEntity({
      id: 'semantic-reviewed',
      type: 'action_item',
      name: 'Publish the launch checklist',
      metadata: {
        commitment_state: 'rejected',
        origin: 'extraction',
        source_meeting_id: 'semantic-source',
        assignee_name: 'Alex',
      },
    });
    const generate = vi.fn(async (prompt: string) => {
      if (
        !JSON.parse(prompt.slice(prompt.lastIndexOf('\nINPUT\n') + 7))
          .candidates
      )
        return JSON.stringify({
          status: 'resolved',
          personId: null,
          speaker: 'Alex',
          ownershipKind: 'first_person',
          evidence: [
            { turnId: 't0', quote: 'I will publish the launch checklist.' },
          ],
          identityEvidence: [],
          reason: 'The bound individual speaker commits.',
        });
      // Boundary double supplies a semantic decision; production parsing,
      // database identity, queue filtering and retry behavior remain real.
      const payload = JSON.parse(
        prompt.slice(prompt.lastIndexOf('\nINPUT\n') + 7),
      );
      const target = payload.prior.find(
        (item: { text: string }) => item.text === canonical.name,
      );
      return JSON.stringify({
        decisions: payload.candidates.map((item: { id: string }) => ({
          candidateId: item.id,
          decision: target ? 'same' : 'distinct',
          matchId: target?.id ?? null,
          reason: 'Same release checklist and owner',
        })),
      });
    });
    const provider = {
      extractEntities: async () => ({
        people: [],
        topics: [],
        projects: [],
        decisions: [],
        relationships: [],
        action_items: [
          {
            description: 'Make the release readiness checklist available',
            assignee: 'Alex',
          },
        ],
      }),
      synthesizeKnowledgeDocument: generate,
    };
    const first = await extractAndProcessEntities(
      provider,
      'Alex: I will publish the launch checklist.',
      'semantic-source',
    );
    expect(
      first.entities.filter((e) => e.type === 'action_item').map((e) => e.id),
    ).toEqual([canonical.id]);
    expect(db.getEntity(canonical.id)).toEqual(canonical);
    const calls = generate.mock.calls.length;
    await extractAndProcessEntities(
      provider,
      'Alex: I will publish the launch checklist.',
      'semantic-source',
    );
    expect(generate.mock.calls.length).toBe(calls);
  });

  it('does not publish actions if semantic comparison fails', async () => {
    db.saveMeeting({
      id: 'failure-source',
      title: 'Synthetic failure',
      transcript_json: JSON.stringify([
        { speaker: 'Alex', text: 'I will handle the new obligation.' },
      ]),
    });
    action('failure-prior', 'confirmed', 'Alex');
    const revision = db.getCommitmentQueueRevision();
    await expect(
      extractAndProcessEntities(
        {
          extractEntities: async () => ({
            people: [],
            topics: [],
            projects: [],
            decisions: [],
            relationships: [],
            action_items: [
              { description: 'A new obligation', assignee: 'Alex' },
            ],
          }),
          synthesizeKnowledgeDocument: async () => {
            throw new Error('model unavailable');
          },
        },
        'Source evidence',
        'failure-source',
      ),
    ).rejects.toThrow('model unavailable');
    expect(db.getCommitmentQueueRevision()).toBe(revision);
  });
  it('reuses a reviewed identity and preserves all original fields', () => {
    db.saveMeeting({ id: 'source', title: 'Synthetic source' });
    const canonical = action('reviewed', 'confirmed');
    const revision = db.getCommitmentQueueRevision();
    db.commitCommitmentAliases(revision, [
      {
        extractionId: 'paraphrase',
        canonicalId: canonical.id,
        meetingId: 'source',
        description: 'Rephrased obligation',
        reason: 'Same outcome and owner',
      },
    ]);
    expect(db.resolveCommitmentIdentity('paraphrase')?.id).toBe(canonical.id);
    expect(db.getEntity(canonical.id)).toEqual(canonical);
    expect(db.getEntity('paraphrase')).toBeUndefined();
  });

  it('retires pending copies reversibly without pretending they were dismissed', () => {
    const canonical = action('dismissed', 'rejected');
    const pending = action('pending-copy');
    db.ensureMeetingEntity({
      meeting_id: 'source',
      entity_id: pending.id,
      context: 'Original evidence',
    });
    db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
      {
        extractionId: pending.id,
        canonicalId: canonical.id,
        meetingId: 'source',
        description: pending.name,
        reason: 'Same obligation',
      },
    ]);
    expect(db.getEntitiesByType('action_item').map((e) => e.id)).not.toContain(
      pending.id,
    );
    expect(db.getActionItemsByStatus('active').map((e) => e.id)).not.toContain(
      pending.id,
    );
    expect(db.getAllEntities().map((e) => e.id)).not.toContain(pending.id);
    expect(
      JSON.parse(db.getEntity(pending.id)!.metadata!).commitment_state,
    ).toBe('possible');
    expect(db.getEntity(canonical.id)).toEqual(canonical);
    db.restoreCommitmentAlias(pending.id);
    expect(db.resolveCommitmentIdentity(pending.id)?.id).toBe(pending.id);
    expect(db.getEntitiesByType('action_item').map((e) => e.id)).toContain(
      pending.id,
    );
    expect(
      db
        .getMeetingEntities('source')
        .some((e) => e.id === pending.id && e.context === 'Original evidence'),
    ).toBe(true);
  });

  it('refuses stale model decisions after a user review', () => {
    const canonical = action('stale-target', 'confirmed');
    const pending = action('reviewed-during-model');
    const revision = db.getCommitmentQueueRevision();
    db.updateActionCommitmentState(pending.id, 'confirmed');
    expect(() =>
      db.commitCommitmentAliases(revision, [
        {
          extractionId: pending.id,
          canonicalId: canonical.id,
          meetingId: 'source',
          description: pending.name,
          reason: 'Same obligation',
        },
      ]),
    ).toThrow('commitment_reconciliation_stale');
    expect(db.resolveCommitmentIdentity(pending.id)?.id).toBe(pending.id);
  });

  it('refuses to retire reviewed records, user commitments, cycles or invalid targets', () => {
    const canonical = action('guard-target', 'confirmed');
    const reviewed = action('guard-reviewed', 'rejected');
    const user = db.upsertEntity({
      id: 'guard-user',
      type: 'action_item',
      name: 'My edited task',
      metadata: { origin: 'user', commitment_state: 'possible' },
    });
    for (const source of [reviewed, user, canonical]) {
      expect(() =>
        db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
          {
            extractionId: source.id,
            canonicalId: canonical.id,
            meetingId: 'source',
            description: source.name,
            reason: 'Same',
          },
        ]),
      ).toThrow();
    }
    expect(() =>
      db.commitCommitmentAliases(db.getCommitmentQueueRevision(), [
        {
          extractionId: 'bad',
          canonicalId: 'missing',
          meetingId: 'source',
          description: 'New',
          reason: 'Same',
        },
      ]),
    ).toThrow();
    expect(db.getEntity(reviewed.id)).toEqual(reviewed);
  });
});
