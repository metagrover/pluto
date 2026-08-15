import Foundation
import XCTest
@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

private struct ServiceModelInstaller: ModelInstalling {
    func install(manifest _: ModelManifest, into stagingDirectory: URL) async throws {
        let model = stagingDirectory.appendingPathComponent("model", isDirectory: true)
        try FileManager.default.createDirectory(at: model, withIntermediateDirectories: true)
        try Data("ready".utf8).write(to: model.appendingPathComponent("marker"))
    }
}

private actor ServiceInferenceDriver: ParakeetInferenceDriving {
    private(set) var vocabulary: [String] = []

    func loadModel(at _: URL) async throws {}

    func transcribe(
        audioURL _: URL,
        language _: String?,
        vocabulary: [String],
        decoderIdentifier _: UUID
    ) async throws -> TranscriptionOutput {
        self.vocabulary = vocabulary
        return TranscriptionOutput(
            text: "hello",
            confidence: 0.9,
            durationSeconds: 1,
            words: [TranscriptionWord(text: "hello", startSeconds: 0, endSeconds: 1)],
            noSpeech: false
        )
    }
}

final class ParakeetServiceTests: XCTestCase {
    private func makeDirectory(_ name: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(name)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory
    }

    func testPrepareThenTranscribeUsesBoundedDeduplicatedVocabulary() async throws {
        let modelRoot = try makeDirectory("service-models")
        let audioRoot = try makeDirectory("service-audio")
        let audio = audioRoot.appendingPathComponent("meeting.wav")
        XCTAssertTrue(FileManager.default.createFile(atPath: audio.path, contents: Data()))
        let driver = ServiceInferenceDriver()
        let service = ParakeetService(
            modelRoot: modelRoot,
            audioRoot: audioRoot,
            manifest: .fixture,
            installer: ServiceModelInstaller(),
            inferenceDriver: driver
        )

        let prepared = await service.handle(RuntimeRequest(
            id: "prepare",
            method: .prepare,
            modelRoot: modelRoot.path
        ))
        let transcribed = await service.handle(RuntimeRequest(
            id: "transcribe",
            method: .transcribe,
            audioPath: audio.path,
            language: "en",
            vocabulary: ["Pluto", "pluto", "", "AB", "FluidAudio"]
        ))

        XCTAssertTrue(prepared.ok)
        XCTAssertEqual(prepared.result?.modelVersion, ModelManifest.fixture.version)
        XCTAssertTrue(transcribed.ok)
        XCTAssertEqual(transcribed.result?.vocabularyCount, 2)
        let vocabulary = await driver.vocabulary
        XCTAssertEqual(vocabulary, ["Pluto", "FluidAudio"])
    }

    func testRejectsAudioOutsideApprovedRootWithoutLeakingPath() async throws {
        let modelRoot = try makeDirectory("service-models")
        let audioRoot = try makeDirectory("service-audio")
        let outside = try makeDirectory("private-audio").appendingPathComponent("secret.wav")
        XCTAssertTrue(FileManager.default.createFile(atPath: outside.path, contents: Data()))
        let service = ParakeetService(
            modelRoot: modelRoot,
            audioRoot: audioRoot,
            manifest: .fixture,
            installer: ServiceModelInstaller(),
            inferenceDriver: ServiceInferenceDriver()
        )
        _ = await service.handle(RuntimeRequest(id: "prepare", method: .prepare))

        let response = await service.handle(RuntimeRequest(
            id: "transcribe",
            method: .transcribe,
            audioPath: outside.path
        ))
        let encoded = try XCTUnwrap(String(data: JSONEncoder().encode(response), encoding: .utf8))

        XCTAssertEqual(response.error?.code, .pathNotAllowed)
        XCTAssertFalse(encoded.contains("secret.wav"))
        XCTAssertFalse(encoded.contains(outside.deletingLastPathComponent().path))
    }
}

private extension ModelManifest {
    static let fixture = ModelManifest(
        identifier: "parakeet-test",
        version: "test-v1",
        repository: "example/asr",
        encoderPrecision: "int8"
    )
}
