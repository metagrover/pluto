import AVFoundation
import Foundation
import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

private enum FakeFluidEouCallback {
    case partial(String)
    case eou(String)
}

private actor FakeFluidEouBackend: FluidAudioEouBackend {
    private var partial: (@Sendable (String) -> Void)?
    private var eou: (@Sendable (String) -> Void)?
    private var callbackBatches: [[FakeFluidEouCallback]]
    private var rawTokenBatches: [[String]]
    private var currentRawTokens: [String] = []
    private(set) var tokenReadCount = 0
    private(set) var observedFormat: (Double, AVAudioChannelCount, AVAudioFrameCount)?
    private(set) var cleanedUp = false

    init(
        partialTranscripts: [String] = ["hello"],
        emitsEou: Bool = true
    ) {
        callbackBatches = partialTranscripts.map { transcript in
            emitsEou ? [.partial(transcript), .eou(transcript)] : [.partial(transcript)]
        }
        rawTokenBatches = partialTranscripts.map { transcript in
            transcript.split(separator: " ").map { "▁\($0)" }
        }
    }

    init(
        callbackBatches: [[FakeFluidEouCallback]],
        rawTokenBatches: [[String]]
    ) {
        self.callbackBatches = callbackBatches
        self.rawTokenBatches = rawTokenBatches
    }

    func setPartialCallback(_ callback: @escaping @Sendable (String) -> Void) {
        partial = callback
    }

    func setEouCallback(_ callback: @escaping @Sendable (String) -> Void) {
        eou = callback
    }

    func process(audioBuffer: sending AVAudioPCMBuffer) async throws -> String {
        observedFormat = (
            audioBuffer.format.sampleRate,
            audioBuffer.format.channelCount,
            audioBuffer.frameLength
        )
        if !rawTokenBatches.isEmpty {
            currentRawTokens = rawTokenBatches.removeFirst()
        }
        let callbacks = callbackBatches.isEmpty ? [] : callbackBatches.removeFirst()
        for callback in callbacks {
            switch callback {
            case .partial(let transcript): partial?(transcript)
            case .eou(let transcript): eou?(transcript)
            }
        }
        return ""
    }

    func finish() async throws -> String { "hello final" }
    func getTokenTimestampsMs() async -> [Int] {
        tokenReadCount += 1
        return currentRawTokens.indices.map { 100 + $0 * 100 }
    }
    func getRawTokenStrings() async -> [String] {
        tokenReadCount += 1
        return currentRawTokens
    }
    func getEouTimestampsMs() async -> [Int] { [320] }
    func cleanup() async { cleanedUp = true }
}

final class FluidAudioEouAdapterTests: XCTestCase {
    func testSilentFramesDoNotRebuildTheEntireMeetingTokenList() async throws {
        let backend = FakeFluidEouBackend(
            callbackBatches: Array(repeating: [], count: 80),
            rawTokenBatches: Array(repeating: ["▁earlier"], count: 80)
        )
        let manager = await FluidAudioEouManager(backend: backend)
        for index in 0..<80 {
            let snapshots = try await manager.append(frame(start: Double(index) * 0.32))
            XCTAssertTrue(snapshots.isEmpty)
        }
        let tokenReadCount = await backend.tokenReadCount
        XCTAssertEqual(tokenReadCount, 0)
    }

    func testAppendPreservesDeclaredPcmFormatAndReturnsOrderedCallbacks() async throws {
        let backend = FakeFluidEouBackend()
        let manager = await FluidAudioEouManager(backend: backend)
        let samples = [Float](repeating: 0.25, count: 15_360)
        let frame = try EouPcmFrame(
            sampleRate: 48_000,
            channelCount: 1,
            frameCount: samples.count,
            audioStartSeconds: 0,
            audioEndSeconds: 0.32,
            pcmData: samples.withUnsafeBytes { Data($0) }
        )

        let snapshots = try await manager.append(frame)

        XCTAssertEqual(snapshots.map(\.kind), [.partial])
        XCTAssertEqual(snapshots.last?.tokens.first?.text, "▁hello")
        let observed = await backend.observedFormat
        XCTAssertEqual(observed?.0, 48_000)
        XCTAssertEqual(observed?.1, 1)
        XCTAssertEqual(observed?.2, 15_360)
    }

    func testFinishCommitsTailAndCleansModels() async throws {
        let backend = FakeFluidEouBackend()
        let manager = await FluidAudioEouManager(backend: backend)

        let snapshots = try await manager.finish()

        XCTAssertEqual(snapshots.last?.kind, .final)
        XCTAssertEqual(snapshots.last?.transcript, "hello final")
        let cleanedUp = await backend.cleanedUp
        XCTAssertTrue(cleanedUp)
    }

