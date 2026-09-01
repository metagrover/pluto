import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const root = postcss.parse(readFileSync('src/index.css', 'utf8'));

const isInsideMediaQuery = (rule: Rule) => {
  let parent = rule.parent;

  while (parent) {
    if (parent.type === 'atrule' && parent.name === 'media') return true;
    parent = parent.parent;
  }

  return false;
};

const baseRuleFor = (selector: string) => {
  let match: Rule | undefined;

  root.walkRules(selector, (rule) => {
    if (!isInsideMediaQuery(rule)) match = rule;
  });

  return match;
};

const applyTokensFor = (rule: Rule) =>
  rule.nodes
    .filter((node) => node.type === 'atrule' && node.name === 'apply')
    .flatMap((node) => node.params.split(/\s+/));

describe('recording capture bar styles', () => {
  it('keeps the back-home control clear of the macOS window controls', () => {
    const rule = baseRuleFor('.recording-capture-bar');

    expect(rule).toBeDefined();
    expect(applyTokensFor(rule!)).toEqual(
      expect.arrayContaining(['pl-24', 'pr-6']),
    );
    expect(applyTokensFor(rule!)).not.toContain('px-6');
  });
});
