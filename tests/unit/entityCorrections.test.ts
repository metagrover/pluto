import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  directory: `/tmp/pluto-entity-corrections-${process.pid}`,
}));

vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
import * as db from '../../electron/db';
import { packageEntityNotes } from '../../electron/dreaming/packageEntityNotes';
import { compileKnowledgeBrief } from '../../src/components/KnowledgeGraph/knowledgeDocument';

afterAll(() => fs.rmSync(fixture.directory, { recursive: true, force: true }));

describe('Entity Corrections Persistence', () => {
  const currentRevision = (entityId: string) =>
    packageEntityNotes(entityId)?.sourceRevision ?? null;

  it('records corrections and checks dismissed items idempotently', () => {
    const entityId = 'proj-alpha-123';
    const itemType = 'milestone';
    const fingerprint = 'stripe-checkout-v1';

    expect(db.isItemDismissed(entityId, itemType, fingerprint)).toBe(false);

    const saved = db.recordEntityCorrection({
      entityId,
      itemType,
      fingerprint,
      reason: 'reported_inaccurate',
    });

    expect(saved).toMatchObject({
      entity_id: entityId,
      item_type: itemType,
      fingerprint,
      reason: 'reported_inaccurate',
    });
    expect(saved.id).toBeDefined();

    expect(db.isItemDismissed(entityId, itemType, fingerprint)).toBe(true);
    expect(db.isItemDismissed(entityId, itemType, 'other-milestone')).toBe(
      false,
    );
    expect(db.isItemDismissed('other-entity', itemType, fingerprint)).toBe(
      false,
    );

    const list = db.getEntityCorrections(entityId);
    expect(list).toHaveLength(1);
    expect(list[0].fingerprint).toBe(fingerprint);

    // Recording again is idempotent and doesn't duplicate
    db.recordEntityCorrection({
      entityId,
      itemType,
      fingerprint,
      reason: 'duplicate_attempt',
    });
    const listAfterDuplicate = db.getEntityCorrections(entityId);
    expect(listAfterDuplicate).toHaveLength(1);
  });

  it('unifies item fingerprints across mixed casing and whitespace', () => {
    const entityId = 'proj-beta-456';
    const itemType = 'milestone';
    const rawInput = '   Stripe Elements   Connected!  ';
    const expectedFingerprint = 'stripe-elements-connected';

    expect(db.generateItemFingerprint(rawInput)).toBe(expectedFingerprint);

    const saved = db.recordEntityCorrection({
      entityId,
      itemType,
      fingerprint: rawInput,
      reason: 'wrong_milestone',
    });

    expect(saved.fingerprint).toBe(expectedFingerprint);

    // Queries with different casing, whitespace, and slug format should all match
    expect(db.isItemDismissed(entityId, itemType, expectedFingerprint)).toBe(
      true,
    );
    expect(
      db.isItemDismissed(entityId, itemType, 'STRIPE ELEMENTS CONNECTED'),
    ).toBe(true);
    expect(
      db.isItemDismissed(
        entityId,
        itemType,
        '  Stripe   Elements   Connected! ',
      ),
    ).toBe(true);
    expect(
      db.isItemDismissed(entityId, itemType, 'stripe-elements-connected'),
    ).toBe(true);

    // Unrelated queries do not match
    expect(
      db.isItemDismissed(entityId, itemType, 'stripe-elements-pending'),
    ).toBe(false);
  });

  it('includes accepted person current-read fields in the dreaming baseline', () => {
    const person = db.upsertEntity({
      type: 'person',
      name: 'Dreaming Baseline Person',
    });
    db.upsertKnowledgeDoc({
      scope_type: 'person_context',
      scope_key: person.id,
      title: person.name,
      structured_json: JSON.stringify({
        schema_version: 2,
        current_read: {
          headline: 'Evidence-backed headline',
          supporting_bullets: ['Current focus'],
        },
      }),
    });

    expect(db.getDreamingEntityBaseline(person.id)).toMatchObject({
      currentRead: {
        headline: 'Evidence-backed headline',
        supportingBullets: ['Current focus'],
      },
    });
  });

  it.each([
    ['project', 'project_alias', 'Dreaming Project Alias'],
    ['person', 'person_alias', 'Dreaming Person Alias'],
  ] as const)(
    'resolves, removes, and restores accepted %s aliases through DB APIs',
    (entityType, kind, alias) => {
      const entity = db.upsertEntity({
        type: entityType,
        name: `Canonical ${entityType} ${process.pid}`,
      });
      const revision = `alias-revision-${entityType}`;
      const started = db.dreamingProposalStore.startRun({
        entityId: entity.id,
        entityType,
        sourceRevision: revision,
        model: 'gemma4:12b',
        promptVersion: 'dreaming-v1',
      });
      expect(started.status).toBe('started');
      db.dreamingProposalStore.completeRun({
        runId: started.run.id,
        leaseToken: started.run.leaseToken,
        status: 'proposed',
        proposals: [
          {
            kind,
            payload: { alias },
            evidence: [
              { meetingId: 'meeting-alias', excerpt: `${alias} cited` },
            ],
            fingerprint: `db-${entityType}-alias`,
          },
        ],
      });
      const proposal = db.dreamingProposalStore.listPendingProposals(
        entity.id,
        entityType,
      )[0];
      expect(
        db.acceptDreamingProposal({
          proposalId: proposal.id,
          getCurrentSourceRevision: () => revision,
        }).status,
      ).toBe('accepted');
      expect(db.findEntity(entityType, alias)?.id).toBe(entity.id);

      expect(db.removeDreamingAlias({ proposalId: proposal.id }).status).toBe(
        'removed',
      );
      expect(db.findEntity(entityType, alias)).toBeUndefined();
      expect(db.restoreDreamingAlias({ proposalId: proposal.id }).status).toBe(
        'restored',
      );
      expect(db.findEntity(entityType, alias)?.id).toBe(entity.id);
    },
  );

  it.each([
    ['person', 'person_alias'],
    ['project', 'project_alias'],
  ] as const)(
    'keeps a dreaming %s alias resolvable, packaged, and reversible after a canonical merge',
    (entityType, kind) => {
      const source = db.upsertEntity({
        type: entityType,
        name: `${entityType} Merge Source ${process.pid}`,
      });
      const destination = db.upsertEntity({
        type: entityType,
        name: `${entityType} Merge Destination ${process.pid}`,
      });
      const alias = `${entityType} Merged Dream Alias`;
      const revision = `${entityType}-merge-alias-revision`;
      const started = db.dreamingProposalStore.startRun({
        entityId: source.id,
        entityType,
        sourceRevision: revision,
        model: 'gemma4:12b',
        promptVersion: 'dreaming-v1',
      });
      expect(started.status).toBe('started');
      db.dreamingProposalStore.completeRun({
        runId: started.run.id,
        leaseToken: started.run.leaseToken,
        status: 'proposed',
        proposals: [
          {
            kind,
            payload: { alias },
            evidence: [
              { meetingId: 'meeting-merge', excerpt: `${alias} cited` },
            ],
            fingerprint: `${entityType}-merged-dream-alias`,
          },
        ],
      });
      const proposal = db.dreamingProposalStore.listPendingProposals(
        source.id,
        entityType,
      )[0];
      db.acceptDreamingProposal({
        proposalId: proposal.id,
        getCurrentSourceRevision: () => revision,
      });
      if (entityType === 'person') db.mergePerson(source.id, destination.id);
      else db.mergeProject(source.id, destination.id);

      expect(db.findEntity(entityType, alias)?.id).toBe(destination.id);
      expect(db.getDreamingEntityBaseline(destination.id).aliases).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: alias })]),
      );
      const repeatedRevision = `${revision}-repeated`;
      const repeatedRun = db.dreamingProposalStore.startRun({
        entityId: destination.id,
        entityType,
        sourceRevision: repeatedRevision,
        model: 'gemma4:12b',
        promptVersion: 'dreaming-v1',
      });
      expect(repeatedRun.status).toBe('started');
      db.dreamingProposalStore.completeRun({
        runId: repeatedRun.run.id,
        leaseToken: repeatedRun.run.leaseToken,
        status: 'proposed',
        proposals: [
          {
            kind,
            payload: { alias },
            evidence: [
              { meetingId: 'meeting-repeat', excerpt: `${alias} repeated` },
            ],
            fingerprint: `${entityType}-merged-dream-alias-repeated`,
          },
        ],
      });
      const repeatedProposal = db.dreamingProposalStore.listPendingProposals(
        destination.id,
        entityType,
      )[0];
      expect(
        db.acceptDreamingProposal({
          proposalId: repeatedProposal.id,
          getCurrentSourceRevision: () => repeatedRevision,
        }).status,
      ).toBe('review_required');
      db.removeDreamingAlias({ proposalId: proposal.id });
      expect(db.findEntity(entityType, alias)).toBeUndefined();
      expect(db.getDreamingEntityBaseline(destination.id).aliases).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: alias })]),
      );
      expect(db.restoreDreamingAlias({ proposalId: proposal.id }).status).toBe(
        'restored',
      );
      expect(db.findEntity(entityType, alias)?.id).toBe(destination.id);
      expect(db.getDreamingEntityBaseline(destination.id).aliases).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: alias })]),
      );
      expect(
        entityType === 'person'
          ? db.resolvePersonIdentityId(source.id)
          : db.resolveProjectIdentityId(source.id),
      ).toBe(destination.id);
    },
  );

  it.each(['user', 'extraction'] as const)(
    'reuses an equivalent %s canonical action when accepting a project commitment',
    (origin) => {
      const suffix = origin;
      const task = `Ship the ${suffix} preview`;
      const meetingId = `commitment-meeting-${suffix}`;
      const project = db.upsertEntity({
        id: `dreaming-commitment-project-${suffix}`,
        type: 'project',
        name: `Dreaming Commitment Project ${suffix}`,
      });
      const existing = db.upsertEntity({
        id: `existing-${suffix}-action`,
        type: 'action_item',
        name: task,
        status: 'active',
        assigned_to: null,
        metadata: { origin, keep: 'metadata' },
      });
      db.saveMeeting({
        id: meetingId,
        title: 'Commitment meeting',
        duration_seconds: 60,
      });
      const sourceRevision = currentRevision(project.id)!;
      const started = db.dreamingProposalStore.startRun({
        entityId: project.id,
        entityType: 'project',
        sourceRevision,
        model: 'gemma4:12b',
        promptVersion: 'dreaming-v1',
      });
      expect(started.status).toBe('started');
      db.dreamingProposalStore.completeRun({
        runId: started.run.id,
        leaseToken: started.run.leaseToken,
        status: 'proposed',
        proposals: [
          {
            kind: 'project_commitment',
            payload: { task: `  Ship   the ${suffix} preview ` },
            evidence: [{ meetingId, excerpt: task }],
            fingerprint: `ship-preview-existing-${suffix}`,
          },
        ],
      });
      const proposal = db.dreamingProposalStore.listPendingProposals(
        project.id,
        'project',
      )[0];

      expect(
        db.acceptDreamingProposal({
          proposalId: proposal.id,
          getCurrentSourceRevision: currentRevision,
        }).status,
      ).toBe('accepted');
      const brief = db.getProjectBrief(project.id)!;
      expect(brief.tasks.map((task) => task.id)).toEqual([existing.id]);
      expect(brief.tasks[0].assigned_to).toBeNull();
      expect(JSON.parse(brief.tasks[0].metadata || '{}')).toMatchObject({
        origin,
        keep: 'metadata',
        dreamingSources: [
          expect.objectContaining({
            proposalId: proposal.id,
            meetingIds: [meetingId],
          }),
        ],
      });
    },
  );

  it('advances the guarded revision for sibling decisions but stales after an external edit', () => {
    const project = db.upsertEntity({
      id: 'dreaming-sibling-project',
      type: 'project',
      name: 'Dreaming Sibling Project',
    });
    const sourceRevision = currentRevision(project.id)!;
    const started = db.dreamingProposalStore.startRun({
      entityId: project.id,
      entityType: 'project',
      sourceRevision,
      model: 'gemma4:12b',
      promptVersion: 'dreaming-v1',
    });
    expect(started.status).toBe('started');
    db.dreamingProposalStore.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'project_summary',
          payload: { summary: 'Launch preparation' },
          evidence: [{ meetingId: 'sibling-meeting', excerpt: 'Preparing' }],
          fingerprint: 'sibling-summary',
        },
        {
          kind: 'project_alias',
          payload: { alias: 'Sibling Project Alias' },
          evidence: [{ meetingId: 'sibling-meeting', excerpt: 'Alias' }],
          fingerprint: 'sibling-alias',
        },
        {
          kind: 'project_milestone',
          payload: { name: 'External edit guard', status: 'planned' },
          evidence: [{ meetingId: 'sibling-meeting', excerpt: 'Guarded' }],
          fingerprint: 'sibling-milestone',
        },
      ],
    });
    const proposals = db.dreamingProposalStore.listPendingProposals(
      project.id,
      'project',
    );
    const summary = proposals.find(
      (proposal) => proposal.kind === 'project_summary',
    )!;
    const alias = proposals.find(
      (proposal) => proposal.kind === 'project_alias',
    )!;
    const milestone = proposals.find(
      (proposal) => proposal.kind === 'project_milestone',
    )!;

    expect(
      db.acceptDreamingProposal({
        proposalId: summary.id,
        getCurrentSourceRevision: currentRevision,
      }).status,
    ).toBe('accepted');
    expect(
      db.rejectDreamingProposal({
        proposalId: alias.id,
        getCurrentSourceRevision: currentRevision,
      }).status,
    ).toBe('rejected');
    db.saveProjectMilestone(project.id, {
      title: 'Unrelated user milestone',
      status: 'planned',
    });
    expect(
      db.acceptDreamingProposal({
        proposalId: milestone.id,
        getCurrentSourceRevision: currentRevision,
      }).status,
    ).toBe('stale');
  });

  it('keeps accepted People claims visible after ordinary knowledge synthesis overwrites the doc', () => {
    const person = db.upsertEntity({
      id: 'dreaming-claims-person',
      type: 'person',
      name: 'Avery Dreaming Claims',
    });
    const synthesizedDoc = (headline: string) =>
      JSON.stringify({
        schema_version: 2,
        current_read: {
          headline,
          supporting_bullets: ['Synthesized bullet'],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Grounded in source notes.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.9,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-08-10T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [
          {
            id: 'stream-1',
            title: 'Launch',
            current_read: 'Launch work',
            evidence_quality: {
              mode: 'direct',
              confidence: 0.9,
              cited_meeting_count: 1,
              source_count: 1,
              freshness: 'fresh',
            },
          },
        ],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
      });
    const doc = db.upsertKnowledgeDoc({
      scope_type: 'person_context',
      scope_key: person.id,
      title: person.name,
      structured_json: synthesizedDoc('Synthesized before acceptance'),
      status: 'up_to_date',
    });
    const sourceRevision = currentRevision(person.id)!;
    const started = db.dreamingProposalStore.startRun({
      entityId: person.id,
      entityType: 'person',
      sourceRevision,
      model: 'gemma4:12b',
      promptVersion: 'dreaming-v1',
    });
    expect(started.status).toBe('started');
    db.dreamingProposalStore.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'person_headline',
          payload: { headline: 'Trusted launch partner' },
          evidence: [
            { meetingId: 'claims-meeting-1', excerpt: 'Trusted partner' },
          ],
          fingerprint: 'claims-headline',
        },
        {
          kind: 'person_focus',
          payload: { focus: 'Launch readiness' },
          evidence: [
            { meetingId: 'claims-meeting-2', excerpt: 'Launch ready' },
          ],
          fingerprint: 'claims-focus',
        },
        {
          kind: 'person_collaborator',
          payload: { name: 'Jordan Lee' },
          evidence: [{ meetingId: 'claims-meeting-3', excerpt: 'With Jordan' }],
          fingerprint: 'claims-collaborator',
        },
      ],
    });
    for (const proposal of db.dreamingProposalStore.listPendingProposals(
      person.id,
      'person',
    )) {
      expect(
        db.acceptDreamingProposal({
          proposalId: proposal.id,
          getCurrentSourceRevision: currentRevision,
        }).status,
      ).toBe('accepted');
    }

    db.upsertKnowledgeDoc({
      id: doc.id,
      scope_type: 'person_context',
      scope_key: person.id,
      title: person.name,
      structured_json: synthesizedDoc('Synthesized after acceptance'),
      status: 'up_to_date',
    });
    const briefing = db.getPersonBriefing(person.id)!;
    const compiled = compileKnowledgeBrief(
      briefing.knowledgeDoc,
      briefing.workingMemorySnapshot,
    );
    expect(compiled.headline).toBe('Trusted launch partner');
    expect(compiled.supportingBullets).toEqual(
      expect.arrayContaining(['Launch readiness', 'Jordan Lee']),
    );
    expect(compiled.evidenceIndex.map((entry) => entry.meeting_id)).toEqual(
      expect.arrayContaining([
        'claims-meeting-1',
        'claims-meeting-2',
        'claims-meeting-3',
      ]),
    );
    db.upsertKnowledgeDoc({
      id: doc.id,
      scope_type: 'person_context',
      scope_key: person.id,
      title: person.name,
      structured_json: JSON.stringify({
        schema_version: 2,
        current_read: { headline: 'Partial refresh', supporting_bullets: [] },
      }),
      status: 'up_to_date',
    });
    const afterPartialRefresh = db.getPersonBriefing(person.id)!;
    const partiallyCompiled = compileKnowledgeBrief(
      afterPartialRefresh.knowledgeDoc,
      afterPartialRefresh.workingMemorySnapshot,
    );
    expect(partiallyCompiled.headline).toBe('Trusted launch partner');
    expect(partiallyCompiled.supportingBullets).toEqual(
      expect.arrayContaining(['Launch readiness', 'Jordan Lee']),
    );
    expect(db.getDreamingEntityBaseline(person.id)).toMatchObject({
      currentRead: {
        headline: 'Trusted launch partner',
        supportingBullets: expect.arrayContaining([
          'Launch readiness',
          'Jordan Lee',
        ]),
      },
      acceptedPersonClaims: expect.arrayContaining([
        expect.objectContaining({
          kind: 'person_focus',
          sourceMeetingIds: ['claims-meeting-2'],
        }),
      ]),
    });
  });

  it('persistently removes a generated milestone without removing a coincident user milestone', () => {
    const project = db.upsertEntity({
      id: 'dreaming-remove-milestone-project',
      type: 'project',
      name: 'Dreaming Remove Milestone Project',
    });
    db.saveProjectMilestone(project.id, {
      title: 'Shared milestone title',
      status: 'planned',
    });
    const sourceRevision = currentRevision(project.id)!;
    const started = db.dreamingProposalStore.startRun({
      entityId: project.id,
      entityType: 'project',
      sourceRevision,
      model: 'gemma4:12b',
      promptVersion: 'dreaming-v1',
    });
    expect(started.status).toBe('started');
    db.dreamingProposalStore.completeRun({
      runId: started.run.id,
      leaseToken: started.run.leaseToken,
      status: 'proposed',
      proposals: [
        {
          kind: 'project_milestone',
          payload: { name: 'Shared milestone title', status: 'in_progress' },
          evidence: [{ meetingId: 'remove-meeting', excerpt: 'In progress' }],
          fingerprint: 'generated-shared-milestone',
        },
      ],
    });
    const proposal = db.dreamingProposalStore.listPendingProposals(
      project.id,
      'project',
    )[0];
    db.acceptDreamingProposal({
      proposalId: proposal.id,
      getCurrentSourceRevision: currentRevision,
    });
    const generated = db
      .getProjectBrief(project.id)!
      .milestones.find((milestone) => milestone.source === 'dreaming')!;

    db.deleteProjectMilestone(project.id, generated.id);

    const reloaded = db.getProjectBrief(project.id)!;
    expect(
      reloaded.milestones.filter(
        (milestone) => milestone.title === 'Shared milestone title',
      ),
    ).toEqual([expect.objectContaining({ source: 'user' })]);
    expect(db.getEntityCorrections(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_type: 'dreaming:project_milestone',
          fingerprint: 'generated-shared-milestone',
          reason: 'removed_by_user',
        }),
      ]),
    );
  });
});
