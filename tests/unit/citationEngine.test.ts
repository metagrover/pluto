import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '../../electron/db';
import {
  auditCitations,
  buildCitationChain,
} from '../../electron/intelligence/citationEngine';
import type { RetrievalResult } from '../../electron/intelligence/intelligenceTypes';

vi.mock('../../electron/db', () => ({
  getEntity: vi.fn(),
  getMeetingMid: vi.fn(),
}));

describe('Citation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildCitationChain', () => {
    it('extracts citation tags from LLM output correctly', () => {
      const answer =
        'Here is what happened: <cite meeting="m1" entity="e1" quote="let\'s migrate">We decided to migrate</cite>. Later, <cite meeting="m2">No quote</cite>.';

      const context = [
        { meeting_id: 'm1', mid: { title: 'First Meeting' } },
        { meeting_id: 'm2', mid: { title: 'Second Meeting' } },
      ] as RetrievalResult[];

      const citations = buildCitationChain(answer, context);

      expect(citations.length).toBe(2);
      expect(citations[0]).toMatchObject({
        meeting_id: 'm1',
        entity_id: 'e1',
        evidence_span: "let's migrate",
        claim: 'We decided to migrate',
        meeting_title: 'First Meeting',
        evidence_valid: false,
      });

      expect(citations[1]).toMatchObject({
        meeting_id: 'm2',
        evidence_span: undefined,
        claim: 'No quote',
        meeting_title: 'Second Meeting',
        evidence_valid: false,
      });
    });
  });

  describe('auditCitations', () => {
    it('audits valid citations successfully', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue({
        evidence_spans: [{ quote: 'hello this is a test' }],
      } as unknown as ReturnType<typeof dbModule.getMeetingMid>);

      vi.mocked(dbModule.getEntity).mockReturnValue({
        id: 'e1',
      } as unknown as dbModule.Entity);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          entity_id: 'e1',
          evidence_span: 'this is a test',
          evidence_valid: false,
          meeting_title: 'Meeting 1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(true);
    });

    it('fails audit if meeting is not found', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue(null);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          evidence_valid: false,
          meeting_title: 'M1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(false);
    });

    it('fails audit if entity is not found', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue(
        {} as ReturnType<typeof dbModule.getMeetingMid>,
      );
      vi.mocked(dbModule.getEntity).mockReturnValue(undefined);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          entity_id: 'e_invalid',
          evidence_valid: false,
          meeting_title: 'M1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(false);
    });

    it('fails audit if evidence span is missing from MID', () => {
      vi.mocked(dbModule.getMeetingMid).mockReturnValue({
        evidence_spans: [{ quote: 'some other thing entirely' }],
      } as unknown as ReturnType<typeof dbModule.getMeetingMid>);

      const citations = [
        {
          claim: 'test',
          meeting_id: 'm1',
          evidence_span: 'not found quote',
          evidence_valid: false,
          meeting_title: 'M1',
        },
      ];

      const audited = auditCitations(citations);
      expect(audited[0].evidence_valid).toBe(false);
    });
  });
});
