import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('manual dreaming public API', () => {
  it('requires a concrete entity id and exposes no force option', () => {
    const source = readSource('../../src/api/knowledgeGraph.ts');
    const start = source.indexOf('export const triggerDreamingNow');
    const declaration = source.slice(start, start + 220);
    expect(declaration).toContain('options: {');
    expect(declaration).toContain('entityId: string;');
    expect(declaration).not.toContain('entityId?:');
    expect(declaration).not.toContain('force');
  });

  it('does not render entity-less overview triggers', () => {
    expect(
      readSource('../../src/components/features/projects/ProjectsOverview.tsx'),
    ).not.toContain('✨ Dream Now');
    const peopleSource = readSource(
      '../../src/components/KnowledgeGraph/PeopleTab.tsx',
    );
    expect(peopleSource.match(/triggerDreamingNow\(/g)).toHaveLength(1);
  });
});
