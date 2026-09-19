export const MEETING_NOTES_DEFAULT_TEMPLATE_SETTING =
  'meeting_notes_default_template';
export const MEETING_NOTES_TEMPLATE_OVERRIDES_SETTING =
  'meeting_notes_template_overrides';
export const MEETING_NOTES_TEMPLATE_GUIDANCE_MAX_LENGTH = 2_000;

export const meetingNotesTemplateIds = [
  'auto',
  'one_on_one',
  'manager_one_on_one',
  'team_sync',
  'daily_standup',
  'customer_call',
  'sales_call',
  'interview',
  'project_kickoff',
  'project_sync',
  'retrospective',
  'brainstorming',
] as const;

export type MeetingNotesTemplate = (typeof meetingNotesTemplateIds)[number];

export type MeetingNotesTemplateDefinition = {
  id: MeetingNotesTemplate;
  label: string;
  description: string;
  guidance: string;
};

export type ResolvedMeetingNotesTemplate = {
  id: MeetingNotesTemplate;
  label: string;
  guidance: string;
  source: 'built_in' | 'custom';
  revision: string;
};

export type MeetingNotesTemplateSettingsSnapshot = {
  defaultTemplateId: MeetingNotesTemplate;
  overrides: Partial<Record<MeetingNotesTemplate, string>>;
  templates: Array<
    MeetingNotesTemplateDefinition & {
      resolvedGuidance: string;
      customized: boolean;
    }
  >;
};

export type MeetingNotesTemplateSettingsUpdate =
  | { operation: 'set_default'; templateId: MeetingNotesTemplate }
  | {
      operation: 'save_override';
      templateId: MeetingNotesTemplate;
      guidance: string;
    }
  | { operation: 'reset_override'; templateId: MeetingNotesTemplate };

export type MeetingNotesTemplateInput =
  | MeetingNotesTemplate
  | ResolvedMeetingNotesTemplate;

export const meetingNotesTemplates: readonly MeetingNotesTemplateDefinition[] =
  [
    {
      id: 'auto',
      label: 'Auto',
      description: 'Adapts the notes to the meeting as it unfolds.',
      guidance:
        'Infer the meeting shape from the source and emphasize only the sections and outcomes that add signal.',
    },
    {
      id: 'one_on_one',
      label: '1:1',
      description: 'A flexible one-to-one conversation between two people.',
      guidance:
        'Emphasize priorities, concerns, feedback, support needed, growth, and concrete follow-ups without turning the conversation into a generic status report.',
    },
    {
      id: 'manager_one_on_one',
      label: 'Manager 1:1',
      description: 'A report-led manager and direct-report conversation.',
      guidance:
        'Center the direct report’s topics. Emphasize accomplishments, blockers, two-way feedback, career growth, wellbeing or personal context only when explicitly stated, support the manager owes, and commitments for both people. Do not reduce the meeting to project status.',
    },
    {
      id: 'team_sync',
      label: 'Team sync',
      description: 'Recurring alignment across a team.',
      guidance:
        'Emphasize meaningful progress, blockers, dependencies, decisions, owners, and next steps across the team. Compact routine updates that do not change shared understanding.',
    },
    {
      id: 'daily_standup',
      label: 'Daily stand-up',
      description: 'A concise daily progress and blocker check.',
      guidance:
        'Keep the notes brief. Organize completed work, planned work, blockers, dependencies, handoffs, and any changed commitment by person or workstream when the source supports it.',
    },
    {
      id: 'customer_call',
      label: 'Customer call',
      description: 'Customer needs, evidence, and follow-through.',
      guidance:
        'Emphasize customer goals, needs, pain points, use cases, direct evidence, product feedback, commitments, and follow-ups. Distinguish what the customer said from internal interpretation.',
    },
    {
      id: 'sales_call',
      label: 'Sales call',
      description: 'Discovery, objections, stakeholders, and next steps.',
      guidance:
        'Emphasize discovery evidence, needs and pain, objections, stakeholders, commercial or timing signals, qualification facts, commitments, and the next customer step. Never infer budget, authority, or purchase intent when it was not stated.',
    },
    {
      id: 'interview',
      label: 'Interview',
      description: 'Structured evidence from a candidate or subject interview.',
      guidance:
        'Emphasize questions and themes, concrete examples, demonstrated strengths, supported concerns, open follow-ups, and evaluation evidence. Avoid unsupported conclusions or details unrelated to the interview criteria.',
    },
    {
      id: 'project_kickoff',
      label: 'Project kickoff',
      description: 'Initial alignment on a new project.',
      guidance:
        'Emphasize goals, success criteria, scope and non-scope, roles, milestones, dependencies, risks, communication expectations, open questions, and immediate next steps.',
    },
    {
      id: 'project_sync',
      label: 'Project sync',
      description: 'Progress against an active project plan.',
      guidance:
        'Emphasize progress against milestones, changes to scope or timing, blockers, dependencies, risks, decisions, owners, dates, and the next checkpoint.',
    },
    {
      id: 'retrospective',
      label: 'Retrospective',
      description: 'Reflection and concrete process improvement.',
      guidance:
        'Emphasize what worked, what did not, causes only when explicitly supported, lessons, proposed experiments or improvements, owners, and when the team will inspect the result.',
    },
    {
      id: 'brainstorming',
      label: 'Brainstorming',
      description: 'Ideas, tradeoffs, and promising directions.',
      guidance:
        'Emphasize the problem framing, distinct idea clusters, tradeoffs, shortlisted or rejected directions with stated rationale, decisions, open questions, and next experiments. Do not present every suggestion as an agreed plan.',
    },
  ];

