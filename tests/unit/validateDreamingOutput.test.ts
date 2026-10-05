import { describe, expect, it } from 'vitest';
import type {
  DreamingInputPackage,
  RawDreamingProposal,
} from '../../electron/dreaming/types';
import { MAX_DREAMING_PROPOSALS } from '../../electron/dreaming/types';
import {
  generateItemFingerprint,
  generateProposalFingerprint,
  validateDreamingOutput,
} from '../../electron/dreaming/validateDreamingOutput';

const projectPackage: DreamingInputPackage = {
  entityId: 'project-1',
  entityType: 'project',
  entityName: 'Billing V2',
  sourceRevision: 'revision-1',
  recentMeetingNotes: [
    {
      meetingId: 'meeting-1',
      title: 'Architecture review',
      startedAt: '2026-08-01T10:00:00.000Z',
      notesContent:
        'The team agreed that Stripe Elements is in progress. Launch is planned for October.',
    },
    {
      meetingId: 'meeting-2',
      title: 'Trust review',
      startedAt: '2026-08-02T10:00:00.000Z',
      notesContent:
        'Billing V2’s migration remains the team’s primary focus. Stripe Elements is in progress.',
    },
  ],
  correctionFingerprints: [],
  negativeConstraints: [],
};

const personPackage: DreamingInputPackage = {
  ...projectPackage,
  entityId: 'person-1',
  entityType: 'person',
  entityName: 'Alice',
  recentMeetingNotes: [
    {
      meetingId: 'meeting-person',
      title: 'Weekly sync',
      startedAt: '2026-08-03T10:00:00.000Z',
      notesContent: 'Alice is focused on the proposal review experience.',
    },
  ],
};

const milestoneProposal = (): RawDreamingProposal => ({
  kind: 'project_milestone',
  payload: { name: 'Stripe Elements connected', status: 'in_progress' },
  evidence: [
    {
      meetingId: 'meeting-1',
      excerpt: 'Stripe Elements is in progress.',
    },
  ],
});

const validate = (value: unknown, pkg: DreamingInputPackage = projectPackage) =>
  validateDreamingOutput(JSON.stringify(value), pkg);

const expectInvalid = (
  value: unknown,
  pkg: DreamingInputPackage = projectPackage,
) => expect(validate(value, pkg)).toMatchObject({ valid: false });

