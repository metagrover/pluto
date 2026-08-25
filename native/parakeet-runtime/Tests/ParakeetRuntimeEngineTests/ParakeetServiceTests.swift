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

private actor ServiceLiveManager: ParakeetLiveManaging {
    func append(request _: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        LiveDriverAppendOutcome(updates: [
            LiveDriverUpdate(
                text: "preview", isConfirmed: false, confidence: 0.8,
                processedAudioEndSeconds: 1
            )
        ])
    }

    func finish() async throws -> LiveDriverFinishOutcome {
        LiveDriverFinishOutcome(
            finalText: "final preview",
            degradations: [
                LiveDriverDegradation(
                    reason: .coverageGap,
                    startSeconds: 0,
                    endSeconds: 1
                )
            ]
        )
    }
    func cancel() async {}
}

private struct ServiceLiveDriver: ParakeetLiveDriving {
    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        ServiceLiveManager()
    }
    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor CapturingServiceLiveDriver: ParakeetLiveDriving {
    private(set) var requests: [ParakeetLiveManagerRequest] = []

    func makeManager(request: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        requests.append(request)
        return ServiceLiveManager()
    }

    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor FailingServiceLiveManager: ParakeetLiveManaging {
    func append(request _: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        throw RuntimeFailure.transcriptionFailed
    }

    func finish() async throws -> LiveDriverFinishOutcome {
        LiveDriverFinishOutcome(finalText: "")
    }
    func cancel() async {}
}

private struct FailingServiceLiveDriver: ParakeetLiveDriving {
    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        FailingServiceLiveManager()
    }
    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor ServiceEouManager: ParakeetEouManaging {
    func append(_ frame: EouPcmFrame) async throws -> [ParakeetEouManagerSnapshot] {
        [.partial("EOU preview")]
    }

    func finish() async throws -> [ParakeetEouManagerSnapshot] {
        [.final("EOU final")]
    }

    func cancel() async {}
}

private struct ServiceEouDriver: ParakeetEouDriving {
    func makeManager(request: ParakeetEouManagerRequest) async throws
        -> any ParakeetEouManaging
    {
        ServiceEouManager()
    }
}

private extension RuntimeEvent {
    var eouUpdate: EouUpdate? {
        guard case .eouUpdate(let update) = self else { return nil }
        return update
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

    func testRoutesEouPcmAndEventsThroughPreparedService() async throws {
        let modelRoot = try makeDirectory("service-eou-models")
        let audioRoot = try makeDirectory("service-eou-audio")
        let service = ParakeetService(
            modelRoot: modelRoot,
            audioRoot: audioRoot,
            manifest: .fixture,
            installer: ServiceModelInstaller(),
            inferenceDriver: ServiceInferenceDriver(),
            eouDriver: ServiceEouDriver()
        )
        _ = await service.handle(RuntimeRequest(id: "prepare", method: .prepare))
        let identity = EouRequestMetadata(
            streamId: "mic-eou", source: .mic, generation: 1
        )
        let open = await service.handleLive(RuntimeRequest(
            id: "open", method: .eouOpen, eou: identity
        ))
        let samples = [Float](repeating: 0, count: 2_560)
        let frame = try EouPcmFrame(
            sampleRate: 8_000,
            channelCount: 1,
            frameCount: samples.count,
            audioStartSeconds: 0,
            audioEndSeconds: 0.32,
            pcmData: samples.withUnsafeBytes { Data($0) }
        )
        let append = await service.handleLive(RuntimeRequest(
            id: "append",
            method: .eouAppend,
            eou: EouRequestMetadata(
                streamId: "mic-eou", source: .mic, generation: 1,
                sequence: 1, frame: frame
            )
        ))
        let finish = await service.handleLive(RuntimeRequest(
            id: "finish", method: .eouFinish, eou: identity
        ))

        XCTAssertTrue(open.response.ok)
        XCTAssertEqual(append.events.compactMap(\.eouUpdate).first?.tentativeText, "EOU preview")
        XCTAssertEqual(finish.events.compactMap(\.eouUpdate).last?.committedText, "EOU final")
    }

    func testReportsAndUsesOneSelectedLowLatencyConfiguration() async throws {
        let modelRoot = try makeDirectory("service-config-models")
        let audioRoot = try makeDirectory("service-config-audio")
        let driver = CapturingServiceLiveDriver()
        let service = ParakeetService(
            modelRoot: modelRoot,
            audioRoot: audioRoot,
            manifest: .fixture,
            installer: ServiceModelInstaller(),
            inferenceDriver: ServiceInferenceDriver(),
            liveDriver: driver,
            liveConfigurationID: .lowLatency2s
        )

        let prepared = await service.handle(RuntimeRequest(id: "prepare", method: .prepare))
        _ = await service.handleLive(RuntimeRequest(
            id: "system-open", method: .streamOpen,
            live: LiveRequestMetadata(streamId: "system", source: .system, generation: 1)
        ))
        _ = await service.handleLive(RuntimeRequest(
            id: "mic-open", method: .streamOpen,
            live: LiveRequestMetadata(streamId: "mic", source: .mic, generation: 1)
        ))

        XCTAssertEqual(prepared.result?.liveConfigId, "low-latency-2s")
        let requests = await driver.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertTrue(requests.allSatisfy { $0.configuration == .lowLatencyCandidate })
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

    func testRoutesLiveCommandsWithoutDiscardingEventsOrFlushPreview() async throws {
        let modelRoot = try makeDirectory("service-live-models")
        let audioRoot = try makeDirectory("service-live-audio")
        let audio = audioRoot.appendingPathComponent("chunk.wav")
        try Data("chunk".utf8).write(to: audio)
        let service = ParakeetService(
            modelRoot: modelRoot,
            audioRoot: audioRoot,
            manifest: .fixture,
            installer: ServiceModelInstaller(),
            inferenceDriver: ServiceInferenceDriver(),
            liveDriver: ServiceLiveDriver()
        )
        _ = await service.handle(RuntimeRequest(id: "prepare", method: .prepare))

        let open = await service.handleLive(
            RuntimeRequest(
                id: "open",
                method: .streamOpen,
                live: LiveRequestMetadata(streamId: "s", source: .system, generation: 1)
            ))
        let append = await service.handleLive(
            RuntimeRequest(
                id: "append",
                method: .streamAppend,
                audioPath: audio.path,
                live: LiveRequestMetadata(
                    streamId: "s", source: .system, generation: 1, sequence: 1,
                    chunkStartSeconds: 0, chunkEndSeconds: 1
                )
            ))
        let flush = await service.handleLive(
            RuntimeRequest(
                id: "flush",
                method: .streamFlush,
                live: LiveRequestMetadata(streamId: "s", source: .system, generation: 1)
            ))

        XCTAssertTrue(open.response.ok)
        XCTAssertEqual(append.events.count, 1)
        XCTAssertEqual(flush.finalPreview, "final preview")
        XCTAssertEqual(flush.response.result?.finalPreview, "final preview")
        XCTAssertEqual(flush.response.result?.degradations?.map(\.reason), [.coverageGap])
    }

    func testRoutesInferenceFailureAsFiniteTerminalEvent() async throws {
        let modelRoot = try makeDirectory("service-failed-models")
        let audioRoot = try makeDirectory("service-failed-audio")
        let audio = audioRoot.appendingPathComponent("chunk.wav")
        try Data("chunk".utf8).write(to: audio)
        let service = ParakeetService(
            modelRoot: modelRoot,
            audioRoot: audioRoot,
            manifest: .fixture,
            installer: ServiceModelInstaller(),
            inferenceDriver: ServiceInferenceDriver(),
            liveDriver: FailingServiceLiveDriver()
        )
        _ = await service.handle(RuntimeRequest(id: "prepare", method: .prepare))
        _ = await service.handleLive(
            RuntimeRequest(
                id: "open",
                method: .streamOpen,
                live: LiveRequestMetadata(streamId: "s", source: .system, generation: 1)
            ))

        let failed = await service.handleLive(
            RuntimeRequest(
                id: "append",
                method: .streamAppend,
                audioPath: audio.path,
                live: LiveRequestMetadata(
                    streamId: "s", source: .system, generation: 1, sequence: 1,
                    chunkStartSeconds: 0, chunkEndSeconds: 1
                )
            ))

        XCTAssertEqual(failed.response.error?.code, .transcriptionFailed)
        guard case .streamFailed(let event) = failed.events.first else {
            return XCTFail("expected terminal event")
        }
        XCTAssertEqual(event.reason, .inferenceFailed)
        XCTAssertEqual(event.revision, 1)
    }

    func testServiceEnforcesSourceForLiveOperations() async throws {
        let modelRoot = try makeDirectory("service-capability-models")
        let audioRoot = try makeDirectory("service-capability-audio")
        let audio = audioRoot.appendingPathComponent("chunk.wav")
        try Data("chunk".utf8).write(to: audio)
        let service = ParakeetService(
            modelRoot: modelRoot,
            audioRoot: audioRoot,
            manifest: .fixture,
            installer: ServiceModelInstaller(),
            inferenceDriver: ServiceInferenceDriver(),
            liveDriver: ServiceLiveDriver()
        )
        _ = await service.handle(RuntimeRequest(id: "prepare", method: .prepare))
        _ = await service.handleLive(RuntimeRequest(
            id: "open",
            method: .streamOpen,
            live: LiveRequestMetadata(streamId: "s", source: .mic, generation: 1)
        ))
        let wrongSource = await service.handleLive(RuntimeRequest(
            id: "append",
            method: .streamAppend,
            audioPath: audio.path,
            live: LiveRequestMetadata(
                streamId: "s", source: .system, generation: 1, sequence: 1,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        ))
        XCTAssertEqual(wrongSource.response.error?.code, .invalidRequest)
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