    func testBoundsAProvisionalRunAtTheLastCompletedWord() async throws {
        let backend = FakeFluidEouBackend(
            partialTranscripts: ["one", "one two", "one two three", "one two three four"],
            emitsEou: false
        )
        let manager = await FluidAudioEouManager(
            backend: backend,
            maxPendingSeconds: 0.5
        )
        let samples = [Float](repeating: 0.25, count: 15_360)
        func frame(start: Double) throws -> EouPcmFrame {
            try EouPcmFrame(
                sampleRate: 48_000,
                channelCount: 1,
                frameCount: samples.count,
                audioStartSeconds: start,
                audioEndSeconds: start + 0.32,
                pcmData: samples.withUnsafeBytes { Data($0) }
            )
        }

        let first = try await manager.append(frame(start: 0))
        let second = try await manager.append(frame(start: 0.32))
        let bounded = try await manager.append(frame(start: 0.64))
        let next = try await manager.append(frame(start: 0.96))

        XCTAssertEqual(first.map(\.kind), [.partial])
        XCTAssertEqual(second.map(\.kind), [.partial])
        XCTAssertEqual(bounded.map(\.kind), [.eou, .partial])
        XCTAssertEqual(bounded.first?.transcript, "one two")
        XCTAssertEqual(bounded.first?.tokens.map(\.text), ["▁one", "▁two"])
        XCTAssertEqual(bounded.last?.transcript, "one two three")
        XCTAssertEqual(next.map(\.kind), [.partial])
        XCTAssertEqual(next.last?.transcript, "one two three four")
    }

    func testDefaultCheckpointsContinuousSpeechWithinFiveSecondsWithoutCommittingLastWord() async throws {
        let backend = FakeFluidEouBackend(
            callbackBatches: [[.partial("meeting now")]],
            rawTokenBatches: [["▁meet", "ing", "▁now"]]
        )
        let manager = await FluidAudioEouManager(backend: backend)
        _ = try await manager.append(frame(start: 0))
        var output: [ParakeetEouManagerSnapshot] = []
        for index in 1...16 {
            output += try await manager.append(frame(start: Double(index) * 0.32))
        }
        XCTAssertEqual(output.filter { $0.kind == .eou }.last?.transcript, "meeting")
        XCTAssertEqual(output.last?.transcript, "meeting now")
        let cleanedUp = await backend.cleanedUp
        XCTAssertFalse(cleanedUp)
    }

    func testBoundsPendingSpeechWhileLaterFramesHaveNoCallbacks() async throws {
        let backend = FakeFluidEouBackend(
            callbackBatches: [[.partial("one two")], [], []],
            rawTokenBatches: [["▁one", "▁two"]]
        )
        let manager = await FluidAudioEouManager(backend: backend, maxPendingSeconds: 0.5)

        _ = try await manager.append(frame(start: 0))
        _ = try await manager.append(frame(start: 0.32))
        let bounded = try await manager.append(frame(start: 0.64))

        XCTAssertEqual(bounded.map(\.kind), [.eou, .partial])
        XCTAssertEqual(bounded.first?.transcript, "one")
        XCTAssertEqual(bounded.last?.transcript, "one two")
    }

    func testTrailingPartialAfterEouStartsANewPendingRun() async throws {
        let backend = FakeFluidEouBackend(
            callbackBatches: [
                [.eou("hello"), .partial("hello again")],
                [],
                [.partial("hello again now")],
            ],
            rawTokenBatches: [
                ["▁hello", "▁again"],
                ["▁hello", "▁again"],
                ["▁hello", "▁again", "▁now"],
            ]
        )
        let manager = await FluidAudioEouManager(backend: backend, maxPendingSeconds: 0.5)

        let initial = try await manager.append(frame(start: 0))
        _ = try await manager.append(frame(start: 0.32))
        let bounded = try await manager.append(frame(start: 0.64))

        XCTAssertEqual(initial.map(\.kind), [.eou, .partial])
        XCTAssertEqual(initial.first?.tokens.map(\.text), ["▁hello"])
        XCTAssertEqual(bounded.map(\.kind), [.eou, .partial])
        XCTAssertEqual(bounded.first?.transcript, "hello again")
        XCTAssertEqual(bounded.last?.transcript, "hello again now")
    }

