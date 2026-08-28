import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const root = postcss.parse(readFileSync('src/index.css', 'utf8'));

const normalizeSelector = (selector: string) =>
  selector.replace(/\s+/g, ' ').trim();

const rulesFor = (selector: string) => {
  const rules: Rule[] = [];
  root.walkRules((rule) => {
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

const applyTokensFor = (rule: Rule) =>
  rule.nodes
    .filter((node) => node.type === 'atrule' && node.name === 'apply')
    .flatMap((node) => node.params.split(/\s+/));

describe('Zen Ask Pluto dock styles', () => {
  it('keeps the notes rail and transcript in the first grid row', () => {
    const [railRule] = rulesFor(
      '.recording-workspace-grid > .recording-rail',
    );
    const [transcriptRule] = rulesFor(
      '.recording-workspace-grid > .live-transcript',
    );

    expect(railRule).toBeDefined();
    expect(declarationsFor(railRule)).toMatchObject({
      'grid-column': '1',
      'grid-row': '1',
    });
    expect(transcriptRule).toBeDefined();
    expect(declarationsFor(transcriptRule)).toMatchObject({
      'grid-column': '2',
      'grid-row': '1',
    });
  });

  it('overlays the transcript grid cell with a 20px inset', () => {
    const selector = '.recording-workspace-grid > .meeting-ask-pluto-dock';
    const rule = rulesFor(selector).find(
      (candidate) => !enclosingMedia(candidate),
    );

    expect(rule).toBeDefined();
    expect(declarationsFor(rule!)).toMatchObject({
      'grid-column': '2',
      'grid-row': '1',
      inset: 'auto',
      width: 'auto',
      margin: '20px',
    });
    expect(applyTokensFor(rule!)).toEqual(
      expect.arrayContaining([
        'relative',
        'self-end',
        'justify-self-stretch',
        'bg-pro-surface',
      ]),
    );
  });

  it('keeps the dock in the only recording column on narrow windows', () => {
    const selector = '.recording-workspace-grid > .meeting-ask-pluto-dock';
    const rule = rulesFor(selector).find((candidate) => {
      const media = enclosingMedia(candidate) as AtRule | undefined;
      return media?.params === '(max-width: 760px)';
    });

    expect(rule).toBeDefined();
    expect(declarationsFor(rule!)).toMatchObject({
      'grid-column': '1',
      'grid-row': '1',
    });
  });

  it('uses the recording workspace quiet-sheet treatment', () => {
    const selector =
      '.recording-workspace-grid > .meeting-ask-pluto-dock .meeting-ask-pluto-dock__composer';
    const [composerRule] = rulesFor(selector);

    expect(composerRule).toBeDefined();
    expect(applyTokensFor(composerRule)).toEqual(
      expect.arrayContaining([
        'border-pro-border',
        'bg-pro-bg',
        'shadow-none',
        'focus-within:border-pro-accent/55',
        'focus-within:ring-2',
        'focus-within:ring-pro-accent/15',
      ]),
    );
    expect(declarationsFor(composerRule)).toMatchObject({
      'box-shadow': 'none',
    });
  });

  it('restores readable Markdown hierarchy only inside Pluto answers', () => {
    const [unorderedRule] = rulesFor(
      '.meeting-ask-pluto-dock__message--assistant ul',
    );
    const [orderedRule] = rulesFor(
      '.meeting-ask-pluto-dock__message--assistant ol',
    );
    const [itemRule] = rulesFor(
      '.meeting-ask-pluto-dock__message--assistant li',
    );
    const [paragraphRule] = rulesFor(
      '.meeting-ask-pluto-dock__message--assistant p',
    );

    expect(declarationsFor(unorderedRule)).toMatchObject({
      'list-style': 'disc',
    });
    expect(declarationsFor(orderedRule)).toMatchObject({
      'list-style': 'decimal',
    });
    expect(applyTokensFor(unorderedRule)).toContain('pl-5');
    expect(applyTokensFor(orderedRule)).toContain('pl-5');
    expect(applyTokensFor(itemRule)).toContain('my-1');
    expect(applyTokensFor(paragraphRule)).toEqual(
      expect.arrayContaining(['my-2', 'first:mt-0', 'last:mb-0']),
    );
  });
});
