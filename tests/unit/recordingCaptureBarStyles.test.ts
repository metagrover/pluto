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
  it('keeps the back-home control clear of the macOS window controls', () => {
    const rule = baseRuleFor('.recording-capture-bar');

    expect(rule).toBeDefined();
    expect(applyTokensFor(rule!)).toEqual(
      expect.arrayContaining(['relative', 'pl-24', 'pr-6']),
    );
    expect(applyTokensFor(rule!)).not.toContain('px-6');
  });

  it('aligns a compact back control with the desktop traffic-light row', () => {
    const baseRule = baseRuleFor('.recording-back-home');
    const compactRule = mediaRuleFor(
      '.recording-back-home',
      'max-width: 980px',
    );

    expect(baseRule).toBeDefined();
    expect(applyTokensFor(baseRule!)).toEqual(
      expect.arrayContaining([
        'absolute',
        'left-24',
        'top-2',
        'h-8',
        'w-8',
        'justify-center',
        'p-0',
      ]),
    );
    expect(compactRule).toBeDefined();
    expect(applyTokensFor(compactRule!)).toContain('left-20');
  });
});
