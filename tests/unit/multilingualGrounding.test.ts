import { expect, it } from 'vitest';
import { groundSourceReviewedItem } from '../../electron/llm/analysisGrounding';

it('does not assign a mentioned task to the speaker of a non-English statement', () => {
  const evidence = 'Маша отправит отчет завтра.';
  const result = groundSourceReviewedItem(
    { text: 'Отправить отчет', kind: 'action', owner: 'Milo', due: null },
    {
      evidence,
      quotedEvidence: evidence,
      sourceLine: `Milo: ${evidence}`,
      sourceLines: [`Milo: ${evidence}`],
      lineIndex: 0,
    },
  );
  expect(result?.owner ?? null).toBeNull();
});

it('does not turn an unrelated non-English date mention into a deadline', () => {
  const evidence = 'I will send the outline. Завтра обсуждаем бюджет команды.';
  const result = groundSourceReviewedItem(
    { text: 'Send the outline', kind: 'action', owner: 'Milo', due: 'Завтра' },
    {
      evidence,
      quotedEvidence: evidence,
      sourceLine: `Milo: ${evidence}`,
      sourceLines: [`Milo: ${evidence}`],
      lineIndex: 0,
    },
  );
  expect(result?.due ?? null).toBeNull();
});

it('keeps request rejection when an English request has non-English context', () => {
  const evidence =
    'Could you send the outline? Обсуждаем новый проект команды.';
  const result = groundSourceReviewedItem(
    { text: 'Send the outline', kind: 'action', owner: 'Milo', due: null },
    {
      evidence,
      quotedEvidence: evidence,
      sourceLine: `Milo: ${evidence}`,
      sourceLines: [`Milo: ${evidence}`],
      lineIndex: 0,
    },
  );
  expect(result).toBeNull();
});
