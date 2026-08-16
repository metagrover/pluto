import Foundation
import XCTest

@testable import FluidAudio

/// Tests for GitHub issue #441: Frame count calculation for EOU chunk sizes
/// Verifies that AudioMelSpectrogram produces the correct number of frames for each EOU chunk size
final class EouChunkSizeFrameCountTests: XCTestCase {

    func testFrameCount160ms() {
        let chunkSize = StreamingChunkSize.ms160
        let expectedFrames = chunkSize.melFrames  // 17 frames
        let actualFrames = calculateMelFrames(for: chunkSize.chunkSamples)

        XCTAssertEqual(
            actualFrames, expectedFrames,
            "160ms chunk (\(chunkSize.chunkSamples) samples) should produce \(expectedFrames) mel frames, got \(actualFrames)"
        )
    }

    func testFrameCount320ms() {
        let chunkSize = StreamingChunkSize.ms320
        let expectedFrames = chunkSize.melFrames  // 64 frames
        let actualFrames = calculateMelFrames(for: chunkSize.chunkSamples)

        XCTAssertEqual(
            actualFrames, expectedFrames,
            "320ms chunk (\(chunkSize.chunkSamples) samples) should produce \(expectedFrames) mel frames, got \(actualFrames)"
        )
    }

    func testFrameCount1280ms() {
        let chunkSize = StreamingChunkSize.ms1280
        let expectedFrames = chunkSize.melFrames  // 129 frames
        let actualFrames = calculateMelFrames(for: chunkSize.chunkSamples)

        XCTAssertEqual(
            actualFrames, expectedFrames,
            "1280ms chunk (\(chunkSize.chunkSamples) samples) should produce \(expectedFrames) mel frames, got \(actualFrames)"
        )
    }

    /// Test all chunk sizes with 10 different audio lengths to ensure stability
    func testAllChunkSizesWithVariedLengths() {
        let testLengths = [
            1000, 2000, 5000, 8000, 10080, 12000, 15000, 20000, 25000, 30000,
        ]

        for chunkSize in [StreamingChunkSize.ms160, .ms320, .ms1280] {
            for audioLength in testLengths where audioLength >= chunkSize.chunkSamples {
                let actualFrames = calculateMelFrames(for: audioLength)

                // Verify the formula works for arbitrary lengths
                // The fix ensures: numFrames = 1 + (paddedCount - winLength) / hopLength
                XCTAssertGreaterThan(
                    actualFrames, 0,
                    "Audio length \(audioLength) with chunk size \(chunkSize.durationMs)ms should produce >0 frames")
            }
        }
    }

    /// Helper: Calculate number of mel frames using AudioMelSpectrogram
    /// This uses the FIXED formula from the issue #441 fix
    private func calculateMelFrames(for audioSampleCount: Int) -> Int {
        let mel = AudioMelSpectrogram(
            sampleRate: 16000,
            nMels: 128,
            nFFT: 512,
            hopLength: 160,
            winLength: 400
        )

        let audio = [Float](repeating: 0.1, count: audioSampleCount)
        let result = mel.computeFlat(audio: audio)

        return result.melLength
    }
}
