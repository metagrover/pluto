import { describe, expect, it } from 'vitest';
import {
  type CommitmentSemanticRecord,
  findSemanticCommitmentMatches,
} from '../../electron/commitmentSemanticReview';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';

const suite =
  process.env.RUN_COMMITMENT_SEMANTIC_ACCEPTANCE === '1'
    ? describe
    : describe.skip;
const record = (
  id: string,
  text: string,
  changes: Partial<CommitmentSemanticRecord> = {},
): CommitmentSemanticRecord => ({
  id,
  text,
  owner: 'Alex',
  ownerKey: changes.owner === 'Blair' ? 'person:blair' : 'person:alex',
  due: '2026-09-04',
  meetingId: 'release-meeting',
  meetingDate: '2026-08-28',
  context:
    'Alex committed to publishing the release readiness checklist for Project Cedar by September 4.',
  reviewState: 'possible',
  status: 'active',
  ...changes,
});

suite('configured local-model commitment meaning acceptance', () => {
  it('recognizes paraphrases without merging changed owners, scope, deadlines or recurring occurrences', async () => {
    const provider = new UnifiedLLMProvider('ollama', {});
    const prior = [
      record(
        'reviewed',
        'Publish the release readiness checklist for Project Cedar',
        { reviewState: 'rejected' },
      ),
    ];
    const cases: Array<[CommitmentSemanticRecord, string | undefined]> = [
      [
        record(
          'paraphrase',
          'Make the Cedar launch go/no-go checklist available',
        ),
        'reviewed',
      ],
      [
        record(
          'owner',
          'Publish the release readiness checklist for Project Cedar',
          {
            owner: 'Blair',
            context: 'Blair separately agreed to publish a checklist.',
          },
        ),
        undefined,
      ],
      [
        record(
          'deadline',
          'Publish the release readiness checklist for Project Cedar',
          {
            due: '2026-10-02',
            context:
              'This is the checklist for the October launch, not September.',
          },
        ),
        undefined,
      ],
      [
        record(
          'scope',
          'Review the release readiness checklist for Project Cedar',
          {
            context:
              'Alex must review a checklist authored by another person; this does not include publishing it.',
          },
        ),
        undefined,
      ],
      [
        record(
          'project',
          'Publish the release readiness checklist for Project Birch',
          { context: 'Birch and Cedar are independent projects.' },
        ),
        undefined,
      ],
      [
        record('recurrence', 'Publish the weekly release readiness checklist', {
          due: '2026-09-11',
          meetingId: 'following-week',
          meetingDate: '2026-09-07',
          context:
            'This is the next weekly checklist, a new occurrence after the previous one.',
        }),
        undefined,
      ],
      [
        record(
          'negation',
          'Do not publish the release readiness checklist; withdraw it',
          {
            context:
              'The release is cancelled. Withdraw the checklist instead of publishing it.',
          },
        ),
        undefined,
      ],
      [
        record(
          'confirmed-paraphrase',
          'Share the Cedar release readiness checklist',
        ),
        'reviewed',
      ],
    ];
    for (let start = 0; start < cases.length; start += 4) {
      const batch = cases.slice(start, start + 4);
      const result = await findSemanticCommitmentMatches(
        batch.map(([candidate]) => candidate),
        prior,
        async (prompt, responseSchema, signal) => {
          const raw = await provider.synthesizeKnowledgeDocument(prompt, {
            purpose: 'commitmentReconciliation',
            responseSchema,
            signal,
          });
          console.log(JSON.stringify({ batch: start / 4, raw }));
          return raw;
        },
        AbortSignal.timeout(180_000),
      );
      for (const [candidate, expected] of batch) {
        console.log(
          JSON.stringify({
            case: candidate.id,
            expected: expected ?? null,
            actual: result.get(candidate.id) ?? null,
          }),
        );
        expect(result.get(candidate.id)?.matchId, candidate.id).toBe(expected);
      }
    }
    const sharedContext =
      'This meeting discussed professional development: certification options and attendance at industry conferences. Both initiatives support the same career-development plan.';
    const certification = record(
      'certification-outreach',
      'Ask the training team which cloud certification to pursue',
      { context: sharedContext },
    );
    const conference = record(
      'conference-budget',
      'Ask the manager to approve the conference travel budget',
      { context: sharedContext },
    );
    const existingCertification = record(
      'existing-certification',
      'Contact the training team for advice on choosing a cloud certification',
      { context: sharedContext, reviewState: 'rejected' },
    );
    for (const history of [[conference], [conference, existingCertification]]) {
      const result = await findSemanticCommitmentMatches(
        [certification],
        history,
        async (prompt, responseSchema, signal) => {
          const raw = await provider.synthesizeKnowledgeDocument(prompt, {
            purpose: 'commitmentReconciliation',
            responseSchema,
            signal,
          });
          console.log(JSON.stringify({ sharedContextRegression: true, raw }));
          return raw;
        },
        AbortSignal.timeout(180_000),
      );
      expect(result.get(certification.id)?.matchId).toBe(
        history.length === 1 ? undefined : existingCertification.id,
      );
    }
  }, 1_500_000);
});
