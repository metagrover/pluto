import { describe, expect, it } from 'vitest';
import { compareVersions } from '../../electron/updateChecker';

describe('compareVersions', () => {
  it('identifies newer versions correctly', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.1', '0.1.0')).toBe(1);
    expect(compareVersions('v0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('v1.0.0', 'v0.9.5')).toBe(1);
  });

  it('identifies older versions correctly', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
  });

  it('identifies equal versions', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('v1.2.3', 'v1.2.3')).toBe(0);
  });
});
