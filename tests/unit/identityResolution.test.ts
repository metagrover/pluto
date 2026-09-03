import { describe, expect, it } from 'vitest';
import {
  buildIdentityResolutionRequest,
  buildIdentityVerificationRequest,
  resolveCommitmentOwner,
} from '../../electron/identityResolution';
import type { IdentityContext } from '../../src/types/identity';

const context = (): IdentityContext => ({
  meetingId: 'meeting-a',
  sourceRevision: 'revision-a',
  turns: [{ id: 't1', speaker: 'Me', text: 'I will send the proposal.' }],
  people: [
    { id: 'person-a', name: 'Rowan' },
    { id: 'person-b', name: 'Taylor' },
  ],
  bindings: [],
  capture: { origin: 'unknown', selfPersonId: null },
});
const input = { text: 'Send the proposal', ownerLabel: 'Me', evidence: null };
it('requests no invented transcript identity quote for a confirmed binding', () => {
  for (const build of [
    buildIdentityResolutionRequest,
    buildIdentityVerificationRequest,
  ]) {
    expect(build(input, context()).prompt).toContain(
      'When a confirmed binding supplies identity, return identityEvidence: []',
    );
    expect(build(input, context()).prompt).toContain(
      'A named assignee need not match the speaking turn',
    );
  }
});
const noGeneration = async (): Promise<string> => {
  throw new Error('Unexpected inference');
};
const quote = { turnId: 't1', quote: 'I will send the proposal.' };
const proposal = (fields: Record<string, unknown> = {}) => ({
  status: 'resolved',
  personId: 'person-a',
  speaker: 'Me',
  ownershipKind: 'first_person',
  evidence: [quote],
  identityEvidence: [{ turnId: 't0', quote: 'I am Rowan.' }],
  reason: 'The speaker introduces themselves and undertakes the action.',
  ...fields,
});
const generated = (...values: unknown[]) => {
  let call = 0;
  return async () =>
    JSON.stringify(values[Math.min(call++, values.length - 1)]);
};
const introduced = (): IdentityContext => ({
  ...context(),
  turns: [{ id: 't0', speaker: 'Me', text: 'I am Rowan.' }, ...context().turns],
});
const bound = (personId: string | null = 'person-a'): IdentityContext => ({
  ...context(),
  bindings: [
    {
      speaker: 'Me',
      personId,
      individual: true,
      source: 'user',
      sourceRevision: 'old',
      evidence: [],
    },
  ],
});

const captureBound = (): IdentityContext => ({
  ...context(),
  capture: { origin: 'local', selfPersonId: 'person-a' },
  bindings: [
    {
      ...bound().bindings[0],
      source: 'capture',
      sourceRevision: 'revision-a',
      captureEvidence: {
        origin: 'local',
        selfPersonId: 'person-a',
        attributionSource: 'offline_diarization_acoustic_v1',
        confidence: 0.9,
        mappingApplied: true,
        sourceRevision: 'revision-a',
      },
    },
  ],
});

