import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import { excerptQueryEvidence } from '../../electron/intelligence/queryEvidenceExcerpt';

test('fitting notes remain unchanged', () => {
  assert.equal(
    excerptQueryEvidence('Morgan owns testing.', 'testing', 100),
    'Morgan owns testing.',
  );
});
test('preserves an owner/date below a late workstream heading within budget', () => {
  const text = [
    '[Meeting]: Warehouse plan',
    '[Occurred]: 2026-05-01',
    ...Array.from(
      { length: 20 },
      (_, i) => `Background ${i}: unrelated platform discussion.`,
    ),
    'Warehouse packing',
    'Morgan owns readiness validation.',
    'Packing begins May 5 after supplies arrive.',
    ...Array.from(
      { length: 30 },
      (_, i) => `Background appendix ${i}: unrelated discussion.`,
    ),
  ].join('\n');
  const result = excerptQueryEvidence(
    text,
    'What are the concrete next steps for warehouse packing with owners and dates?',
    500,
  );
  assert.ok(result.length <= 500);
  assert.match(result, /\[Occurred\]: 2026-05-01/);
  assert.match(result, /Morgan owns/);
  assert.match(result, /May 5/);
  assert.match(result, /\[Text omitted\]/);
});
test('paragraph sentences retain nearby numeric evidence', () => {
  const text = `${'Background platform discussion. '.repeat(30)}Harbor inventory review. Seventeen crates contain nine sealed boxes. Remaining boxes need inspection. ${'More unrelated background. '.repeat(30)}`;
  const result = excerptQueryEvidence(
    text,
    'What is the latest Harbor inventory crate count and sealed boxes?',
    450,
  );
  assert.ok(result.length <= 450);
  assert.match(result, /Seventeen crates contain nine sealed boxes/);
  assert.match(result, /Remaining boxes need inspection/);
});
test('preserves original ordering across separated facets', () => {
  const text = [
    'Orchard irrigation',
    'Taylor owns pump readiness, due May 3.',
    ...Array.from({ length: 30 }, (_, i) => `Unrelated ${i} platform context.`),
    'Observatory calibration',
    'Morgan owns lens alignment, due May 7.',
  ].join('\n');
  const result = excerptQueryEvidence(
    text,
    'Compare orchard irrigation and observatory calibration.',
    300,
  );
  assert.ok(result.length <= 300);
  assert.ok(
    result.indexOf('Orchard irrigation') <
      result.indexOf('Observatory calibration'),
  );
  assert.match(result, /Taylor owns/);
  assert.match(result, /Morgan owns/);
});
test('no-match fallback remains explicitly truncated and bounded', () => {
  const result = excerptQueryEvidence(
    'Background. '.repeat(200),
    'quasar',
    200,
  );
  assert.equal(result.length, 200);
  assert.match(result, /\[Text omitted\]/);
});

it('retains authoritative task state before selecting relevant note excerpts', () => {
  const state =
    '[Canonical commitment state — overrides older notes]:\nMorgan — rejected: Send the obsolete report.';
  const text = `${state}\n[Meeting]: Review\n${'Morgan discussed reports. '.repeat(100)}\nMorgan owns a new acceptance report.`;
  const excerpt = excerptQueryEvidence(text, 'Morgan report', 500);
  expect(excerpt).toContain('Morgan — rejected: Send the obsolete report.');
  expect(excerpt.length).toBeLessThanOrEqual(500);
});