describe('validateDreamingOutput', () => {
  it('rejects invalid JSON and markdown fences', () => {
    expect(validateDreamingOutput('{', projectPackage)).toMatchObject({
      valid: false,
    });
    expect(
      validateDreamingOutput(
        '```json\n{"status":"no_change","proposals":[]}\n```',
        projectPackage,
      ),
    ).toMatchObject({ valid: false });
  });

  it.each([
    { proposals: [] },
    { status: 'updated', proposals: [] },
    { status: null, proposals: [] },
  ])('rejects an unknown or missing status: %j', (output) => {
    expectInvalid(output);
  });

  it('requires no_change to contain exactly an empty proposals array', () => {
    expectInvalid({ status: 'no_change', proposals: [milestoneProposal()] });
    expectInvalid({ status: 'no_change' });
    expectInvalid({
      status: 'no_change',
      proposals: [],
      reason: 'nothing new',
    });
  });

  it('requires proposed to contain at least one proposal', () => {
    expectInvalid({ status: 'proposed', proposals: [] });
  });

  it('rejects proposal batches above the durable review limit', () => {
    expectInvalid({
      status: 'proposed',
      proposals: Array.from(
        { length: MAX_DREAMING_PROPOSALS + 1 },
        milestoneProposal,
      ),
    });
  });

  it.each([
    {
      name: 'root',
      mutate: (proposal: RawDreamingProposal) => ({
        status: 'proposed',
        proposals: [proposal],
        extra: true,
      }),
    },
    {
      name: 'proposal',
      mutate: (proposal: RawDreamingProposal) => ({
        status: 'proposed',
        proposals: [{ ...proposal, extra: true }],
      }),
    },
    {
      name: 'payload',
      mutate: (proposal: RawDreamingProposal) => ({
        status: 'proposed',
        proposals: [
          { ...proposal, payload: { ...proposal.payload, extra: true } },
        ],
      }),
    },
    {
      name: 'evidence',
      mutate: (proposal: RawDreamingProposal) => ({
        status: 'proposed',
        proposals: [
          {
            ...proposal,
            evidence: [{ ...proposal.evidence[0], extra: true }],
          },
        ],
      }),
    },
  ])('rejects unknown $name fields', ({ mutate }) => {
    expectInvalid(mutate(milestoneProposal()));
  });

  it('rejects unknown kinds and kinds for the wrong entity type', () => {
    expectInvalid({
      status: 'proposed',
      proposals: [{ ...milestoneProposal(), kind: 'project_risk' }],
    });
    expectInvalid(
      { status: 'proposed', proposals: [milestoneProposal()] },
      personPackage,
    );
  });

  it('rejects unknown meeting IDs', () => {
    const proposal = milestoneProposal();
    proposal.evidence[0].meetingId = 'meeting-unknown';
    expectInvalid({ status: 'proposed', proposals: [proposal] });
  });

  it('rejects empty and unmatched excerpts', () => {
    const empty = milestoneProposal();
    empty.evidence[0].excerpt = '   ';
    expectInvalid({ status: 'proposed', proposals: [empty] });

    const unmatched = milestoneProposal();
    unmatched.evidence[0].excerpt = 'Stripe Elements has already shipped.';
    expectInvalid({ status: 'proposed', proposals: [unmatched] });
  });

  it('requires project summaries to cite two distinct meetings', () => {
    expectInvalid({
      status: 'proposed',
      proposals: [
        {
          kind: 'project_summary',
          payload: { summary: 'The billing migration is underway.' },
          evidence: [
            {
              meetingId: 'meeting-1',
              excerpt: 'Stripe Elements is in progress.',
            },
            {
              meetingId: 'meeting-1',
              excerpt: 'Launch is planned for October.',
            },
          ],
        },
      ],
    });
  });

  it('rejects tentative ideas presented as project commitments', () => {
    const tentativePackage: DreamingInputPackage = {
      ...projectPackage,
      recentMeetingNotes: [
        {
          meetingId: 'meeting-1',
          title: 'Strategy review',
          startedAt: '2026-08-01T10:00:00.000Z',
          notesContent:
            'A dossier approach to capture client interest signals was proposed as an alternative method of engagement, with the aim of converting potential leads into actual sales.',
        },
      ],
    };
    expectInvalid(
      {
        status: 'proposed',
        proposals: [
          {
            kind: 'project_commitment',
            payload: {
              task: 'Develop a dossier approach to capture client interest signals.',
            },
            evidence: [
              {
                meetingId: 'meeting-1',
                excerpt:
                  'A dossier approach to capture client interest signals was proposed as an alternative method of engagement, with the aim of converting potential leads into actual sales.',
              },
            ],
          },
        ],
      },
      tentativePackage,
    );
  });

  it.each([
    'The team had not agreed to deliver the billing migration checklist.',
    'The team will not deliver the billing migration checklist.',
    'If procurement approves, the team will deliver the billing migration checklist.',
    'Delivery is subject to approval, and the team will provide the billing migration checklist.',
    'The team proposed a Friday handoff but agreed to revisit the delivery date.',
    'The team is not committed to delivering the billing migration checklist.',
    'The team never agreed to deliver the billing migration checklist.',
    'The team is not assigned to deliver the billing migration checklist.',
    'The team suggests Alice will deliver the billing migration checklist.',
    'The team proposes Alice will deliver the billing migration checklist.',
    "The team isn't committed to delivering the billing migration checklist.",
    "The team wasn't assigned to deliver the billing migration checklist.",
    'The team cannot deliver the billing migration checklist.',
    'Once procurement approves, the team will deliver the billing migration checklist.',
    'When procurement approves, the team will deliver the billing migration checklist.',
    'Upon approval, the team will deliver the billing migration checklist.',
    'The team will likely deliver the billing migration checklist.',
    'The team probably will deliver the billing migration checklist.',
    'The team will possibly deliver the billing migration checklist.',
    'The team will deliver the billing migration checklist as long as procurement approves.',
  ])('rejects negated or conditional commitment evidence: %s', (excerpt) => {
    const qualifiedPackage: DreamingInputPackage = {
      ...projectPackage,
      recentMeetingNotes: [
        {
          meetingId: 'meeting-1',
          title: 'Delivery review',
          startedAt: '2026-08-01T10:00:00.000Z',
          notesContent: excerpt,
        },
      ],
    };
    expectInvalid(
      {
        status: 'proposed',
        proposals: [
          {
            kind: 'project_commitment',
            payload: { task: 'Deliver the billing migration checklist.' },
            evidence: [{ meetingId: 'meeting-1', excerpt }],
          },
        ],
      },
      qualifiedPackage,
    );
  });

  it.each([
    'The team agreed that Alice will deliver the billing migration checklist.',
    'The team agreed on delivering the billing migration checklist.',
    'Alice is responsible for delivering the billing migration checklist.',
    'Alice is tasked with delivering the billing migration checklist.',
    'The team is required to deliver the billing migration checklist.',
    'Action items: deliver the billing migration checklist.',
    'The team decided to deliver the billing migration checklist.',
    'The team must deliver the billing migration checklist.',
    'Alice needs to deliver the billing migration checklist.',
  ])('accepts explicit commitment language variant: %s', (notesContent) => {
    const committedPackage: DreamingInputPackage = {
      ...projectPackage,
      recentMeetingNotes: [
        {
          meetingId: 'meeting-1',
          title: 'Delivery review',
          startedAt: '2026-08-01T10:00:00.000Z',
          notesContent,
        },
      ],
    };
    expect(
      validate(
        {
          status: 'proposed',
          proposals: [
            {
              kind: 'project_commitment',
              payload: { task: 'Deliver the billing migration checklist.' },
              evidence: [{ meetingId: 'meeting-1', excerpt: notesContent }],
            },
          ],
        },
        committedPackage,
      ),
    ).toMatchObject({ valid: true, status: 'proposed' });
  });

  it('accepts a project commitment with explicit commitment language', () => {
    const committedPackage: DreamingInputPackage = {
      ...projectPackage,
      recentMeetingNotes: [
        {
          meetingId: 'meeting-1',
          title: 'Delivery review',
          startedAt: '2026-08-01T10:00:00.000Z',
          notesContent:
            'The team agreed to deliver the billing migration checklist on Friday.',
        },
      ],
    };
    expect(
      validate(
        {
          status: 'proposed',
          proposals: [
            {
              kind: 'project_commitment',
              payload: { task: 'Deliver the billing migration checklist.' },
              evidence: [
                {
                  meetingId: 'meeting-1',
                  excerpt:
                    'The team agreed to deliver the billing migration checklist on Friday.',
                },
              ],
            },
          ],
        },
        committedPackage,
      ),
    ).toMatchObject({ valid: true, status: 'proposed' });
  });

  it('drops an ungrounded commitment proposal if another valid proposal exists in the batch', () => {
    const mixedPackage: DreamingInputPackage = {
      ...projectPackage,
      recentMeetingNotes: [
        {
          meetingId: 'meeting-1',
          title: 'Delivery review',
          startedAt: '2026-08-01T10:00:00.000Z',
          notesContent:
            'Stripe Elements is in progress. The team might deliver the checklist later.',
        },
      ],
    };
    const validProposal = milestoneProposal();
    const tentativeCommitment: RawDreamingProposal = {
      kind: 'project_commitment',
      payload: { task: 'Deliver the checklist later.' },
      evidence: [
        {
          meetingId: 'meeting-1',
          excerpt: 'The team might deliver the checklist later.',
        },
      ],
    };

    const result = validate(
      {
        status: 'proposed',
        proposals: [validProposal, tentativeCommitment],
      },
      mixedPackage,
    );

    expect(result).toMatchObject({
      valid: true,
      status: 'proposed',
      proposals: [
        expect.objectContaining({
          kind: 'project_milestone',
          payload: { name: 'Stripe Elements connected', status: 'in_progress' },
        }),
      ],
    });
    if (result.valid && result.status === 'proposed') {
      expect(result.proposals).toHaveLength(1);
    }
  });

  it('rejects current and legacy correction collisions after normalization', () => {
    const proposal = milestoneProposal();
    const fingerprint = generateProposalFingerprint(proposal, projectPackage);
    expectInvalid(
      { status: 'proposed', proposals: [proposal] },
      {
        ...projectPackage,
        correctionFingerprints: [`  ${fingerprint.toUpperCase()}  `],
      },
    );
    expectInvalid(
      { status: 'proposed', proposals: [proposal] },
      {
        ...projectPackage,
        correctionFingerprints: [],
        negativeConstraints: [' Stripe Elements connected! '],
      },
    );
  });

  it('keeps corrections effective when the same claim cites different evidence', () => {
    const rejected = milestoneProposal();
    const alternateEvidence: RawDreamingProposal = {
      ...milestoneProposal(),
      evidence: [
        {
          meetingId: 'meeting-2',
          excerpt: 'Stripe Elements is in progress.',
        },
      ],
    };
    expectInvalid(
      { status: 'proposed', proposals: [alternateEvidence] },
      {
        ...projectPackage,
        correctionFingerprints: [
          generateProposalFingerprint(rejected, projectPackage),
        ],
      },
    );
  });

  it('does not treat milestone status as a legacy claim correction', () => {
    const result = validate(
      { status: 'proposed', proposals: [milestoneProposal()] },
      { ...projectPackage, negativeConstraints: ['in-progress'] },
    );
    expect(result).toMatchObject({ valid: true, status: 'proposed' });
  });

  it('rejects the same normalized claim with different valid evidence', () => {
    const first = milestoneProposal();
    const duplicate: RawDreamingProposal = {
      kind: 'project_milestone',
      payload: { name: '  stripe elements CONNECTED ', status: 'in_progress' },
      evidence: [
        {
          meetingId: 'meeting-2',
          excerpt: '  STRIPE ELEMENTS is in progress. ',
        },
      ],
    };
    expectInvalid({ status: 'proposed', proposals: [first, duplicate] });
  });

  it('accepts a fully valid project output and deterministically fingerprints it', () => {
    const summary: RawDreamingProposal = {
      kind: 'project_summary',
      payload: { summary: 'The billing migration is underway.' },
      evidence: [
        {
          meetingId: 'meeting-1',
          excerpt: '  stripe elements is in progress.  ',
        },
        {
          meetingId: 'meeting-2',
          excerpt: "Billing V2's migration remains the team's primary focus.",
        },
      ],
    };
    const result = validate({ status: 'proposed', proposals: [summary] });

    expect(result).toEqual({
      valid: true,
      status: 'proposed',
      proposals: [
        {
          ...summary,
          fingerprint: generateProposalFingerprint(summary, projectPackage),
        },
      ],
    });
  });

  it('accepts a fully valid person output', () => {
    const proposal: RawDreamingProposal = {
      kind: 'person_focus',
      payload: { focus: 'Proposal review experience' },
      evidence: [
        {
          meetingId: 'meeting-person',
          excerpt: 'Alice is focused on the proposal review experience.',
        },
      ],
    };
    const result = validate(
      { status: 'proposed', proposals: [proposal] },
      personPackage,
    );

    expect(result).toEqual({
      valid: true,
      status: 'proposed',
      proposals: [
        {
          ...proposal,
          fingerprint: generateProposalFingerprint(proposal, personPackage),
        },
      ],
    });
  });

  it('accepts exact no_change output', () => {
    expect(validate({ status: 'no_change', proposals: [] })).toEqual({
      valid: true,
      status: 'no_change',
      proposals: [],
    });
  });

  it('preserves legacy item fingerprint normalization for entity corrections', () => {
    expect(generateItemFingerprint('Stripe Elements connected')).toBe(
      'stripe-elements-connected',
    );
    expect(generateItemFingerprint('   Stripe   Elements connected!  ')).toBe(
      'stripe-elements-connected',
    );
  });
});