    func testWordSafeCheckpointSurvivesSubwordContinuationThroughSession() async throws {
        let backend = FakeFluidEouBackend(
            callbackBatches: [
                [.partial("meet")],
                [.partial("meeting")],
                [.partial("meeting now")],
                [.partial("meeting now works")],
            ],
            rawTokenBatches: [
                ["▁meet"],
                ["▁meet", "ing"],
                ["▁meet", "ing", "▁now"],
                ["▁meet", "ing", "▁now", "▁works"],
            ]
        )
        let manager = await FluidAudioEouManager(backend: backend, maxPendingSeconds: 0.5)
        let session = ParakeetEouSession(
            driver: SingleEouManagerDriver(manager: manager),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)

        _ = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
            frame: frame(start: 0)
        )
        _ = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 2,
            frame: frame(start: 0.32)
        )
        let checkpoint = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 3,
            frame: frame(start: 0.64)
        )
        let continued = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 4,
            frame: frame(start: 0.96)
        )

        XCTAssertEqual(checkpoint.compactMap(\.eouUpdate).last?.committedText, "meeting")
        XCTAssertEqual(checkpoint.compactMap(\.eouUpdate).last?.tentativeText, "now")
        XCTAssertEqual(continued.compactMap(\.eouUpdate).last?.committedText, "meeting")
        XCTAssertEqual(continued.compactMap(\.eouUpdate).last?.tentativeText, "now works")
    }

    func testNativeEouKeepsLastWordTentativeUntilNextWordBoundary() async throws {
        let backend = FakeFluidEouBackend(
            callbackBatches: [
                [.eou("meet")],
                [.partial("meets")],
                [.partial("meets today")],
            ],
            rawTokenBatches: [
                ["▁meet"],
                ["▁meet", "s"],
                ["▁meet", "s", "▁today"],
            ]
        )
        let manager = await FluidAudioEouManager(backend: backend)
        let session = ParakeetEouSession(
            driver: SingleEouManagerDriver(manager: manager),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)

        let eou = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
            frame: frame(start: 0)
        )
        let continuation = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 2,
            frame: frame(start: 0.32)
        )
        let boundary = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 3,
            frame: frame(start: 0.64)
        )

        XCTAssertEqual(eou.compactMap(\.eouUpdate).last?.committedText, "")
        XCTAssertEqual(eou.compactMap(\.eouUpdate).last?.tentativeText, "meet")
        XCTAssertEqual(continuation.compactMap(\.eouUpdate).last?.committedText, "")
        XCTAssertEqual(continuation.compactMap(\.eouUpdate).last?.tentativeText, "meets")
        XCTAssertEqual(boundary.compactMap(\.eouUpdate).last?.committedText, "meets")
        XCTAssertEqual(boundary.compactMap(\.eouUpdate).last?.tentativeText, "today")
    }

    func testNativeEouTailSurvivesSilenceAndLaterSubwordContinuation() async throws {
        let backend = FakeFluidEouBackend(
            callbackBatches: [
                [.eou("meet")],
                [],
                [],
                [.partial("meeting")],
                [.partial("meeting now")],
            ],
            rawTokenBatches: [
                ["▁meet"],
                ["▁meet"],
                ["▁meet"],
                ["▁meet", "ing"],
                ["▁meet", "ing", "▁now"],
            ]
        )
        let manager = await FluidAudioEouManager(backend: backend, maxPendingSeconds: 0.5)
        let session = ParakeetEouSession(
            driver: SingleEouManagerDriver(manager: manager),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)

        let initial = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
            frame: frame(start: 0)
        )
        _ = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 2,
            frame: frame(start: 0.32)
        )
        let afterSilence = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 3,
            frame: frame(start: 0.64)
        )
        let continuation = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 4,
            frame: frame(start: 0.96)
        )
        let boundary = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 5,
            frame: frame(start: 1.28)
        )

        XCTAssertEqual(initial.compactMap(\.eouUpdate).last?.committedText, "")
        XCTAssertEqual(initial.compactMap(\.eouUpdate).last?.tentativeText, "meet")
        XCTAssertTrue(afterSilence.isEmpty)
        XCTAssertEqual(continuation.compactMap(\.eouUpdate).last?.committedText, "")
        XCTAssertEqual(continuation.compactMap(\.eouUpdate).last?.tentativeText, "meeting")
        XCTAssertEqual(boundary.compactMap(\.eouUpdate).last?.committedText, "meeting")
        XCTAssertEqual(boundary.compactMap(\.eouUpdate).last?.tentativeText, "now")
    }

    private func frame(start: Double) throws -> EouPcmFrame {
        let samples = [Float](repeating: 0.25, count: 15_360)
        return try EouPcmFrame(
            sampleRate: 48_000,
            channelCount: 1,
            frameCount: samples.count,
            audioStartSeconds: start,
            audioEndSeconds: start + 0.32,
            pcmData: samples.withUnsafeBytes { Data($0) }
        )
    }
}

private actor SingleEouManagerDriver: ParakeetEouDriving {
    private var manager: (any ParakeetEouManaging)?

    init(manager: any ParakeetEouManaging) {
        self.manager = manager
    }

    func makeManager(request: ParakeetEouManagerRequest) async throws
        -> any ParakeetEouManaging
    {
        guard let manager else { throw EouSessionFailure.modelUnavailable }
        self.manager = nil
        return manager
    }
}

private extension RuntimeEvent {
    var eouUpdate: EouUpdate? {
        guard case .eouUpdate(let update) = self else { return nil }
        return update
    }
}