const templateById = new Map(
  meetingNotesTemplates.map((template) => [template.id, template]),
);

export const isMeetingNotesTemplate = (
  value: unknown,
): value is MeetingNotesTemplate =>
  typeof value === 'string' && templateById.has(value as MeetingNotesTemplate);

export const normalizeMeetingNotesTemplateGuidance = (
  value: unknown,
): string => {
  if (typeof value !== 'string') throw new Error('invalid_template_guidance');
  const guidance = value.trim().replace(/\r\n?/g, '\n');
  if (!guidance) throw new Error('invalid_template_guidance');
  if (guidance.length > MEETING_NOTES_TEMPLATE_GUIDANCE_MAX_LENGTH) {
    throw new Error('template_guidance_too_long');
  }
  return guidance;
};

export const parseMeetingNotesTemplateOverrides = (
  value: unknown,
): Partial<Record<MeetingNotesTemplate, string>> => {
  try {
    const parsed =
      typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const overrides: Partial<Record<MeetingNotesTemplate, string>> = {};
    for (const [id, guidance] of Object.entries(parsed)) {
      if (!isMeetingNotesTemplate(id)) continue;
      try {
        overrides[id] = normalizeMeetingNotesTemplateGuidance(guidance);
      } catch {
        // One corrupt entry must not hide the remaining valid preferences.
      }
    }
    return overrides;
  } catch {
    return {};
  }
};

export const createMeetingNotesTemplateSettingsSnapshot = (
  defaultTemplate: unknown,
  rawOverrides: unknown,
): MeetingNotesTemplateSettingsSnapshot => {
  const defaultTemplateId = isMeetingNotesTemplate(defaultTemplate)
    ? defaultTemplate
    : 'auto';
  const overrides = parseMeetingNotesTemplateOverrides(rawOverrides);
  return {
    defaultTemplateId,
    overrides,
    templates: meetingNotesTemplates.map((template) => ({
      ...template,
      resolvedGuidance: overrides[template.id] ?? template.guidance,
      customized: overrides[template.id] !== undefined,
    })),
  };
};

const guidanceRevision = (id: MeetingNotesTemplate, guidance: string) => {
  let hash = 0x811c9dc5;
  for (const character of `${id}\u0000${guidance}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `template-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const resolveMeetingNotesTemplate = (
  snapshot: MeetingNotesTemplateSettingsSnapshot,
  requestedTemplate?: unknown,
): ResolvedMeetingNotesTemplate => {
  const id = isMeetingNotesTemplate(requestedTemplate)
    ? requestedTemplate
    : snapshot.defaultTemplateId;
  const definition = templateById.get(id) ?? meetingNotesTemplates[0];
  const customGuidance = snapshot.overrides[id];
  const guidance = customGuidance ?? definition.guidance;
  return {
    id,
    label: definition.label,
    guidance,
    source: customGuidance === undefined ? 'built_in' : 'custom',
    revision: guidanceRevision(id, guidance),
  };
};

export const resolveMeetingNotesTemplateInput = (
  input: MeetingNotesTemplateInput,
): ResolvedMeetingNotesTemplate => {
  if (typeof input !== 'string') return input;
  return resolveMeetingNotesTemplate(
    createMeetingNotesTemplateSettingsSnapshot('auto', {}),
    input,
  );
};

export const applyMeetingNotesTemplateSettingsUpdate = (
  snapshot: MeetingNotesTemplateSettingsSnapshot,
  update: unknown,
): MeetingNotesTemplateSettingsSnapshot => {
  if (!update || typeof update !== 'object') {
    throw new Error('invalid_template_settings_update');
  }
  const operation = update as Partial<MeetingNotesTemplateSettingsUpdate>;
  if (!isMeetingNotesTemplate(operation.templateId)) {
    throw new Error('invalid_template_id');
  }
  if (operation.operation === 'set_default') {
    return createMeetingNotesTemplateSettingsSnapshot(
      operation.templateId,
      snapshot.overrides,
    );
  }
  const overrides = { ...snapshot.overrides };
  if (operation.operation === 'save_override') {
    overrides[operation.templateId] = normalizeMeetingNotesTemplateGuidance(
      (operation as { guidance?: unknown }).guidance,
    );
  } else if (operation.operation === 'reset_override') {
    delete overrides[operation.templateId];
  } else {
    throw new Error('invalid_template_settings_update');
  }
  return createMeetingNotesTemplateSettingsSnapshot(
    snapshot.defaultTemplateId,
    overrides,
  );
};

export const meetingNotesTemplateOptions = meetingNotesTemplates.map(
  ({ id, label }) => ({ value: id, label }),
);