// Source structure and actual task support outrank incidental wording cues.
describe('project commitment source context', () => {
  const check = (task: string, excerpt: string, actionItems?: string[]) =>
    validateDreamingOutput(
      JSON.stringify({
        status: 'proposed',
        proposals: [
          {
            kind: 'project_commitment',
            payload: { task },
            evidence: [{ meetingId: 'm', excerpt }],
          },
        ],
      }),
      {
        entityId: 'p',
        entityType: 'project',
        entityName: 'Launch',
        sourceRevision: 'r',
        negativeConstraints: [],
        recentMeetingNotes: [
          {
            meetingId: 'm',
            title: 'Launch',
            startedAt: null,
            notesContent: excerpt,
            actionItems,
          },
        ],
      },
    );
  it.each([
    "I'll prepare the launch checklist.",
    'I will prepare the launch checklist.',
    'Alex agreed to prepare the launch checklist. The old deployment is not needed.',
    'Alex agreed to prepare the launch checklist. Another option is under consideration.',
  ])(
    'accepts a source-supported promise without unrelated wording poisoning it: %s',
    (excerpt) => {
      expect(check('Prepare the launch checklist', excerpt)).toMatchObject({
        valid: true,
      });
    },
  );
  it('accepts the exact saved action text without manufacturing agreement or ownership', () => {
    expect(
      check('Prepare the launch checklist', 'Prepare the launch checklist', [
        'Prepare the launch checklist',
      ]),
    ).toMatchObject({ valid: true });
    expect(
      check('Prepare the launch checklist', 'Prepare the launch checklist'),
    ).toMatchObject({ valid: false });
  });
  it('keeps a domain noun from being interpreted as tentative language', () => {
    expect(
      check(
        'Update the product options',
        'Alex agreed to update the product options.',
      ),
    ).toMatchObject({ valid: true });
  });
  it.each([
    [
      'Schedule a customer workshop',
      'Alex agreed to prepare the launch checklist.',
    ],
    [
      'Prepare the launch checklist',
      'Alex agreed to schedule a workshop. Prepare the launch checklist.',
    ],
    [
      'Prepare the launch checklist',
      'Alex agreed to not prepare the launch checklist.',
    ],
    [
      'Prepare the launch checklist',
      'If legal approves, Alex will prepare the launch checklist.',
    ],
    [
      'Prepare the launch checklist',
      'Alex will probably prepare the launch checklist.',
    ],
  ])('rejects unsupported or qualified tasks: %s', (task, excerpt) => {
    expect(check(task, excerpt)).toMatchObject({ valid: false });
  });
  it('does not use an unrelated saved action as authorization', () => {
    expect(
      check('Schedule a customer workshop', 'Schedule a customer workshop', [
        'Prepare the launch checklist',
      ]),
    ).toMatchObject({ valid: false });
  });
});
