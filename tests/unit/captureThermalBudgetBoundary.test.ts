import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('capture thermal production boundary', () => {
  const audioManager = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  const styles = readFileSync('src/index.css', 'utf8');

  it('does not mount invisible presentation work inside the headless capture manager', () => {
    expect(audioManager).not.toContain('WaveformVisualizer');
    expect(audioManager).not.toContain('<canvas');
    expect(audioManager).not.toContain('requestAnimationFrame');
    expect(audioManager).not.toContain('setAnalyser(');
    expect(app).not.toContain('onAnalyserReadyRef');
  });

  it('contains scrolling inside the two live-meeting panes', () => {
    expect(styles).toMatch(
      /\.live-transcript-scroll\s*\{[^}]*overscroll-contain/s,
    );
    expect(styles).toMatch(
      /\.recording-rail-content\s*\{[^}]*overscroll-contain/s,
    );
  });

  it('holds queued synthesis behind the authoritative capture lease', () => {
    const startLogic = readFileSync('electron/captureJournalStart.ts', 'utf8');
    expect(startLogic).toContain("knowledgeSynthesisPause.acquire('capture')");
    expect(startLogic).toContain("knowledgeSynthesisPause.release('capture')");
    expect(main).not.toContain('setKnowledgeDocSynthesisPaused(true)');
    expect(main).not.toContain('setKnowledgeDocSynthesisPaused(false)');
  });

  it('uses bounded EOU dispatch without a recording-time validation worker', () => {
    expect(audioManager).toContain('createDurableEouSession');
    expect(audioManager).not.toContain('BackgroundTranscriptValidationQueue');
    expect(audioManager).not.toContain('GET_CAPTURE_COMPUTE_POLICY');
  });
});
