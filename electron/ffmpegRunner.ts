import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { resolveUnpackedExecutablePath } from './packagedExecutablePath';

export const runFfmpeg = async (
  args: readonly string[],
  signal?: AbortSignal,
): Promise<void> => {
  const ffmpegPath = ffmpegStatic;
  if (!ffmpegPath) throw new Error('ffmpeg_binary_unavailable');
  if (signal?.aborted) throw new Error('ffmpeg_aborted');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      resolveUnpackedExecutablePath(ffmpegPath),
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { stdio: 'ignore' },
    );
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new Error('ffmpeg_aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => finish(error));
    child.on('close', (code, closeSignal) => {
      if (code === 0) return finish();
      finish(new Error(`ffmpeg_failed:${code ?? closeSignal ?? 'unknown'}`));
    });
  });
};
