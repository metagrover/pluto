import FluidAudio
import Foundation
@testable import ParakeetRuntimeEngine
import XCTest

final class FluidAudioVocabularyLoadingTests: XCTestCase {
    func testPlainSpeechDoesNotLoadVocabularyModelsButHintsStillRequireThem() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let modelPath = environment["PLUTO_NATIVE_TEST_MODEL_DIRECTORY"],
              let audioPath = environment["PLUTO_NATIVE_TEST_SYNTHETIC_AUDIO"]
        else {
            throw XCTSkip("Offline inference check requires installed models and a synthetic speech WAV")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let modelDirectory = URL(fileURLWithPath: modelPath, isDirectory: true)
        try FileManager.default.createSymbolicLink(
            at: directory.appendingPathComponent(FluidAudioModelLayout.installedAsrDirectoryName),
            withDestinationURL: modelDirectory.appendingPathComponent(FluidAudioModelLayout.installedAsrDirectoryName)
        )
        let previousOfflineMode = ModelHub.offlineMode
        ModelHub.offlineMode = true
        defer { ModelHub.offlineMode = previousOfflineMode }

        let driver = FluidAudioInferenceDriver()
        try await driver.loadModel(at: directory)
        let result = try await driver.transcribe(
            audioURL: URL(fileURLWithPath: audioPath),
            language: "en", vocabulary: [], decoderIdentifier: UUID()
        )
        XCTAssertFalse(result.text.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(
            FluidAudioModelLayout.ctcDirectoryName
        ).path))

        let term = result.text.split(separator: " ").prefix(3).joined(separator: " ")
        var vocabularyFailed = false
        do {
            _ = try await driver.transcribe(
                audioURL: URL(fileURLWithPath: audioPath),
                language: "en", vocabulary: [term], decoderIdentifier: UUID()
            )
        } catch {
            vocabularyFailed = true
        }
        XCTAssertTrue(vocabularyFailed, "Missing vocabulary assets must fail when hints are requested")
    }
}
