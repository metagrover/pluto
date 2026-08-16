import Foundation
import FluidAudio
import XCTest

@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

private actor FakeLiveManager: ParakeetLiveManaging {
    let identifier = UUID()
    private let finishText: String
    private var outcomes: [LiveDriverAppendOutcome]
    private(set) var appendedURLs: [URL] = []
    private(set) var cancelCount = 0

    init(
        finishText: String = "tail",
        outcomes: [LiveDriverAppendOutcome] = []
    ) {
        self.finishText = finishText
        self.outcomes = outcomes
    }

    func append(request: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        appendedURLs.append(request.audioURL)
        return outcomes.isEmpty ? LiveDriverAppendOutcome() : outcomes.removeFirst()
    }

    func finish() async throws -> LiveDriverFinishOutcome {
        LiveDriverFinishOutcome(finalText: finishText)
    }

    func cancel() async { cancelCount += 1 }
}

private actor FakeLiveDriver: ParakeetLiveDriving {
    private let finishText: String
    private var outcomes: [LiveDriverAppendOutcome]
    private(set) var requests: [ParakeetLiveManagerRequest] = []
    private(set) var managers: [FakeLiveManager] = []

    init(
        finishText: String = "tail",
        outcomes: [LiveDriverAppendOutcome] = []
    ) {
        self.finishText = finishText
        self.outcomes = outcomes
    }

    func makeManager(request: ParakeetLiveManagerRequest) async throws -> any ParakeetLiveManaging {
        requests.append(request)
        let manager = FakeLiveManager(finishText: finishText, outcomes: outcomes)
        outcomes = []
        managers.append(manager)
        return manager
    }

    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor BlockingLiveManager: ParakeetLiveManaging {
    private var continuations: [CheckedContinuation<Void, Never>] = []
    private(set) var appendedNames: [String] = []
    private(set) var finishCount = 0
    private(set) var cancelCount = 0
    private let lateUpdateOnCancel: Bool

    init(lateUpdateOnCancel: Bool = false) {
        self.lateUpdateOnCancel = lateUpdateOnCancel
    }

    func append(request: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        appendedNames.append(request.audioURL.lastPathComponent)
        await withCheckedContinuation { continuations.append($0) }
        return LiveDriverAppendOutcome(
            updates: lateUpdateOnCancel
                ? [
                    LiveDriverUpdate(
                        text: "late", isConfirmed: false, confidence: 0.8,
                        processedAudioEndSeconds: 1
                    )
                ] : [])
    }

    func finish() async throws -> LiveDriverFinishOutcome {
        finishCount += 1
        return LiveDriverFinishOutcome(finalText: "")
    }
    func cancel() async {
        cancelCount += 1
        let pending = continuations
        continuations.removeAll()
        for continuation in pending { continuation.resume() }
    }

    func releaseNext() {
        guard !continuations.isEmpty else { return }
        continuations.removeFirst().resume()
    }
}

private actor FailingFirstLiveManager: ParakeetLiveManaging {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var appendCount = 0

    func append(request _: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        appendCount += 1
        if appendCount == 1 {
            await withCheckedContinuation { continuation = $0 }
            throw RuntimeFailure.transcriptionFailed
        }
        return LiveDriverAppendOutcome()
    }

    func finish() async throws -> LiveDriverFinishOutcome {
        LiveDriverFinishOutcome(finalText: "")
    }
    func cancel() async {
        continuation?.resume()
        continuation = nil
    }
    func releaseFailure() {
        continuation?.resume()
        continuation = nil
    }
}

private struct FailingFirstLiveDriver: ParakeetLiveDriving {
    let manager: FailingFirstLiveManager
    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    { manager }
    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor BlockingOpenDriver: ParakeetLiveDriving {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var makeCount = 0

    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        makeCount += 1
        await withCheckedContinuation { continuation = $0 }
        return FakeLiveManager()
    }

    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}

private actor BlockingCapabilityDriver: ParakeetLiveDriving {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var capabilityCount = 0
    private(set) var makeCount = 0

    func capabilities() async -> ParakeetLiveDriverCapabilities {
        capabilityCount += 1
        await withCheckedContinuation { continuation = $0 }
        return .required
    }

    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        makeCount += 1
        return FakeLiveManager()
    }

    func releaseCapabilities() {
        continuation?.resume()
        continuation = nil
    }
}