describe('resolveCommitmentOwner', () => {
  it('keeps declared aliases as candidate data in both independent source requests', () => {
    const source = introduced();
    Object.assign(source.people[0], {
      aliases: ['Ro', 'Rowan Lee'],
      industry: 'private-industry',
      role: 'private-role',
    });
    for (const build of [
      buildIdentityResolutionRequest,
      buildIdentityVerificationRequest,
    ]) {
      const request = build(input, source);
      expect(request.prompt).toContain(
        'Declared aliases are user-supplied names',
      );
      expect(request.prompt).toContain('"aliases":["Ro","Rowan Lee"]');
      expect(request.prompt).not.toContain('private-industry');
      expect(request.prompt).not.toContain('private-role');
    }
  });
  it('does not use a shared declared alias to choose between distinct people', async () => {
    const source = introduced();
    Object.assign(source.people[0], { aliases: ['Ro'] });
    Object.assign(source.people[1], { aliases: ['Ro'] });
    source.turns[0].text = 'I am Ro.';
    const result = await resolveCommitmentOwner(
      input,
      source,
      generated(
        proposal({
          identityEvidence: [{ turnId: 't0', quote: 'I am Ro.' }],
        }),
      ),
    );
    expect(result.status).toBe('unresolved');
    expect(result.ownerKey).toBeNull();
  });
  it('rejects oversized or malformed declared aliases before generation', async () => {
    for (const aliases of [
      ['x'.repeat(201)],
      Array(13).fill('Ro'),
      [123],
      'Ro',
    ]) {
      const source = introduced();
      Object.assign(source.people[0], { aliases });
      await expect(
        resolveCommitmentOwner(input, source, noGeneration),
      ).rejects.toThrow(/alias/i);
    }
  });
  it('uses a validated explicit person assignment without inference', async () => {
    expect(
      await resolveCommitmentOwner(
        { ...input, explicitPersonId: 'person-b' },
        context(),
        noGeneration,
      ),
    ).toMatchObject({
      status: 'resolved',
      ownerKey: 'person:person-b',
      personId: 'person-b',
      source: 'user',
    });
  });

  it('rejects nonexistent explicit IDs', async () => {
    await expect(
      resolveCommitmentOwner(
        { ...input, explicitPersonId: 'foreign' },
        context(),
        noGeneration,
      ),
    ).rejects.toThrow(/person/i);
  });
  it('resolves corrected speaker bindings and retains no workspace singleton', async () => {
    expect(
      await resolveCommitmentOwner(
        input,
        bound(),
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({ ownerKey: 'person:person-a', source: 'inference' });
    const other = bound('person-b');
    expect(
      await resolveCommitmentOwner(
        input,
        other,
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({ ownerKey: 'person:person-b' });
    expect(input.ownerLabel).toBe('Me');
  });
  it('keeps unknown individual speakers meeting-local', async () => {
    const first = await resolveCommitmentOwner(
      input,
      bound(null),
      generated(proposal({ personId: null, identityEvidence: [] })),
    );
    const second = await resolveCommitmentOwner(
      input,
      { ...bound(null), meetingId: 'meeting-b' },
      generated(proposal({ personId: null, identityEvidence: [] })),
    );
    expect(first.status).toBe('resolved');
    expect(first.ownerKey).toBe('meeting:meeting-a:speaker:Me');
    expect(first.personId).toBeNull();
    expect(second.ownerKey).not.toBe(first.ownerKey);
  });
  it('does not use stale inferred bindings', async () => {
    const stale = bound();
    stale.bindings[0].source = 'source';
    expect(
      await resolveCommitmentOwner(
        input,
        stale,
        generated(
          proposal({
            status: 'unresolved',
            personId: null,
            speaker: null,
            evidence: [],
            identityEvidence: [],
            ownershipKind: 'ambiguous',
          }),
        ),
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('does not use a user binding whose speaker no longer exists', async () => {
    expect(
      await resolveCommitmentOwner(
        input,
        { ...bound(), turns: [] },
        noGeneration,
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('returns conflict for incompatible user bindings', async () => {
    const conflicting = bound();
    conflicting.bindings.push(bound('person-b').bindings[0]);
    expect(
      await resolveCommitmentOwner(
        input,
        conflicting,
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({ status: 'conflicting', ownerKey: null });
  });
  it('prioritizes explicit assignments over conflicting source bindings', async () => {
    const conflicting = bound();
    conflicting.bindings.push(bound('person-b').bindings[0]);
    expect(
      await resolveCommitmentOwner(
        { ...input, explicitPersonId: 'person-a' },
        conflicting,
        noGeneration,
      ),
    ).toMatchObject({ status: 'resolved', source: 'user' });
  });
  it.each(['local', 'imported', 'unknown'] as const)(
    'never identifies Me using only %s capture self metadata',
    async (origin) => {
      const ctx = {
        ...context(),
        capture: { origin, selfPersonId: 'person-a' },
      };
      const response = proposal({ identityEvidence: [] });
      expect(
        await resolveCommitmentOwner(input, ctx, generated(response)),
      ).toMatchObject({ status: 'unresolved' });
    },
  );
  it('requires two independent source-grounded judgments for a source introduction', async () => {
    const requests: string[] = [];
    const result = await resolveCommitmentOwner(
      input,
      introduced(),
      async (prompt) => {
        requests.push(prompt);
        return JSON.stringify(proposal({ reason: 'SECRET_PROPOSAL_REASON' }));
      },
    );
    expect(result).toMatchObject({
      status: 'resolved',
      ownerKey: 'person:person-a',
      source: 'inference',
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([quote, { turnId: 't0', quote: 'I am Rowan.' }]),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toContain('SECRET_PROPOSAL_REASON');
    expect(requests[1]).toContain('I am Rowan.');
  });
  it('corrects an extracted owner using the source, not the summary label', async () => {
    expect(
      await resolveCommitmentOwner(
        { ...input, ownerLabel: 'Taylor' },
        introduced(),
        generated(proposal()),
      ),
    ).toMatchObject({ personId: 'person-a' });
  });
  it('supports a source-grounded third-person assignment', async () => {
    const ctx = context();
    ctx.turns[0].text = 'Taylor agreed to send the proposal.';
    const evidence = [{ turnId: 't1', quote: ctx.turns[0].text }];
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(
          proposal({
            personId: 'person-b',
            speaker: null,
            ownershipKind: 'named_assignment',
            evidence,
            identityEvidence: evidence,
          }),
        ),
      ),
    ).toMatchObject({ ownerKey: 'person:person-b' });
  });
  it.each(['collective', 'quoted', 'ambiguous', 'request'])(
    'never converts %s statements into an individual obligation',
    async (ownershipKind) => {
      expect(
        await resolveCommitmentOwner(
          input,
          introduced(),
          generated(proposal({ ownershipKind })),
        ),
      ).toMatchObject({ status: 'unresolved' });
    },
  );
  it('abstains for duplicate same-name people without explicit binding', async () => {
    const ctx = introduced();
    ctx.people[1].name = 'Rowan';
    expect(
      await resolveCommitmentOwner(input, ctx, generated(proposal())),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('allows an explicit binding to disambiguate same-name people', async () => {
    const ctx = bound('person-b');
    ctx.people[1].name = 'Rowan';
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({ personId: 'person-b' });
  });
  it('does not treat an extracted bound owner label as proof of action ownership', async () => {
    const ctx = bound();
    ctx.turns[0].text = 'Taylor agreed to send the proposal.';
    const evidence = [{ turnId: 't1', quote: ctx.turns[0].text }];
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(
          proposal({
            personId: 'person-b',
            speaker: null,
            ownershipKind: 'named_assignment',
            evidence,
            identityEvidence: evidence,
          }),
        ),
      ),
    ).toMatchObject({ personId: 'person-b' });
  });
  it('does not convert a bound speaker quotation into their own obligation', async () => {
    const ctx = bound();
    ctx.turns[0].text = 'The note says "I will send the proposal."';
    const evidence = [{ turnId: 't1', quote: ctx.turns[0].text }];
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(
          proposal({
            ownershipKind: 'quoted',
            personId: null,
            identityEvidence: [],
            evidence,
          }),
        ),
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('does not turn a mixed remote channel into an individual', async () => {
    const ctx = introduced();
    ctx.bindings = [
      { ...bound().bindings[0], individual: false, personId: null },
    ];
    expect(
      await resolveCommitmentOwner(input, ctx, generated(proposal())),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('requires a verified individual binding for a speaker-only result', async () => {
    expect(
      await resolveCommitmentOwner(
        input,
        context(),
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('does not use a different speaker for a first-person commitment', async () => {
    const ctx = introduced();
    ctx.turns.push({ id: 't2', speaker: 'Them', text: 'Okay.' });
    await expect(
      resolveCommitmentOwner(
        input,
        ctx,
        generated(proposal({ speaker: 'Them' })),
      ),
    ).rejects.toThrow(/speaker/i);
  });
  it.each([
    { personId: 'made-up' },
    { speaker: 'made-up' },
    { evidence: [{ turnId: 'foreign', quote: quote.quote }] },
    { evidence: [{ turnId: 't1', quote: 'fabricated quote' }] },
    { evidence: [] },
    { identityEvidence: [{ turnId: 't0', quote: 'fabricated identity' }] },
    { confidence: 1 },
    { ownershipKind: 'made-up' },
  ])('rejects malformed or unsupported model output %j', async (fields) => {
    await expect(
      resolveCommitmentOwner(input, introduced(), generated(proposal(fields))),
    ).rejects.toThrow(/identity/i);
  });
  it('does not resolve after verification abstains', async () => {
    const unresolved = proposal({
      status: 'unresolved',
      personId: null,
      speaker: null,
      ownershipKind: 'ambiguous',
      evidence: [],
      identityEvidence: [],
    });
    expect(
      await resolveCommitmentOwner(
        input,
        introduced(),
        generated(proposal(), unresolved),
      ),
    ).toMatchObject({ status: 'unresolved', ownerKey: null });
  });
  it('exposes source disagreements as conflicting', async () => {
    const ctx = introduced();
    ctx.turns.push({
      id: 't2',
      speaker: 'Them',
      text: 'Taylor agreed to send the proposal.',
    });
    const evidence = [{ turnId: 't2', quote: ctx.turns[2].text }];
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(
          proposal(),
          proposal({
            personId: 'person-b',
            speaker: null,
            ownershipKind: 'named_assignment',
            evidence,
            identityEvidence: evidence,
          }),
        ),
      ),
    ).toMatchObject({ status: 'conflicting' });
  });
  it('throws provider failures and malformed JSON rather than making them unresolved', async () => {
    await expect(
      resolveCommitmentOwner(input, context(), async () => {
        throw new Error('Provider unavailable');
      }),
    ).rejects.toThrow('Provider unavailable');
    await expect(
      resolveCommitmentOwner(input, context(), async () => 'not json'),
    ).rejects.toThrow();
  });
  it('honors cancellation even if the provider ignores it', async () => {
    const controller = new AbortController();
    await expect(
      resolveCommitmentOwner(
        input,
        introduced(),
        async () => {
          controller.abort();
          return JSON.stringify(proposal());
        },
        controller.signal,
      ),
    ).rejects.toThrow(/abort/i);
  });
  it('rejects pre-cancelled deterministic work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveCommitmentOwner(input, bound(), noGeneration, controller.signal),
    ).rejects.toThrow(/abort/i);
  });
  it('leaves oversized complete sources unresolved without truncating source', async () => {
    const ctx = context();
    ctx.turns[0].text = 'x'.repeat(40_000);
    expect(
      await resolveCommitmentOwner(input, ctx, noGeneration),
    ).toMatchObject({
      status: 'unresolved',
      reason: expect.stringMatching(/bound|size|fit/i),
    });
  });
  it('rejects oversized action input', async () => {
    await expect(
      resolveCommitmentOwner(
        { ...input, text: 'x'.repeat(40_000) },
        context(),
        noGeneration,
      ),
    ).rejects.toThrow(/size|bound/i);
  });
  it('exports source-complete production prompts, with no capture identity shortcut', () => {
    for (const builder of [
      buildIdentityResolutionRequest,
      buildIdentityVerificationRequest,
    ]) {
      const request = builder(input, introduced());
      expect(request.prompt).toContain('I am Rowan.');
      expect(request.prompt).toContain('I will send the proposal.');
      expect(request.prompt).toContain('person-a');
      expect(request.prompt).not.toContain('selfPersonId');
      expect(request.schema).toHaveProperty('properties.identityEvidence');
    }
  });
  it('uses a disclosed bounded source window around one exact evidence anchor', async () => {
    const ctx = introduced();
    ctx.turns.push(
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `padding-${index}`,
        speaker: 'Them',
        text: 'Other discussion. '.repeat(100),
      })),
    );
    const anchored = { ...input, evidence: quote.quote };
    const result = await resolveCommitmentOwner(
      anchored,
      ctx,
      generated(proposal()),
    );
    expect(result).toMatchObject({ status: 'resolved', personId: 'person-a' });
    const request = buildIdentityResolutionRequest(anchored, ctx);
    expect(request.prompt).toContain('"kind":"window"');
    expect(request.prompt).toContain('"omittedTurnCount":28');
    expect(request.prompt).not.toContain('padding-29');
    expect(request.prompt).not.toContain(
      'from the complete original transcript',
    );
  });
  it('keeps source-binding identity evidence and its neighbors in an anchored window', async () => {
    const ctx = introduced();
    ctx.turns.splice(
      1,
      0,
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `padding-${index}`,
        speaker: 'Them',
        text: 'Other discussion. '.repeat(100),
      })),
    );
    ctx.bindings = [
      {
        ...bound().bindings[0],
        source: 'source',
        sourceRevision: ctx.sourceRevision,
        evidence: [{ turnId: 't0', quote: 'I am Rowan.' }],
      },
    ];
    const anchored = { ...input, evidence: quote.quote };
    const request = buildIdentityResolutionRequest(anchored, ctx);
    expect(request.prompt).toContain('I am Rowan.');
    expect(request.prompt).toContain('padding-0');
    expect(request.prompt).toContain('padding-29');
    expect(request.prompt).not.toContain('padding-15');
    expect(
      await resolveCommitmentOwner(
        anchored,
        ctx,
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({ personId: 'person-a' });
  });
  it('abstains when an anchored window lacks relevant disambiguating context', async () => {
    const ctx = introduced();
    ctx.turns.push(
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `padding-${index}`,
        speaker: 'Them',
        text: 'Other discussion. '.repeat(100),
      })),
    );
    const unresolved = proposal({
      status: 'unresolved',
      personId: null,
      speaker: null,
      ownershipKind: 'ambiguous',
      evidence: [],
      identityEvidence: [],
      reason: 'The source window omits the referenced prior assignment.',
    });
    expect(
      await resolveCommitmentOwner(
        { ...input, evidence: quote.quote },
        ctx,
        generated(unresolved),
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('rejects model quotes from outside the supplied source window', async () => {
    const ctx = introduced();
    ctx.turns.push(
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `padding-${index}`,
        speaker: 'Me',
        text: 'Other discussion. '.repeat(100),
      })),
    );
    await expect(
      resolveCommitmentOwner(
        { ...input, evidence: quote.quote },
        ctx,
        generated(
          proposal({
            identityEvidence: [
              { turnId: 'padding-29', quote: 'Other discussion.' },
            ],
          }),
        ),
      ),
    ).rejects.toThrow(/foreign/);
  });
  it('does not select one of several matching anchors in an oversized source', async () => {
    const ctx = context();
    ctx.turns.push(
      { id: 'duplicate', speaker: 'Them', text: quote.quote },
      { id: 'large', speaker: 'Them', text: 'x'.repeat(40_000) },
    );
    expect(
      await resolveCommitmentOwner(
        { ...input, evidence: quote.quote },
        ctx,
        noGeneration,
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('does not clip an oversized required neighboring turn', async () => {
    const ctx = context();
    ctx.turns.push({
      id: 'large-neighbor',
      speaker: 'Them',
      text: 'x'.repeat(40_000),
    });
    expect(
      await resolveCommitmentOwner(
        { ...input, evidence: quote.quote },
        ctx,
        noGeneration,
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('rejects ambiguous named-assignment output that also identifies a speaker', async () => {
    await expect(
      resolveCommitmentOwner(
        input,
        introduced(),
        generated(proposal({ ownershipKind: 'named_assignment' })),
      ),
    ).rejects.toThrow(/named|speaker/i);
  });
  it('includes the source binding evidence in final inference provenance', async () => {
    const ctx = introduced();
    ctx.bindings = [
      {
        ...bound().bindings[0],
        source: 'source',
        sourceRevision: ctx.sourceRevision,
        evidence: [{ turnId: 't0', quote: 'I am Rowan.' }],
      },
    ];
    const result = await resolveCommitmentOwner(
      input,
      ctx,
      generated(proposal({ personId: null, identityEvidence: [] })),
    );
    expect(result.evidence).toContainEqual({
      turnId: 't0',
      quote: 'I am Rowan.',
    });
  });
  it('allows a named assignment despite a misleading extracted aggregate-channel label', async () => {
    const ctx = context();
    ctx.turns[0].text = 'Taylor agreed to send the proposal.';
    ctx.bindings = [
      { ...bound().bindings[0], individual: false, personId: null },
    ];
    const evidence = [{ turnId: 't1', quote: ctx.turns[0].text }];
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(
          proposal({
            personId: 'person-b',
            speaker: null,
            ownershipKind: 'named_assignment',
            evidence,
            identityEvidence: evidence,
          }),
        ),
      ),
    ).toMatchObject({ personId: 'person-b' });
  });
  it('preserves user correction priority over a contradictory current source binding', async () => {
    const ctx = introduced();
    ctx.bindings = [
      bound('person-b').bindings[0],
      {
        ...bound().bindings[0],
        source: 'source',
        sourceRevision: ctx.sourceRevision,
        evidence: [{ turnId: 't0', quote: 'I am Rowan.' }],
      },
    ];
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({ personId: 'person-b' });
  });
  it('rejects current source bindings with missing supporting quotes', async () => {
    const ctx = bound();
    ctx.bindings[0].source = 'source';
    ctx.bindings[0].sourceRevision = ctx.sourceRevision;
    await expect(
      resolveCommitmentOwner(input, ctx, noGeneration),
    ).rejects.toThrow(/binding.*evidence/i);
  });
  it('rejects duplicate source turn IDs before attempting inference', async () => {
    const ctx = context();
    ctx.turns.push({ ...ctx.turns[0] });
    await expect(
      resolveCommitmentOwner(input, ctx, noGeneration),
    ).rejects.toThrow(/duplicate/);
  });
  it('does not silently accept invalid independent verification output', async () => {
    await expect(
      resolveCommitmentOwner(
        input,
        introduced(),
        generated(proposal(), proposal({ personId: 'invented' })),
      ),
    ).rejects.toThrow(/person/);
  });
  it.each([{ status: ['resolved'] }, { ownershipKind: ['first_person'] }])(
    'rejects non-string enum outputs %j',
    async (fields) => {
      await expect(
        resolveCommitmentOwner(
          input,
          introduced(),
          generated(proposal(fields)),
        ),
      ).rejects.toThrow(/identity/);
    },
  );
  it('treats whitespace/case variants of a duplicate person name as ambiguous', async () => {
    const ctx = introduced();
    ctx.people = [
      { id: 'person-a', name: 'Rowan Lane' },
      { id: 'person-b', name: ' ROWAN   LANE ' },
    ];
    ctx.turns[0].text = 'I am Rowan Lane.';
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(
          proposal({
            identityEvidence: [{ turnId: 't0', quote: 'I am Rowan Lane.' }],
          }),
        ),
      ),
    ).toMatchObject({ status: 'unresolved' });
  });
  it('retains validated capture provenance through independent verification and serialization', async () => {
    const ctx = captureBound();
    const result = await resolveCommitmentOwner(
      input,
      ctx,
      generated(proposal({ personId: null, identityEvidence: [] })),
    );
    expect(result).toMatchObject({
      status: 'resolved',
      personId: 'person-a',
      source: 'inference',
      identityProvenance: {
        source: 'capture',
        captureEvidence: ctx.bindings[0].captureEvidence,
      },
    });
    expect(result.evidence).toEqual([quote]);
    expect(JSON.parse(JSON.stringify(result)).identityProvenance).toEqual(
      result.identityProvenance,
    );
  });
  it.each(['imported', 'unknown'] as const)(
    'rejects forged capture bindings for %s recordings',
    async (origin) => {
      const ctx = captureBound();
      ctx.capture.origin = origin;
      await expect(
        resolveCommitmentOwner(input, ctx, noGeneration),
      ).rejects.toThrow(/capture/i);
    },
  );
  it.each([
    { confidence: 0.84 },
    { confidence: Number.NaN },
    { confidence: 1.1 },
    { mappingApplied: false },
    { sourceRevision: 'old' },
    { selfPersonId: 'person-b' },
    { attributionSource: 'channel_fallback' },
    { origin: 'imported' },
  ])('rejects unsupported capture provenance %j', async (fields) => {
    const ctx = captureBound();
    Object.assign(ctx.bindings[0].captureEvidence ?? {}, fields);
    await expect(
      resolveCommitmentOwner(input, ctx, noGeneration),
    ).rejects.toThrow(/capture/i);
  });
  it('does not accept a source quote as a substitute for capture provenance', async () => {
    const ctx = captureBound();
    ctx.bindings[0].captureEvidence = undefined;
    ctx.bindings[0].evidence = [quote];
    await expect(
      resolveCommitmentOwner(input, ctx, noGeneration),
    ).rejects.toThrow(/capture/i);
  });
  it('ignores stale capture bindings without reusing their old provenance', async () => {
    const ctx = captureBound();
    ctx.bindings[0].sourceRevision = 'old';
    const result = await resolveCommitmentOwner(
      input,
      ctx,
      generated(proposal({ personId: null, identityEvidence: [] })),
    );
    expect(result.status).toBe('unresolved');
    expect(result.identityProvenance).toBeUndefined();
  });
  it('requires capture person, context self, and individual scope to agree', async () => {
    const mismatched = captureBound();
    mismatched.capture.selfPersonId = 'person-b';
    await expect(
      resolveCommitmentOwner(input, mismatched, noGeneration),
    ).rejects.toThrow(/capture/i);
    const collective = captureBound();
    collective.bindings[0].individual = false;
    await expect(
      resolveCommitmentOwner(input, collective, noGeneration),
    ).rejects.toThrow(/capture/i);
  });
  it('lets a user correction supersede invalid capture attribution and retains user provenance', async () => {
    const ctx = captureBound();
    ctx.capture.origin = 'imported';
    ctx.bindings.push(bound('person-b').bindings[0]);
    expect(
      await resolveCommitmentOwner(
        input,
        ctx,
        generated(proposal({ personId: null, identityEvidence: [] })),
      ),
    ).toMatchObject({
      personId: 'person-b',
      identityProvenance: { source: 'user' },
    });
  });
  it('keeps capture provenance even if only the independent verification uses that binding', async () => {
    const ctx = captureBound();
    ctx.turns.push({
      id: 't2',
      speaker: 'Them',
      text: 'Rowan agreed to send the proposal.',
    });
    const evidence = [{ turnId: 't2', quote: ctx.turns[1].text }];
    const result = await resolveCommitmentOwner(
      input,
      ctx,
      generated(
        proposal({
          personId: 'person-a',
          speaker: null,
          ownershipKind: 'named_assignment',
          evidence,
          identityEvidence: evidence,
        }),
        proposal({ personId: null, identityEvidence: [] }),
      ),
    );
    expect(result.identityProvenance).toMatchObject({
      source: 'capture',
      captureEvidence: ctx.bindings[0].captureEvidence,
    });
  });
});
