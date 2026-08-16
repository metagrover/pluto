import Foundation
import XCTest
@testable import ParakeetRuntimeCore

private actor FakeInferenceDriver: ParakeetInferenceDriving {
    private(set) var loadCount = 0
    private(set) var decoderIdentifiers: [UUID] = []
    private(set) var maximumConcurrentCalls = 0
    private var concurrentCalls = 0

    func loadModel(at _: URL) async throws { loadCount += 1 }

    func transcribe(
        audioURL _: URL,
        language _: String?,
        vocabulary _: [String],
        decoderIdentifier: UUID
    ) async throws -> TranscriptionOutput {
        concurrentCalls += 1
        maximumConcurrentCalls = max(maximumConcurrentCalls, concurrentCalls)
        decoderIdentifiers.append(decoderIdentifier)
        try await Task.sleep(for: .milliseconds(20))
        concurrentCalls -= 1
        return TranscriptionOutput(
            text: "",
            confidence: 1,
            durationSeconds: 0,
            words: [],
            noSpeech: true
        )
    }
}

final class TranscriberTests: XCTestCase {
    private func makeFile() throws -> URL {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("parakeet-audio-\(UUID().uuidString).wav")
        XCTAssertTrue(FileManager.default.createFile(atPath: file.path, contents: Data()))
        addTeardownBlock { try? FileManager.default.removeItem(at: file) }
        return file
    }

    func testLoadsModelOnceAndCreatesFreshDecoderStatePerRequest() async throws {
        let driver = FakeInferenceDriver()
        let transcriber = ParakeetTranscriber(driver: driver)
        let model = URL(fileURLWithPath: "/approved/model", isDirectory: true)
        let audio = try makeFile()

        _ = try await transcriber.transcribe(modelURL: model, audioURL: audio, language: "en")
        _ = try await transcriber.transcribe(modelURL: model, audioURL: audio, language: "en")

        let loadCount = await driver.loadCount
        XCTAssertEqual(loadCount, 1)
        let decoderIdentifiers = await driver.decoderIdentifiers
        XCTAssertEqual(decoderIdentifiers.count, 2)
        XCTAssertNotEqual(decoderIdentifiers[0], decoderIdentifiers[1])
    }

    func testActorSerializesConcurrentRequests() async throws {
        let driver = FakeInferenceDriver()
        let transcriber = ParakeetTranscriber(driver: driver)
        let model = URL(fileURLWithPath: "/approved/model", isDirectory: true)
        let firstAudio = try makeFile()
        let secondAudio = try makeFile()

        async let first = transcriber.transcribe(modelURL: model, audioURL: firstAudio, language: "en")
        async let second = transcriber.transcribe(modelURL: model, audioURL: secondAudio, language: "en")
        _ = try await (first, second)

        let maximumConcurrentCalls = await driver.maximumConcurrentCalls
        XCTAssertEqual(maximumConcurrentCalls, 1)
    }

    func testDriverFailureMapsToContentFreeStableError() async throws {
        let transcriber = ParakeetTranscriber(driver: FailingInferenceDriver())

        do {
            _ = try await transcriber.transcribe(
                modelURL: URL(fileURLWithPath: "/private/model"),
                audioURL: URL(fileURLWithPath: "/private/meeting.wav"),
                language: "en"
            )
            XCTFail("Expected transcription failure")
        } catch {
            XCTAssertEqual(error as? RuntimeFailure, .transcriptionFailed)
            XCTAssertEqual(String(describing: error), "parakeet_transcription_failed")
        }
    }
}

private struct FailingInferenceDriver: ParakeetInferenceDriving {
    struct PrivateFailure: Error, CustomStringConvertible {
        var description: String { "/private/meeting.wav failed" }
    }

    func loadModel(at _: URL) async throws { throw PrivateFailure() }

    func transcribe(
        audioURL _: URL,
        language _: String?,
        vocabulary _: [String],
        decoderIdentifier _: UUID
    ) async throws -> TranscriptionOutput {
        throw PrivateFailure()
    }
}
