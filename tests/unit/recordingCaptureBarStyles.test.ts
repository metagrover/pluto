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

const mediaRuleFor = (selector: string, mediaQuery: string) => {
  let match: Rule | undefined;

  root.walkRules(selector, (rule) => {
    let parent = rule.parent;
    while (parent) {
      if (
        parent.type === 'atrule' &&
        parent.name === 'media' &&
        parent.params.includes(mediaQuery)
      ) {
        match = rule;
      }
      parent = parent.parent;
    }
  });

  return match;
};

const applyTokensFor = (rule: Rule) =>
  rule.nodes
    .filter((node) => node.type === 'atrule' && node.name === 'apply')
    .flatMap((node) => node.params.split(/\s+/));

describe('recording capture bar styles', () => {
  it('positions the capture bar under the macOS window controls with top spacing', () => {
    const rule = baseRuleFor('.recording-capture-bar');

    expect(rule).toBeDefined();
    expect(applyTokensFor(rule!)).toEqual(
      expect.arrayContaining(['relative', 'pt-12', 'px-6', 'pb-4']),
    );
    expect(applyTokensFor(rule!)).not.toContain('pl-24');
  });

  it('aligns a compact back control inline with recording status', () => {
    const baseRule = baseRuleFor('.recording-back-home');
    const statusRule = baseRuleFor('.recording-status');

    expect(baseRule).toBeDefined();
    expect(applyTokensFor(baseRule!)).toEqual(
      expect.arrayContaining(['flex', 'h-8', 'w-8', 'justify-center', 'p-0']),
    );
    expect(applyTokensFor(baseRule!)).not.toContain('absolute');
    expect(statusRule).toBeDefined();
    expect(applyTokensFor(statusRule!)).not.toContain('pl-10');
  });
});
