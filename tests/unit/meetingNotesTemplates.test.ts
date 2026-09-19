import { describe, expect, it } from 'vitest';

import {
  MEETING_NOTES_TEMPLATE_GUIDANCE_MAX_LENGTH,
  applyMeetingNotesTemplateSettingsUpdate,
  createMeetingNotesTemplateSettingsSnapshot,
  meetingNotesTemplates,
  resolveMeetingNotesTemplate,
} from '../../electron/llm/meetingNotesTemplates';

describe('meeting note templates', () => {
  it('ships the curated catalog with Auto as the backward-compatible default', () => {
    const snapshot = createMeetingNotesTemplateSettingsSnapshot(null, null);

    expect(snapshot.defaultTemplateId).toBe('auto');
    expect(meetingNotesTemplates.map(({ id }) => id)).toEqual([
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
    ]);
  });

  it('keeps valid overrides when another stored entry is corrupt', () => {
    const snapshot = createMeetingNotesTemplateSettingsSnapshot(
      'manager_one_on_one',
      JSON.stringify({
        manager_one_on_one: '  Center the report.  ',
        project_sync: '',
        unknown: 'ignored',
      }),
    );

    expect(snapshot.defaultTemplateId).toBe('manager_one_on_one');
    expect(snapshot.overrides).toEqual({
      manager_one_on_one: 'Center the report.',
    });
    expect(resolveMeetingNotesTemplate(snapshot)).toMatchObject({
      id: 'manager_one_on_one',
      guidance: 'Center the report.',
      source: 'custom',
    });
  });

  it('saves and resets guidance without changing the selected default', () => {
    const initial = createMeetingNotesTemplateSettingsSnapshot(
      'daily_standup',
      {},
    );
    const customized = applyMeetingNotesTemplateSettingsUpdate(initial, {
      operation: 'save_override',
      templateId: 'retrospective',
      guidance: '  Focus on experiments and owners.  ',
    });
    const resolved = resolveMeetingNotesTemplate(customized, 'retrospective');

    expect(customized.defaultTemplateId).toBe('daily_standup');
    expect(resolved.source).toBe('custom');
    expect(resolved.guidance).toBe('Focus on experiments and owners.');

    const reset = applyMeetingNotesTemplateSettingsUpdate(customized, {
      operation: 'reset_override',
      templateId: 'retrospective',
    });
    expect(resolveMeetingNotesTemplate(reset, 'retrospective').source).toBe(
      'built_in',
    );
  });

  it('changes the revision when customized guidance changes', () => {
    const initial = createMeetingNotesTemplateSettingsSnapshot('auto', {});
    const first = resolveMeetingNotesTemplate(initial, 'team_sync');
    const customized = applyMeetingNotesTemplateSettingsUpdate(initial, {
      operation: 'save_override',
      templateId: 'team_sync',
      guidance: 'Prioritize cross-team dependencies.',
    });
    const second = resolveMeetingNotesTemplate(customized, 'team_sync');

    expect(second.revision).not.toBe(first.revision);
  });

  it('rejects blank, oversized, and unknown updates', () => {
    const snapshot = createMeetingNotesTemplateSettingsSnapshot('auto', {});

    expect(() =>
      applyMeetingNotesTemplateSettingsUpdate(snapshot, {
        operation: 'save_override',
        templateId: 'auto',
        guidance: '   ',
      }),
    ).toThrow('invalid_template_guidance');
    expect(() =>
      applyMeetingNotesTemplateSettingsUpdate(snapshot, {
        operation: 'save_override',
        templateId: 'auto',
        guidance: 'x'.repeat(MEETING_NOTES_TEMPLATE_GUIDANCE_MAX_LENGTH + 1),
      }),
    ).toThrow('template_guidance_too_long');
    expect(() =>
      applyMeetingNotesTemplateSettingsUpdate(snapshot, {
        operation: 'set_default',
        templateId: 'made_up',
      }),
    ).toThrow('invalid_template_id');
  });
});
