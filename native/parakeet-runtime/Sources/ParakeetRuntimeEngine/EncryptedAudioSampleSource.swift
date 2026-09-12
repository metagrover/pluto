import FluidAudio
import ParakeetRuntimeCore

struct EncryptedAudioSampleSource: AudioSampleSource, Sendable {
    private let reader: any EncryptedAudioReading

    init(reader: any EncryptedAudioReading) {
        self.reader = reader
    }

    var sampleCount: Int { reader.sampleCount }

    func copySamples(
        into destination: UnsafeMutablePointer<Float>,
        offset: Int,
        count: Int
    ) throws {
        try reader.copySamples(into: destination, offset: offset, count: count)
    }
}