private actor FirstBlockingOpenDriver: ParakeetLiveDriving {
    private var firstContinuation: CheckedContinuation<Void, Never>?
    private(set) var managers: [FakeLiveManager] = []
    private(set) var makeCount = 0

    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }

    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        makeCount += 1
        let ordinal = makeCount
        let manager = FakeLiveManager()
        managers.append(manager)
        if ordinal == 1 {
            await withCheckedContinuation { firstContinuation = $0 }
        }
        return manager
    }

    func releaseFirst() {
        firstContinuation?.resume()
        firstContinuation = nil
    }
}

private actor RecoveringOpenDriver: ParakeetLiveDriving {
    private var count = 0
    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        count += 1
        if count == 1 { throw RuntimeFailure.modelPreparationFailed }
        return FakeLiveManager()
    }
    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor FinalUpdateManager: ParakeetLiveManaging {
    func append(request _: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        LiveDriverAppendOutcome()
    }
    func finish() async throws -> LiveDriverFinishOutcome {
        LiveDriverFinishOutcome(
            finalText: "tail",
            updates: [
                LiveDriverUpdate(
                    text: "final update", isConfirmed: true, confidence: 0.9,
                    processedAudioEndSeconds: 2
                )
            ]
        )
    }
    func cancel() async {}
}

