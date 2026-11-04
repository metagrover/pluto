import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Fields must look the same focused and unfocused. A :focus rule that resets
// font, color or spacing outranks each field's own styles and makes text
// jump (e.g. the serif note title turning sans when clicked).
const css = readFileSync(
  path.resolve(__dirname, '../../src/components/features/notes/notes.css'),
  'utf8',
);
const EDITABLE =
  /\.(notion-block-textarea|note-textarea|note-title-input|note-doc-title|meeting-editable-heading)|\.meeting-inline-editable textarea/;
const LAYOUT_OR_TYPE =
  /(^|[;{\s])(font-family|font-size|font-weight|line-height|color|margin|padding)\s*:/;

const rules = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('}')
  .map((chunk) => {
    const [selector = '', body = ''] = chunk.split('{');
    return { selector: selector.trim(), body };
  })
  .filter((rule) => rule.selector && rule.body);

describe('notes editor styles', () => {
  it('never changes an editable field’s font, color or spacing on focus', () => {
    const offenders = rules.filter(
      (rule) =>
        rule.selector
          .split(',')
          .some((part) => /:focus/.test(part) && EDITABLE.test(part)) &&
        LAYOUT_OR_TYPE.test(rule.body),
    );
    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  it('keeps the shared field defaults at zero specificity', () => {
    const defaults = rules.find((rule) => rule.selector.startsWith(':where('));
    expect(defaults?.selector).toContain('.note-title-input');
    expect(defaults?.body).toContain('font-family: inherit');
  });
});
