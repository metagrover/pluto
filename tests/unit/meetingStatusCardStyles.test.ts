import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const stylesheet = postcss.parse(readFileSync('src/index.css', 'utf8'));

const normalizeSelector = (selector: string) =>
  selector.replace(/\s+/g, ' ').trim();

const rulesFor = (selector: string) => {
  const rules: Rule[] = [];
  stylesheet.walkRules((rule) => {
    if (normalizeSelector(rule.selector) === normalizeSelector(selector)) {
      rules.push(rule);
    }
  });
  return rules;
};

const enclosingMedia = (rule: Rule) => {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && parent.name === 'media') return parent;
    parent = parent.parent;
  }
  return undefined;
};

const declarationsFor = (rule: Rule) =>
  Object.fromEntries(
    rule.nodes
      .filter((node) => node.type === 'decl')
      .map((node) => [node.prop, node.value]),
  );

describe('meeting status card containment styles', () => {
  it('constrains meeting-status-card to the reading surface column width', () => {
    const defaultRule = rulesFor('.meeting-status-card').find(
      (candidate) => !enclosingMedia(candidate),
    );
    expect(defaultRule).toBeDefined();
    expect(declarationsFor(defaultRule!)).toMatchObject({
      width: 'calc(100% - 3rem)',
      'max-width': 'calc(760px - 4rem)',
    });

    const mdRule = rulesFor('.meeting-status-card').find((candidate) => {
      const media = enclosingMedia(candidate) as AtRule | undefined;
      return media?.params === '(min-width: 768px)';
    });
    expect(mdRule).toBeDefined();
    expect(declarationsFor(mdRule!)).toMatchObject({
      width: 'calc(100% - 4rem)',
    });
  });
});
