import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('preserves mono frame counts and downmixes actual buffer layouts while rejecting stale channel metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pluto-pcm-layout-'));
  try {
    const harness = join(directory, 'main.swift');
    writeFileSync(
      harness,
      `
import CoreAudio
import Foundation
var samples: [Float] = [1, 3, 2, 4]
let result = samples.withUnsafeMutableBytes { bytes -> [String: Any] in
    let mono = AudioBuffer(mNumberChannels: 1, mDataByteSize: UInt32(bytes.count), mData: bytes.baseAddress)
    let stereo = AudioBuffer(mNumberChannels: 2, mDataByteSize: UInt32(bytes.count), mData: bytes.baseAddress)
    let left = AudioBuffer(mNumberChannels: 1, mDataByteSize: 8, mData: bytes.baseAddress)
    let right = AudioBuffer(mNumberChannels: 1, mDataByteSize: 8, mData: bytes.baseAddress!.advanced(by: 8))
    return [
        "mono": downmixAudioBuffers([mono], expectedChannels: 1)!,
        "stereo": downmixAudioBuffers([stereo], expectedChannels: 2)!,
        "planar": downmixAudioBuffers([left, right], expectedChannels: 2)!,
        "staleRejected": downmixAudioBuffers([mono], expectedChannels: 2) == nil,
        "unequalFramesRejected": downmixAudioBuffers([mono, right], expectedChannels: 2) == nil
    ]
}
print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
`,
    );
    const executable = join(directory, 'test');
    execFileSync('xcrun', [
      'swiftc',
      'resources/swift/audiocap/AudioPcm.swift',
      harness,
      '-o',
      executable,
    ]);
    expect(JSON.parse(execFileSync(executable, { encoding: 'utf8' }))).toEqual({
      mono: [1, 3, 2, 4],
      stereo: [2, 3],
      planar: [1.5, 3.5],
      staleRejected: true,
      unequalFramesRejected: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