private struct FinalUpdateDriver: ParakeetLiveDriving {
    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    { FinalUpdateManager() }
    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor ModelLoadProbe {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var count = 0

    func load() async -> String {
        count += 1
        await withCheckedContinuation { continuation = $0 }
        return "models"
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

private struct BlockingLiveDriver: ParakeetLiveDriving {
    let manager: BlockingLiveManager

    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        manager
    }

    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

private actor OrderedUpdateManager: ParakeetLiveManaging {
    private var firstContinuation: CheckedContinuation<Void, Never>?
    private var appendCount = 0

    func append(request _: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        appendCount += 1
        let ordinal = appendCount
        if ordinal == 1 {
            await withCheckedContinuation { firstContinuation = $0 }
        }
        return LiveDriverAppendOutcome(updates: [
            LiveDriverUpdate(
                text: "update-\(ordinal)", isConfirmed: false, confidence: 0.8,
                processedAudioEndSeconds: Double(ordinal)
            )
        ])
    }

    func finish() async throws -> LiveDriverFinishOutcome {
        LiveDriverFinishOutcome(finalText: "")
    }
    func cancel() async { firstContinuation?.resume() }
    func releaseFirst() {
        firstContinuation?.resume()
        firstContinuation = nil
    }
    func count() -> Int { appendCount }
}

private struct OrderedUpdateDriver: ParakeetLiveDriving {
    let manager: OrderedUpdateManager

    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        manager
    }

    func capabilities() async -> ParakeetLiveDriverCapabilities { .required }
}

final class ParakeetLiveSessionTests: XCTestCase {
    private var root: URL!
    private var model: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("parakeet-live-\(UUID().uuidString)", isDirectory: true)
        model = root.appendingPathComponent("verified-model", isDirectory: true)
        try FileManager.default.createDirectory(at: model, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testRejectsGapInsteadOfCompressingTimeline() async throws {
        let driver = FakeLiveDriver()
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .system, generation: 1)
        let first = try makeAudio("one.wav", contents: "one")
        let third = try makeAudio("three.wav", contents: "three")

        _ = try await session.append(
            streamId: "s", source: .system, generation: 1, sequence: 1, audioURL: first,
            chunkStartSeconds: 0, chunkEndSeconds: 1
        )

        await assertThrows(
            .sequenceGap,
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 3, audioURL: third,
                chunkStartSeconds: 2, chunkEndSeconds: 3
            )
        )
    }

    func testIdenticalDuplicateIsIdempotentButChangedDuplicateFails() async throws {
        let driver = FakeLiveDriver()
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .mic, generation: 1)
        let audio = try makeAudio("one.wav", contents: "same")

        let original = try await session.append(
            streamId: "s", source: .mic, generation: 1, sequence: 1, audioURL: audio,
            chunkStartSeconds: 0, chunkEndSeconds: 1
        )
        let duplicate = try await session.append(
            streamId: "s", source: .mic, generation: 1, sequence: 1, audioURL: audio,
            chunkStartSeconds: 0, chunkEndSeconds: 1
        )

        XCTAssertFalse(original.wasDuplicate)
        XCTAssertTrue(duplicate.wasDuplicate)
        let managerList = await driver.managers
        let manager = try XCTUnwrap(managerList.first)
        let appendedCount = await manager.appendedURLs.count
        XCTAssertEqual(appendedCount, 1)

        try Data("changed".utf8).write(to: audio)
        await assertThrows(
            .duplicateMismatch,
            try await session.append(
                streamId: "s", source: .mic, generation: 1, sequence: 1, audioURL: audio,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        )
    }

    func testBoundedAdmissionPreservesFIFOAndRejectsThirdOutstandingAppend() async throws {
        let manager = BlockingLiveManager()
        let session = makeSession(driver: BlockingLiveDriver(manager: manager))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let first = try makeAudio("one.wav", contents: "one")
        let second = try makeAudio("two.wav", contents: "two")
        let third = try makeAudio("three.wav", contents: "three")

        let firstTask = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 1, audioURL: first,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }

        await waitForAppendCount(1, manager: manager)
        let secondTask = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 2, audioURL: second,
                chunkStartSeconds: 1, chunkEndSeconds: 2
            )
        }
        await Task.yield()

        await assertThrows(
            .backpressure,
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 3, audioURL: third,
                chunkStartSeconds: 2, chunkEndSeconds: 3
            )
        )
        await manager.releaseNext()
        _ = try await firstTask.value
        await waitForAppendCount(2, manager: manager)
        await manager.releaseNext()
        _ = try await secondTask.value

        let appendedNames = await manager.appendedNames
        XCTAssertEqual(appendedNames, ["one.wav", "two.wav"])
    }

    func testConcurrentAppendResultsKeepSequenceRevisionOrder() async throws {
        let manager = OrderedUpdateManager()
        let session = makeSession(driver: OrderedUpdateDriver(manager: manager))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let first = try makeAudio("one.wav", contents: "one")
        let second = try makeAudio("two.wav", contents: "two")

        let firstTask = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 1, audioURL: first,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }
        for _ in 0..<1_000 {
            if await manager.count() == 1 { break }
            await Task.yield()
        }
        let secondTask = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 2, audioURL: second,
                chunkStartSeconds: 1, chunkEndSeconds: 2
            )
        }
        await manager.releaseFirst()
        let firstResult = try await firstTask.value
        let secondResult = try await secondTask.value

        guard
            case .streamUpdate(let firstUpdate) = firstResult.events.first,
            case .streamUpdate(let secondUpdate) = secondResult.events.first
        else { return XCTFail("expected ordered updates") }
        XCTAssertEqual(firstUpdate.revision, 1)
        XCTAssertEqual(secondUpdate.revision, 2)
    }

    func testRejectsEveryAppendOutsideApprovedRoot() async throws {
        let session = makeSession(driver: FakeLiveDriver())
        try await session.open(streamId: "s", source: .mic, generation: 1)
        let outside = FileManager.default.temporaryDirectory
            .appendingPathComponent("private-\(UUID().uuidString).wav")
        try Data("private".utf8).write(to: outside)
        defer { try? FileManager.default.removeItem(at: outside) }

        await assertThrows(
            .pathNotAllowed,
            try await session.append(
                streamId: "s", source: .mic, generation: 1, sequence: 1, audioURL: outside,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        )
    }

    func testFlushDestroysOneShotManagerAndProcessesTail() async throws {
        let driver = FakeLiveDriver(finishText: "tail")
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .mic, generation: 1)

        let result = try await session.flush(streamId: "s", source: .mic, generation: 1)

        XCTAssertEqual(result.finalPreview, "tail")
        let state = await session.state(streamId: "s")
        XCTAssertNil(state)
    }

    func testResetCancelsOldManagerAndCreatesNewGeneration() async throws {
        let driver = FakeLiveDriver()
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .system, generation: 1)
        let initialManagers = await driver.managers
        let firstManager = try XCTUnwrap(initialManagers.first)

        try await session.reset(streamId: "s", source: .system, generation: 2)

        let cancelCount = await firstManager.cancelCount
        let managerCount = await driver.managers.count
        let resetState = await session.state(streamId: "s")
        XCTAssertEqual(cancelCount, 1)
        XCTAssertEqual(managerCount, 2)
        XCTAssertEqual(resetState?.generation, 2)
        await assertThrows(
            .generationMismatch,
            try await session.cancel(streamId: "s", source: .system, generation: 1)
        )
    }

    func testResetRejectsGenerationJumpsWithoutCancellingCurrentManager() async throws {
        let driver = FakeLiveDriver()
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .system, generation: 1)
        let managers = await driver.managers
        let manager = try XCTUnwrap(managers.first)

        await assertThrows(
            .generationMismatch,
            try await session.reset(streamId: "s", source: .system, generation: 3)
        )

        let cancelCount = await manager.cancelCount
        let state = await session.state(streamId: "s")
        XCTAssertEqual(cancelCount, 0)
        XCTAssertEqual(state?.generation, 1)
    }

    func testResetCancelsQueuedWorkBeforeCreatingNewGeneration() async throws {
        let manager = BlockingLiveManager()
        let session = makeSession(driver: BlockingLiveDriver(manager: manager))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let audio = try makeAudio("one.wav", contents: "one")
        let append = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 1,
                audioURL: audio, chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }
        await waitForAppendCount(1, manager: manager)

        try await session.reset(streamId: "s", source: .system, generation: 2)

        await assertTaskThrows(.cancelled, append)
        let state = await session.state(streamId: "s")
        XCTAssertEqual(state?.generation, 2)
    }

    func testLimitsRegistryToDistinctMicAndSystemManagersSharingVerifiedBundle() async throws {
        let driver = FakeLiveDriver()
        let session = makeSession(driver: driver)
        try await session.open(streamId: "mic", source: .mic, generation: 1)
        try await session.open(streamId: "system", source: .system, generation: 1)

        await assertThrows(
            .streamCapacity,
            try await session.open(streamId: "third", source: .mic, generation: 1)
        )

        let requests = await driver.requests
        let managers = await driver.managers
        XCTAssertEqual(requests.map(\.activeModelURL), [model, model])
        XCTAssertEqual(requests.map(\.vocabularyMode), [.finalOnly, .finalOnly])
        let firstIdentifier = managers[0].identifier
        let secondIdentifier = managers[1].identifier
        XCTAssertNotEqual(firstIdentifier, secondIdentifier)
    }

    func testRejectsSecondActiveStreamForTheSameSource() async throws {
        let session = makeSession(driver: FakeLiveDriver())
        try await session.open(streamId: "mic-one", source: .mic, generation: 1)

        await assertThrows(
            .streamCapacity,
            try await session.open(streamId: "mic-two", source: .mic, generation: 1)
        )
    }

    func testInjectsPinnedDefaultAndLowLatencyCandidateConfigurations() async throws {
        let defaultDriver = FakeLiveDriver()
        let defaultSession = makeSession(driver: defaultDriver, configuration: .pinnedDefault)
        try await defaultSession.open(streamId: "default", source: .mic, generation: 1)

        let lowLatencyDriver = FakeLiveDriver()
        let lowLatencySession = makeSession(
            driver: lowLatencyDriver,
            configuration: .lowLatencyCandidate
        )
        try await lowLatencySession.open(streamId: "fast", source: .system, generation: 1)

        let defaultRequests = await defaultDriver.requests
        let lowLatencyRequests = await lowLatencyDriver.requests
        let pinned = try XCTUnwrap(defaultRequests.first?.configuration)
        let fast = try XCTUnwrap(lowLatencyRequests.first?.configuration)
        XCTAssertEqual(pinned.chunkSeconds, 11)
        XCTAssertEqual(pinned.rightContextSeconds, 2)
        XCTAssertEqual(fast.chunkSeconds, 2)
        XCTAssertEqual(fast.leftContextSeconds, 2)
        XCTAssertEqual(fast.rightContextSeconds, 2)
        XCTAssertEqual(fast.confirmationThreshold, 0.80)
    }

    func testAdaptsDriverUpdateAndPartialFailureToFiniteRuntimeEvents() async throws {
        let outcome = LiveDriverAppendOutcome(
            updates: [
                LiveDriverUpdate(
                    text: "synthetic", isConfirmed: true, confidence: 0.9,
                    processedAudioEndSeconds: 1
                )
            ],
            degradations: [
                LiveDriverDegradation(
                    reason: .partialWindow,
                    startSeconds: 0.25,
                    endSeconds: 0.375
                )
            ]
        )
        let session = makeSession(driver: FakeLiveDriver(outcomes: [outcome]))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let audio = try makeAudio("one.wav", contents: "one")

        let result = try await session.append(
            streamId: "s", source: .system, generation: 1, sequence: 1, audioURL: audio,
            chunkStartSeconds: 0, chunkEndSeconds: 1
        )

        XCTAssertEqual(result.events.count, 2)
        guard case .streamUpdate(let update) = result.events[0] else {
            return XCTFail("expected update")
        }
        XCTAssertEqual(update.revision, 1)
        XCTAssertTrue(update.qualifiesPriorTentative)
        XCTAssertEqual(update.text, "synthetic")
        guard case .streamDegraded(let degraded) = result.events[1] else {
            return XCTFail("expected degradation")
        }
        XCTAssertEqual(degraded.reason, .partialWindow)
        XCTAssertEqual(degraded.affectedSequence, 1)
        XCTAssertEqual(degraded.chunkStartSeconds, 0.25)
        XCTAssertEqual(degraded.chunkEndSeconds, 0.375)
    }

    func testCarriesExactCommittedAndTentativeAppendSequences() async throws {
        let first = LiveDriverAppendOutcome(updates: [
            LiveDriverUpdate(
                text: "first", isConfirmed: false, confidence: 0.8,
                processedAudioEndSeconds: 1
            )
        ])
        let second = LiveDriverAppendOutcome(updates: [
            LiveDriverUpdate(
                text: "second", isConfirmed: true, confidence: 0.8,
                processedAudioEndSeconds: 2
            )
        ])
        let session = makeSession(driver: FakeLiveDriver(outcomes: [first, second]))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let one = try makeAudio("one.wav", contents: "one")
        let two = try makeAudio("two.wav", contents: "two")

        let firstResult = try await session.append(
            streamId: "s", source: .system, generation: 1, sequence: 1, audioURL: one,
            chunkStartSeconds: 0, chunkEndSeconds: 1
        )
        let secondResult = try await session.append(
            streamId: "s", source: .system, generation: 1, sequence: 2, audioURL: two,
            chunkStartSeconds: 1, chunkEndSeconds: 2
        )

        guard
            case .streamUpdate(let firstUpdate) = firstResult.events.first,
            case .streamUpdate(let secondUpdate) = secondResult.events.first
        else { return XCTFail("expected sequence-bound updates") }
        XCTAssertEqual(firstUpdate.committedThroughSequence, 0)
        XCTAssertEqual(firstUpdate.tentativeThroughSequence, 1)
        XCTAssertEqual(secondUpdate.committedThroughSequence, 1)
        XCTAssertEqual(secondUpdate.tentativeThroughSequence, 2)
    }

    func testCancelRemovesManagerAndPreventsLateAppendResults() async throws {
        let driver = FakeLiveDriver()
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .mic, generation: 1)

        try await session.cancel(streamId: "s", source: .mic, generation: 1)

        let state = await session.state(streamId: "s")
        XCTAssertNil(state)
        let audio = try makeAudio("late.wav", contents: "late")
        await assertThrows(
            .streamNotFound,
            try await session.append(
                streamId: "s", source: .mic, generation: 1, sequence: 1, audioURL: audio,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        )
    }

    func testRejectsMismatchedSourceForEveryExistingStreamOperation() async throws {
        let session = makeSession(driver: FakeLiveDriver())
        try await session.open(streamId: "s", source: .mic, generation: 1)
        let audio = try makeAudio("one.wav", contents: "one")

        await assertThrows(
            .sourceMismatch,
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 1,
                audioURL: audio, chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        )
        await assertThrows(
            .sourceMismatch,
            try await session.flush(streamId: "s", source: .system, generation: 1)
        )
        await assertThrows(
            .sourceMismatch,
            try await session.cancel(streamId: "s", source: .system, generation: 1)
        )
        await assertThrows(
            .sourceMismatch,
            try await session.reset(streamId: "s", source: .system, generation: 2)
        )
    }

    func testConcurrentOpenReservesSourceAndCapacityAcrossDriverAwait() async throws {
        let driver = BlockingOpenDriver()
        let session = makeSession(driver: driver)
        let first = Task {
            try await session.open(streamId: "one", source: .mic, generation: 1)
        }
        for _ in 0..<1_000 {
            if await driver.makeCount == 1 { break }
            await Task.yield()
        }

        await assertThrows(
            .streamCapacity,
            try await session.open(streamId: "two", source: .mic, generation: 1)
        )
        await driver.release()
        try await first.value
        let makeCount = await driver.makeCount
        XCTAssertEqual(makeCount, 1)
    }

    func testShutdownFencesOpeningBeforeBlockedCapabilitiesReturn() async throws {
        let driver = BlockingCapabilityDriver()
        let session = makeSession(driver: driver)
        let opening = Task {
            try await session.open(streamId: "s", source: .mic, generation: 1)
        }
        await waitForCapabilityCount(1, driver: driver)

        let openingState = await session.state(streamId: "s")
        XCTAssertEqual(openingState?.lifecycle, .opening)
        await session.shutdown()
        await driver.releaseCapabilities()

        await assertVoidTaskThrows(.cancelled, opening)
        let state = await session.state(streamId: "s")
        let makeCount = await driver.makeCount
        XCTAssertNil(state)
        XCTAssertEqual(makeCount, 0)
    }

    func testCancelFencesOpeningAndCancelsManagerConstructedAfterward() async throws {
        let driver = FirstBlockingOpenDriver()
        let session = makeSession(driver: driver)
        let opening = Task {
            try await session.open(streamId: "s", source: .mic, generation: 1)
        }
        await waitForMakeCount(1, driver: driver)

        try await session.cancel(streamId: "s", source: .mic, generation: 1)
        await driver.releaseFirst()

        await assertVoidTaskThrows(.cancelled, opening)
        let managers = await driver.managers
        let first = try XCTUnwrap(managers.first)
        let cancelCount = await first.cancelCount
        let state = await session.state(streamId: "s")
        XCTAssertEqual(cancelCount, 1)
        XCTAssertNil(state)
    }

    func testResetReplacesOpeningGenerationAndRejectsLateManager() async throws {
        let driver = FirstBlockingOpenDriver()
        let session = makeSession(driver: driver)
        let firstOpening = Task {
            try await session.open(streamId: "s", source: .system, generation: 1)
        }
        await waitForMakeCount(1, driver: driver)

        try await session.reset(streamId: "s", source: .system, generation: 2)
        let resetState = await session.state(streamId: "s")
        XCTAssertEqual(resetState?.generation, 2)
        XCTAssertEqual(resetState?.lifecycle, .open)
        await driver.releaseFirst()

        await assertVoidTaskThrows(.cancelled, firstOpening)
        let managers = await driver.managers
        XCTAssertEqual(managers.count, 2)
        let oldCancelCount = await managers[0].cancelCount
        let newCancelCount = await managers[1].cancelCount
        XCTAssertEqual(oldCancelCount, 1)
        XCTAssertEqual(newCancelCount, 0)
        let finalState = await session.state(streamId: "s")
        XCTAssertEqual(finalState?.generation, 2)
    }

    func testCancelledOpenTaskCannotInstallManagerAfterBlockedConstruction() async throws {
        let driver = FirstBlockingOpenDriver()
        let session = makeSession(driver: driver)
        let opening = Task {
            try await session.open(streamId: "s", source: .mic, generation: 1)
        }
        await waitForMakeCount(1, driver: driver)

        opening.cancel()
        await driver.releaseFirst()

        await assertVoidTaskThrows(.cancelled, opening)
        let managers = await driver.managers
        let manager = try XCTUnwrap(managers.first)
        let cancelCount = await manager.cancelCount
        let state = await session.state(streamId: "s")
        XCTAssertEqual(cancelCount, 1)
        XCTAssertNil(state)
    }

    func testFailedOpenRollsBackSourceAndCapacityReservation() async throws {
        let session = makeSession(driver: RecoveringOpenDriver())
        await assertThrows(
            .modelUnavailable,
            try await session.open(streamId: "failed", source: .mic, generation: 1)
        )
        try await session.open(streamId: "recovered", source: .mic, generation: 1)
        let state = await session.state(streamId: "recovered")
        XCTAssertEqual(state?.source, .mic)
    }

    func testFlushWaitsForAcceptedAppendBeforeFinishingAndKeepsTailUpdates() async throws {
        let manager = BlockingLiveManager()
        let session = makeSession(driver: BlockingLiveDriver(manager: manager))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let audio = try makeAudio("one.wav", contents: "one")
        let append = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 1,
                audioURL: audio, chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }
        await waitForAppendCount(1, manager: manager)
        let flush = Task {
            try await session.flush(streamId: "s", source: .system, generation: 1)
        }
        await Task.yield()
        let finishCountBeforeRelease = await manager.finishCount
        XCTAssertEqual(finishCountBeforeRelease, 0)
        await manager.releaseNext()
        _ = try await append.value
        _ = try await flush.value
        let finishCountAfterFlush = await manager.finishCount
        XCTAssertEqual(finishCountAfterFlush, 1)

        let finalSession = makeSession(driver: FinalUpdateDriver())
        try await finalSession.open(streamId: "final", source: .mic, generation: 1)
        let result = try await finalSession.flush(
            streamId: "final", source: .mic, generation: 1
        )
        XCTAssertEqual(result.finalPreview, "tail")
        guard case .streamUpdate(let finalUpdate) = result.events.first else {
            return XCTFail("expected drained final update")
        }
        XCTAssertEqual(finalUpdate.audioEndSeconds, 2)
    }

    func testCancelCancelsActiveAndQueuedAppendsWithoutLateEvents() async throws {
        let manager = BlockingLiveManager(lateUpdateOnCancel: true)
        let session = makeSession(driver: BlockingLiveDriver(manager: manager))
        try await session.open(streamId: "s", source: .mic, generation: 1)
        let firstAudio = try makeAudio("one.wav", contents: "one")
        let secondAudio = try makeAudio("two.wav", contents: "two")
        let first = Task {
            try await session.append(
                streamId: "s", source: .mic, generation: 1, sequence: 1,
                audioURL: firstAudio, chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }
        await waitForAppendCount(1, manager: manager)
        let second = Task {
            try await session.append(
                streamId: "s", source: .mic, generation: 1, sequence: 2,
                audioURL: secondAudio, chunkStartSeconds: 1, chunkEndSeconds: 2
            )
        }
        await waitForNextSequence(3, streamId: "s", session: session)

        try await session.cancel(streamId: "s", source: .mic, generation: 1)
        await assertTaskThrows(.cancelled, first)
        await assertTaskThrows(.cancelled, second)
        let appendedNames = await manager.appendedNames
        let cancelCount = await manager.cancelCount
        let state = await session.state(streamId: "s")
        XCTAssertEqual(appendedNames, ["one.wav"])
        XCTAssertEqual(cancelCount, 1)
        XCTAssertNil(state)
    }

    func testPredecessorFailureCancelsQueuedAppendAndEmitsOneTerminalEvent() async throws {
        let manager = FailingFirstLiveManager()
        let session = makeSession(driver: FailingFirstLiveDriver(manager: manager))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let firstAudio = try makeAudio("one.wav", contents: "one")
        let secondAudio = try makeAudio("two.wav", contents: "two")
        let first = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 1,
                audioURL: firstAudio, chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }
        for _ in 0..<1_000 {
            if await manager.appendCount == 1 { break }
            await Task.yield()
        }
        let second = Task {
            try await session.append(
                streamId: "s", source: .system, generation: 1, sequence: 2,
                audioURL: secondAudio, chunkStartSeconds: 1, chunkEndSeconds: 2
            )
        }
        await manager.releaseFailure()

        do {
            _ = try await first.value
            XCTFail("expected terminal failure")
        } catch let terminal as LiveRuntimeTerminalFailure {
            guard case .streamFailed = terminal.event else {
                return XCTFail("expected one terminal event")
            }
        }
        await assertTaskThrows(.inferenceFailed, second)
        let appendCount = await manager.appendCount
        XCTAssertEqual(appendCount, 1)
    }

    func testUnknownProcessedWatermarkEmitsCoverageDegradationInsteadOfFalseUpdate() async throws {
        let outcome = LiveDriverAppendOutcome(updates: [
            LiveDriverUpdate(
                text: "unknown boundary", isConfirmed: false, confidence: 0.8,
                processedAudioEndSeconds: nil
            )
        ])
        let session = makeSession(driver: FakeLiveDriver(outcomes: [outcome]))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let audio = try makeAudio("one.wav", contents: "one")

        let result = try await session.append(
            streamId: "s", source: .system, generation: 1, sequence: 1,
            audioURL: audio, chunkStartSeconds: 0, chunkEndSeconds: 1
        )

        XCTAssertEqual(result.events.count, 1)
        guard case .streamDegraded(let event) = result.events[0] else {
            return XCTFail("expected coverage degradation")
        }
        XCTAssertEqual(event.reason, .coverageGap)
    }

    func testProductionDriverAdvertisesOnlyTheVendoredAcknowledgedContract() async {
        AppLogger.setProcessLogging(.enabled)

        let driver = FluidAudioLiveDriver()
        let capabilities = await driver.capabilities()

        XCTAssertEqual(capabilities, .required)
        XCTAssertEqual(AppLogger.processLoggingMode, .disabled)
    }

    func testVerifiedModelLoaderIsSingleFlightForConcurrentManagerCreation() async throws {
        let loader = SingleFlightModelLoader<String>()
        let probe = ModelLoadProbe()
        let modelURL = model!
        async let first = loader.load(at: modelURL) { await probe.load() }
        async let second = loader.load(at: modelURL) { await probe.load() }
        for _ in 0..<1_000 {
            if await probe.count == 1 { break }
            await Task.yield()
        }
        let countWhileLoading = await probe.count
        XCTAssertEqual(countWhileLoading, 1)
        await probe.release()
        let values = try await [first, second]
        XCTAssertEqual(values, ["models", "models"])
        let finalCount = await probe.count
        XCTAssertEqual(finalCount, 1)
    }

    func testShutdownCancelsInFlightAppendAndLeavesNoLateEvent() async throws {
        let manager = BlockingLiveManager(lateUpdateOnCancel: true)
        let session = makeSession(driver: BlockingLiveDriver(manager: manager))
        try await session.open(streamId: "s", source: .mic, generation: 1)
        let audio = try makeAudio("one.wav", contents: "one")
        let append = Task {
            try await session.append(
                streamId: "s", source: .mic, generation: 1, sequence: 1,
                audioURL: audio, chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }
        await waitForAppendCount(1, manager: manager)

        await session.shutdown()

        await assertTaskThrows(.cancelled, append)
        let state = await session.state(streamId: "s")
        let cancelCount = await manager.cancelCount
        XCTAssertNil(state)
        XCTAssertEqual(cancelCount, 1)
    }

    private func makeSession(
        driver: any ParakeetLiveDriving,
        configuration: ParakeetLiveConfiguration = .pinnedDefault
    ) -> ParakeetLiveSession {
        ParakeetLiveSession(
            driver: driver,
            activeModelURL: model,
            audioRoot: root,
            configuration: configuration
        )
    }

    private func makeAudio(_ name: String, contents: String) throws -> URL {
        let url = root.appendingPathComponent(name)
        try Data(contents.utf8).write(to: url)
        return url
    }

    private func assertThrows<T>(
        _ expected: LiveRuntimeFailure,
        _ expression: @autoclosure () async throws -> T
    ) async {
        do {
            _ = try await expression()
            XCTFail("expected \(expected)")
        } catch {
            XCTAssertEqual(error as? LiveRuntimeFailure, expected)
        }
    }

    private func assertTaskThrows(
        _ expected: LiveRuntimeFailure,
        _ task: Task<LiveAppendResult, Error>
    ) async {
        do {
            _ = try await task.value
            XCTFail("expected \(expected)")
        } catch {
            XCTAssertEqual(error as? LiveRuntimeFailure, expected)
        }
    }

    private func assertVoidTaskThrows(
        _ expected: LiveRuntimeFailure,
        _ task: Task<Void, Error>
    ) async {
        do {
            try await task.value
            XCTFail("expected \(expected)")
        } catch {
            XCTAssertEqual(error as? LiveRuntimeFailure, expected)
        }
    }

    private func waitForAppendCount(_ expected: Int, manager: BlockingLiveManager) async {
        for _ in 0..<1_000 {
            if await manager.appendedNames.count == expected { return }
            await Task.yield()
        }
        XCTFail("append did not start")
    }

    private func waitForNextSequence(
        _ expected: Int, streamId: String, session: ParakeetLiveSession
    ) async {
        for _ in 0..<1_000 {
            if await session.state(streamId: streamId)?.nextSequence == expected { return }
            await Task.yield()
        }
        XCTFail("append was not admitted")
    }

    private func waitForCapabilityCount(
        _ expected: Int, driver: BlockingCapabilityDriver
    ) async {
        for _ in 0..<1_000 {
            if await driver.capabilityCount == expected { return }
            await Task.yield()
        }
        XCTFail("capability check did not start")
    }

    private func waitForMakeCount(_ expected: Int, driver: FirstBlockingOpenDriver) async {
        for _ in 0..<1_000 {
            if await driver.makeCount == expected { return }
            await Task.yield()
        }
        XCTFail("manager construction did not start")
    }
}
