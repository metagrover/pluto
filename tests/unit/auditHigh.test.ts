import { describe, expect, it } from 'vitest';

import {
  collectPackageVersionsFromPnpmList,
  findAdvisoriesAtOrAboveSeverity,
} from '../../scripts/audit-high.mjs';

describe('collectPackageVersionsFromPnpmList', () => {
  it('dedupes package versions from the pnpm dependency tree', () => {
    const payload = collectPackageVersionsFromPnpmList([
      {
        name: 'pluto',
        version: '0.1.0',
        private: true,
        dependencies: {
          react: {
            version: '18.3.1',
            dependencies: {
              'loose-envify': {
                version: '1.4.0',
              },
            },
          },
          'react-dom': {
            version: '18.3.1',
            dependencies: {
              react: {
                version: '18.3.1',
                deduped: true,
              },
            },
          },
        },
      },
    ]);

    expect(payload).toEqual({
      react: ['18.3.1'],
      'react-dom': ['18.3.1'],
      'loose-envify': ['1.4.0'],
    });
  });
});

describe('findAdvisoriesAtOrAboveSeverity', () => {
  it('keeps only advisories that meet the configured severity threshold', () => {
    const advisories = findAdvisoriesAtOrAboveSeverity(
      {
        react: [
          {
            id: 100,
            severity: 'moderate',
            title: 'Moderate issue',
            vulnerable_versions: '<18.3.2',
          },
        ],
        undici: [
          {
            id: 200,
            severity: 'high',
            title: 'High issue',
            vulnerable_versions: '<6.27.1',
          },
        ],
      },
      'high',
    );

    expect(advisories).toEqual([
      {
        packageName: 'undici',
        advisory: {
          id: 200,
          severity: 'high',
          title: 'High issue',
          vulnerable_versions: '<6.27.1',
        },
      },
    ]);
  });
});
