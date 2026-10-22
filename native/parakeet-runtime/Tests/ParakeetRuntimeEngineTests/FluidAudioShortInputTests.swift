import AVFoundation
import FluidAudio
import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

final class FluidAudioShortInputTests: XCTestCase {
    private struct Reader: EncryptedAudioReading {
        let samples: [Float]
        let sampleRate = 16_000.0
        var sampleCount: Int { samples.count }
        func copySamples(into destination: UnsafeMutablePointer<Float>, offset: Int, count: Int) throws {
            for index in 0..<count { destination[index] = samples[offset + index] }
        }
    }

    func testShortPcmAndEncryptedInputsPreserveRealSamplesAndPadOnlyToExistingMinimum() throws {
        let samples = (0..<960).map { Float($0) / 960 }
        for input in [AudioInput.pcmSamples(samples, sampleRate: 16_000), .encryptedReader(Reader(samples: samples))] {
            let prepared = try FluidAudioInferenceDriver.prepareMinimumAudioInput(input)
            guard case .pcmSamples(let actual, let rate) = prepared.input else { return XCTFail("expected bounded PCM") }
            let minimum = ASRConstants.minimumRequiredSamples(forSampleRate: ASRConstants.sampleRate)
            XCTAssertEqual(actual.count, minimum)
            XCTAssertEqual(Array(actual.prefix(samples.count)), samples)
            XCTAssertTrue(actual.dropFirst(samples.count).allSatisfy { $0 == 0 })
            XCTAssertEqual(rate, 16_000)
            XCTAssertEqual(prepared.originalDuration!, 0.06, accuracy: 0.000001)
        }
    }

    func testFileUsesSameMinimumAndKeepsOriginalDuration() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 960)!
        buffer.frameLength = 960
        for index in 0..<960 { buffer.floatChannelData![0][index] = Float(index) / 960 }
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
        }
        let prepared = try FluidAudioInferenceDriver.prepareMinimumAudioInput(.fileURL(url))
        guard case .pcmSamples(let samples, _) = prepared.input else { return XCTFail("expected bounded PCM") }
        XCTAssertEqual(samples.count, ASRConstants.minimumRequiredSamples(forSampleRate: 16_000))
        XCTAssertEqual(prepared.originalDuration!, 0.06, accuracy: 0.000001)
        XCTAssertEqual(samples[500], Float(500) / 960, accuracy: 0.0001)
    }

    func testAtMinimumIsUnpaddedAndEmptyRemainsInvalid() throws {
        let minimum = ASRConstants.minimumRequiredSamples(forSampleRate: 16_000)
        let samples = [Float](repeating: 0.25, count: minimum)
        let prepared = try FluidAudioInferenceDriver.prepareMinimumAudioInput(.pcmSamples(samples, sampleRate: 16_000))
        XCTAssertNil(prepared.originalDuration)
        if case .pcmSamples(let actual, _) = prepared.input { XCTAssertEqual(actual, samples) } else { XCTFail("expected PCM") }
        XCTAssertThrowsError(try FluidAudioInferenceDriver.prepareMinimumAudioInput(.pcmSamples([], sampleRate: 16_000)))
        XCTAssertThrowsError(try FluidAudioInferenceDriver.prepareMinimumAudioInput(.encryptedReader(Reader(samples: []))))
        let encrypted = try FluidAudioInferenceDriver.prepareMinimumAudioInput(.encryptedReader(Reader(samples: samples)))
        guard case .encryptedReader = encrypted.input else { return XCTFail("long reader must remain disk-backed") }
        XCTAssertNil(encrypted.originalDuration)
    }

    func testPaddedOnlyWordsCannotRemainInTextOrExtendOriginalDuration() throws {
        let bounded = try FluidAudioInferenceDriver.boundPaddedOutput(text: "Yes phantom", words: [
            TranscriptionWord(text: "Yes", startSeconds: 0.01, endSeconds: 0.1),
            TranscriptionWord(text: "phantom", startSeconds: 0.2, endSeconds: 0.3),
        ], originalDuration: 0.06)
        XCTAssertEqual(bounded.text, "Yes")
        XCTAssertEqual(bounded.words, [TranscriptionWord(text: "Yes", startSeconds: 0.01, endSeconds: 0.06)])
        XCTAssertThrowsError(try FluidAudioInferenceDriver.boundPaddedOutput(text: "Unsupported", words: [], originalDuration: 0.06))
        XCTAssertThrowsError(try FluidAudioInferenceDriver.boundPaddedOutput(text: "Invalid", words: [TranscriptionWord(text: "Invalid", startSeconds: -.infinity, endSeconds: 0.05)], originalDuration: 0.06))
    }
    func testZeroDurationWordsDoNotCreatePaddedResultText() throws {
        let bounded = try FluidAudioInferenceDriver.boundPaddedOutput(text: "zero Yes collapsed", words: [
            TranscriptionWord(text: "zero", startSeconds: 0, endSeconds: 0),
            TranscriptionWord(text: "Yes", startSeconds: 0.01, endSeconds: 0.04),
            // The existing monotonic normalizer collapses this overlapping span.
            TranscriptionWord(text: "collapsed", startSeconds: 0.02, endSeconds: 0.03),
        ], originalDuration: 0.06)
        XCTAssertEqual(bounded.text, "Yes")
        XCTAssertEqual(bounded.words.count, 1)
        XCTAssertTrue(bounded.words.allSatisfy { $0.endSeconds > $0.startSeconds })
    }

    func testLongFileStaysFileBackedAndResampledPcmMatchesExistingConverter() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
        let count = ASRConstants.minimumRequiredSamples(forSampleRate: 16_000) + 160
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
        buffer.frameLength = AVAudioFrameCount(count)
        buffer.floatChannelData![0].initialize(repeating: 0.1, count: count)
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings)
            try file.write(from: buffer)
        }
        let preparedFile = try FluidAudioInferenceDriver.prepareMinimumAudioInput(.fileURL(url))
        guard case .fileURL(let sameUrl) = preparedFile.input else { return XCTFail("long file must remain file-backed") }
        XCTAssertEqual(sameUrl, url)
        XCTAssertNil(preparedFile.originalDuration)

        let original = (0..<1_920).map { Float($0) / 1_920 }
        let expected = try AudioConverter().resample(original, from: 32_000)
        let prepared = try FluidAudioInferenceDriver.prepareMinimumAudioInput(.pcmSamples(original, sampleRate: 32_000))
        guard case .pcmSamples(let actual, let rate) = prepared.input else { return XCTFail("expected normalized PCM") }
        XCTAssertEqual(Array(actual.prefix(expected.count)), expected)
        XCTAssertEqual(rate, 16_000)
        XCTAssertEqual(prepared.originalDuration!, Double(expected.count) / 16_000, accuracy: 0.000001)
    }

}
