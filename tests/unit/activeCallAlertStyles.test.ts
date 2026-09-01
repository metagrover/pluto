import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const root = postcss.parse(
  readFileSync('src/components/alerts/activeCallAlert.css', 'utf8'),
);

const ruleFor = (selector: string) => {
  let match: Rule | undefined;
  root.walkRules(selector, (rule) => {
    match = rule;
  });
  return match;
};

const declarationsFor = (selector: string) => {
  const declarations = new Map<string, string>();
  ruleFor(selector)?.walkDecls((declaration) => {
    declarations.set(declaration.prop, declaration.value);
  });
  return declarations;
};

describe('active call alert styles', () => {
  it('uses the compact meeting-status notification vocabulary', () => {
    const alert = declarationsFor('.active-call-alert');
    const action = declarationsFor('.take-notes');
    const progress = declarationsFor('.progress-track');

    expect(alert.get('border-radius')).toBe('8px');
    expect(alert.get('border')).toContain('1px solid');
    expect(alert.get('padding')).toBe('10px 12px');
    expect(action.get('height')).toBe('34px');
    expect(action.get('border-radius')).toBe('6px');
    expect(progress.get('height')).toBe('1px');
  });

  it('keeps status, action, and dismiss controls as distinct affordances', () => {
    expect(ruleFor('.status-icon')).toBeDefined();
    expect(ruleFor('.take-notes:focus-visible')).toBeDefined();
    expect(ruleFor('.close-alert:focus-visible')).toBeDefined();
    expect(ruleFor('@media (prefers-reduced-motion: reduce)')).toBeUndefined();

    let hasReducedMotion = false;
    root.walkAtRules('media', (rule) => {
      if (rule.params === '(prefers-reduced-motion: reduce)') {
        hasReducedMotion = true;
      }
    });
    expect(hasReducedMotion).toBe(true);
  });
});
