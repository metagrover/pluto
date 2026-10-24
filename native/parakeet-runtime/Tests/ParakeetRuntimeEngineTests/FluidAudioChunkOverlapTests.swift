import Foundation
@testable import FluidAudio
import XCTest

final class FluidAudioChunkOverlapTests: XCTestCase {
    func testSilenceAlignmentPreservesTheConfiguredAcousticOverlap() throws {
        let frame = ASRConstants.samplesPerEncoderFrame
        var samples = [Float](repeating: 0.02, count: 90 * ASRConstants.sampleRate)
        let layout = ChunkProcessor(audioSamples: samples).chunkLayoutForTesting(
            melChunkContext: false, modelVersion: .v3
        )
        let earlyQuiet = layout.strideSamples - 4 * ASRConstants.sampleRate
        let lateQuiet = earlyQuiet + layout.chunkSamples - frame
        for center in [earlyQuiet, lateQuiet] {
            for index in (center - frame)..<(center + frame) {
                samples[index] = 0
            }
        }
        let starts = try ChunkProcessor(audioSamples: samples).chunkStartsForTesting(
            melChunkContext: false, modelVersion: .v3
        )
        XCTAssertGreaterThanOrEqual(starts.count, 3)
        for (previous, next) in zip(starts, starts.dropFirst()) {
            XCTAssertLessThanOrEqual(
                next - previous, layout.strideSamples,
                "Adaptive placement must retain the overlap required by the token merger"
            )
        }
    }
}
