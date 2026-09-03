import { describe, expect, it } from 'vitest';
import type {
  DreamingInputPackage,
  RawDreamingProposal,
} from '../../electron/dreaming/types';
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
