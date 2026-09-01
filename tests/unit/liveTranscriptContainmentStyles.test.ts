import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const stylesheet = postcss.parse(readFileSync('src/index.css', 'utf8'));

const declarationsFor = (selector: string): Record<string, string> => {
  let declarations: Record<string, string> = {};
  stylesheet.walkRules(selector, (rule) => {
    declarations = Object.fromEntries(
      rule.nodes
        .filter((node) => node.type === 'decl')
        .map((node) => [node.prop, node.value]),
    );
  });
  return declarations;
};

describe('live transcript token containment', () => {
  it('wraps long recognized tokens inside transcript turns', () => {
    expect(declarationsFor('.transcript-turn p')).toMatchObject({
      'overflow-wrap': 'anywhere',
    });
  });

  it('wraps long interim tokens inside the live transcript pane', () => {
    expect(declarationsFor('.transcript-interim')).toMatchObject({
      'overflow-wrap': 'anywhere',
    });
  });
});
