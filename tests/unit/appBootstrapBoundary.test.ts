import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

describe('Electron bootstrap boundary', () => {
  it('locks the packaged profile before importing database-owning main code', () => {
    const source = fs.readFileSync(
      path.join(root, 'electron/bootstrap.ts'),
      'utf8',
    );

    expect(source).not.toContain("from './db'");
    expect(source).toContain("app.setPath('userData'");
    expect(source).toContain('developmentTargetsProduction');
    expect(source).toContain('hasValidRecoveryKeyFile');
    expect(source).toContain('database_key_identity_mismatch');
    expect(source.indexOf('requestSingleInstanceLock')).toBeGreaterThan(-1);
    expect(source.indexOf('initializeApplicationDatabase({')).toBeGreaterThan(
      source.indexOf('requestSingleInstanceLock'),
    );
    expect(source.indexOf("import('./main')")).toBeGreaterThan(
      source.indexOf('initializeApplicationDatabase({'),
    );
    expect(source).toContain('describeDatabaseStartupError');
  });

  it('builds Electron from the bootstrap and always isolates development data', () => {
    const source = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ) as { main?: string };

    expect(source).toContain("bootstrap: 'electron/bootstrap.ts'");
    expect(source).toContain('resolveDevelopmentUserDataDir');
    expect(source).toContain('`--user-data-dir=${userDataDir}`');
    expect(packageJson.main).toBe('dist-electron/bootstrap.js');
  });

  it('closes the database after main-process consumers stop', () => {
    const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    expect(source).toContain('createBeforeQuitHandler({');
    expect(source).toContain('shutdownConsumers: shutdownMainProcessConsumers');
    expect(source).toContain('closeDatabase: closeApplicationDatabase');
  });

  it('keeps legacy voice analysis out of interactive IPC work', () => {
    const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

    expect(source).toContain('speakerVoiceDependencies(false)');
    expect(source).toContain('voiceWorkQueue?.enqueue(meetingId)');
    expect(source).toContain('speakerVoiceDependencies(true, signal)');
  });

  it('does not abort active runs or regenerate notes after speaker confirmation', () => {
    const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const bindingHandler = source.slice(
      source.indexOf('onBindingChange: ({ meetingId, personIds })'),
      source.indexOf(
        'invalidateDreamingCatalog();',
        source.indexOf('onBindingChange: ({ meetingId, personIds })'),
      ),
    );
    expect(bindingHandler).not.toContain('supersedeMeetingNotes');
    expect(bindingHandler).not.toContain('identity-notes');
    expect(bindingHandler).toContain('refreshMeetingIdentityProjection');
    expect(bindingHandler).not.toContain('generateAndPublishMeetingNotes');
  });
});
