import CoreAudio

/// AudioBuffer metadata describes interleaved channels within each buffer,
/// including mono buffers from Bluetooth routes and planar channel layouts.
func downmixAudioBuffers(_ buffers: [AudioBuffer], expectedChannels: UInt32) -> [Float]? {
    guard !buffers.isEmpty, expectedChannels > 0 else { return nil }
    var frameCount: Int?
    var channels = 0
    for buffer in buffers {
        let count = Int(buffer.mNumberChannels)
        guard count > 0, buffer.mData != nil,
              Int(buffer.mDataByteSize) % (MemoryLayout<Float>.size * count) == 0 else { return nil }
        let frames = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size / count
        guard frames > 0, frameCount == nil || frameCount == frames else { return nil }
        frameCount = frames
        channels += count
    }
    guard channels == Int(expectedChannels), let frameCount else { return nil }
    var mono = [Float](repeating: 0, count: frameCount)
    for buffer in buffers {
        let count = Int(buffer.mNumberChannels)
        let samples = buffer.mData!.assumingMemoryBound(to: Float.self)
        for frame in 0..<frameCount {
            for channel in 0..<count {
                mono[frame] += samples[frame * count + channel] / Float(channels)
            }
        }
    }
    return mono
}
