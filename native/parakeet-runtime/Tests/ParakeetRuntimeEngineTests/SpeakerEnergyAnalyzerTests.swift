import AVFoundation
import XCTest
@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

final class SpeakerEnergyAnalyzerTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testProducesAlignedRmsWindowsForUnequalFiles() async throws {
        let mic = try writeWav(name: "mic.wav", samples: Array(repeating: 0.5, count: 3_200))
        let system = try writeWav(name: "system.wav", samples: Array(repeating: 0.25, count: 1_600))

        let windows = try await SpeakerEnergyAnalyzer(windowSeconds: 0.1).analyze(
            micURL: mic,
            systemURL: system
        )

        XCTAssertEqual(windows.count, 2)
        guard windows.count == 2 else { return }
        XCTAssertEqual(windows[0].startTime, 0, accuracy: 0.0001)
        XCTAssertEqual(windows[0].endTime, 0.1, accuracy: 0.0001)
        XCTAssertEqual(windows[0].micRms, 0.5, accuracy: 0.001)
        XCTAssertEqual(windows[0].systemRms, 0.25, accuracy: 0.001)
        XCTAssertEqual(windows[1].startTime, 0.1, accuracy: 0.0001)
        XCTAssertEqual(windows[1].endTime, 0.2, accuracy: 0.0001)
        XCTAssertEqual(windows[1].micRms, 0.5, accuracy: 0.001)
        XCTAssertEqual(windows[1].systemRms, 0, accuracy: 0.0001)
    }

    func testSilenceIsFiniteNonnegativeAndMonotonic() async throws {
        let mic = try writeWav(name: "mic.wav", samples: Array(repeating: 0, count: 4_000))
        let system = try writeWav(name: "system.wav", samples: Array(repeating: 0, count: 4_000))

        let windows = try await SpeakerEnergyAnalyzer(windowSeconds: 0.1).analyze(
            micURL: mic,
            systemURL: system
        )

        XCTAssertEqual(windows.count, 3)
        guard windows.count == 3 else { return }
        for (index, window) in windows.enumerated() {
            XCTAssertTrue(window.micRms.isFinite)
            XCTAssertTrue(window.systemRms.isFinite)
            XCTAssertGreaterThanOrEqual(window.micRms, 0)
            XCTAssertGreaterThanOrEqual(window.systemRms, 0)
            XCTAssertEqual(window.startTime, Double(index) * 0.1, accuracy: 0.0001)
            XCTAssertGreaterThan(window.endTime, window.startTime)
        }
        XCTAssertEqual(windows.last?.endTime ?? 0, 0.25, accuracy: 0.0001)
    }

    func testProducesAlignedRmsWindowsForUnequalSamplesInMemory() async throws {
        let mic = Array(repeating: Float(0.5), count: 3_200)
        let system = Array(repeating: Float(0.25), count: 1_600)

        let windows = try await SpeakerEnergyAnalyzer(windowSeconds: 0.1).analyze(
            micSamples: mic,
            micRate: 16000,
            systemSamples: system,
            systemRate: 16000
        )

        XCTAssertEqual(windows.count, 2)
        guard windows.count == 2 else { return }
        XCTAssertEqual(windows[0].startTime, 0, accuracy: 0.0001)
        XCTAssertEqual(windows[0].endTime, 0.1, accuracy: 0.0001)
        XCTAssertEqual(windows[0].micRms, 0.5, accuracy: 0.001)
        XCTAssertEqual(windows[0].systemRms, 0.25, accuracy: 0.001)
        XCTAssertEqual(windows[1].startTime, 0.1, accuracy: 0.0001)
        XCTAssertEqual(windows[1].endTime, 0.2, accuracy: 0.0001)
        XCTAssertEqual(windows[1].micRms, 0.5, accuracy: 0.001)
        XCTAssertEqual(windows[1].systemRms, 0, accuracy: 0.0001)
    }

    func testCancellationStopsBeforeReadingFiles() async throws {
        let mic = try writeWav(name: "mic.wav", samples: Array(repeating: 0.5, count: 1_600))
        let system = try writeWav(name: "system.wav", samples: Array(repeating: 0.5, count: 1_600))
        let task = Task {
            try await SpeakerEnergyAnalyzer(windowSeconds: 0.1).analyze(
                micURL: mic,
                systemURL: system
            )
        }
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            // Expected.
        }
    }

    private func writeWav(name: String, samples: [Float]) throws -> URL {
        let url = directory.appendingPathComponent(name)
        let format = try XCTUnwrap(
            AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)
        )
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        let buffer = try XCTUnwrap(
            AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
        )
        buffer.frameLength = AVAudioFrameCount(samples.count)
        let channel = try XCTUnwrap(buffer.floatChannelData?[0])
        for (index, sample) in samples.enumerated() { channel[index] = sample }
        try file.write(from: buffer)
        return url
    }
}
