import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('builds a global exclusion tap and preserves targeted inclusion probes without activating CoreAudio', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pluto-tap-selection-'));
  try {
    const harness = join(directory, 'main.swift');
    writeFileSync(
      harness,
      `
import CoreAudio
import Foundation
let global = ProcessTap.makeDescription(processObjectIDs: [41, 42], isGlobal: true)
let empty = ProcessTap.makeDescription(processObjectIDs: [], isGlobal: true)
let target = ProcessTap.makeDescription(processObjectIDs: [99], isGlobal: false)
let aggregate = ProcessTap.makeAggregateDescription(tapUUID: UUID())
var inputFormat = AudioStreamBasicDescription()
inputFormat.mSampleRate = 24000
inputFormat.mChannelsPerFrame = 1
var changedRate = inputFormat
changedRate.mSampleRate = 48000
var changedChannels = inputFormat
changedChannels.mChannelsPerFrame = 2
let result: [String: Any] = [
  "global": global.isExclusive,
  "exclusions": global.processes,
  "allRoutes": global.deviceUID == nil,
  "emptyGlobal": empty.isExclusive && empty.processes.isEmpty,
  "targetExclusive": target.isExclusive,
  "targets": target.processes,
  "waitsForPlayback": aggregate[kAudioAggregateDeviceTapAutoStartKey] as! Bool,
  "hardwareInputsExcluded": aggregate[kAudioAggregateDeviceSubDeviceListKey] == nil,
  "sameFormatAccepted": ProcessTap.sameCaptureFormat(inputFormat, inputFormat),
  "rateChangeRejected": !ProcessTap.sameCaptureFormat(inputFormat, changedRate),
  "channelChangeRejected": !ProcessTap.sameCaptureFormat(inputFormat, changedChannels)
]
print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
`,
    );
    const executable = join(directory, 'test');
    execFileSync('xcrun', [
      'swiftc',
      'resources/swift/audiocap/ProcessTap.swift',
      harness,
      '-o',
      executable,
    ]);
    const result = JSON.parse(execFileSync(executable, { encoding: 'utf8' }));
    expect(result).toEqual({
      global: true,
      exclusions: [41, 42],
      allRoutes: true,
      emptyGlobal: true,
      targetExclusive: false,
      targets: [99],
      waitsForPlayback: false,
      hardwareInputsExcluded: true,
      sameFormatAccepted: true,
      rateChangeRejected: true,
      channelChangeRejected: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
