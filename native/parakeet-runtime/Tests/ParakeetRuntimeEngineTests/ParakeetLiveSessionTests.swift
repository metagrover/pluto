import Foundation
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

    func append(audioURL: URL) async throws -> LiveDriverAppendOutcome {
        appendedURLs.append(audioURL)
        return outcomes.isEmpty ? LiveDriverAppendOutcome() : outcomes.removeFirst()
    }

    func finish() async throws -> String { finishText }

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
}

private actor BlockingLiveManager: ParakeetLiveManaging {
    private var continuations: [CheckedContinuation<Void, Never>] = []
    private(set) var appendedNames: [String] = []

    func append(audioURL: URL) async throws -> LiveDriverAppendOutcome {
        appendedNames.append(audioURL.lastPathComponent)
        await withCheckedContinuation { continuations.append($0) }
        return LiveDriverAppendOutcome()
    }

    func finish() async throws -> String { "" }
    func cancel() async {
        let pending = continuations
        continuations.removeAll()
        for continuation in pending { continuation.resume() }
    }

    func releaseNext() {
        guard !continuations.isEmpty else { return }
        continuations.removeFirst().resume()
    }
}

private struct BlockingLiveDriver: ParakeetLiveDriving {
    let manager: BlockingLiveManager

    func makeManager(request _: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        manager
    }
}

private actor OrderedUpdateManager: ParakeetLiveManaging {
    private var firstContinuation: CheckedContinuation<Void, Never>?
    private var appendCount = 0

    func append(audioURL _: URL) async throws -> LiveDriverAppendOutcome {
        appendCount += 1
        let ordinal = appendCount
        if ordinal == 1 {
            await withCheckedContinuation { firstContinuation = $0 }
        }
        return LiveDriverAppendOutcome(updates: [
            LiveDriverUpdate(text: "update-\(ordinal)", isConfirmed: false, confidence: 0.8)
        ])
    }

    func finish() async throws -> String { "" }
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
            streamId: "s", generation: 1, sequence: 1, audioURL: first,
            chunkStartSeconds: 0, chunkEndSeconds: 1
        )

        await assertThrows(
            .sequenceGap,
            try await session.append(
                streamId: "s", generation: 1, sequence: 3, audioURL: third,
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
            streamId: "s", generation: 1, sequence: 1, audioURL: audio,
            chunkStartSeconds: 0, chunkEndSeconds: 1
        )
        let duplicate = try await session.append(
            streamId: "s", generation: 1, sequence: 1, audioURL: audio,
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
                streamId: "s", generation: 1, sequence: 1, audioURL: audio,
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
                streamId: "s", generation: 1, sequence: 1, audioURL: first,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }

        await waitForAppendCount(1, manager: manager)
        let secondTask = Task {
            try await session.append(
                streamId: "s", generation: 1, sequence: 2, audioURL: second,
                chunkStartSeconds: 1, chunkEndSeconds: 2
            )
        }
        await Task.yield()

        await assertThrows(
            .backpressure,
            try await session.append(
                streamId: "s", generation: 1, sequence: 3, audioURL: third,
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
                streamId: "s", generation: 1, sequence: 1, audioURL: first,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        }
        for _ in 0..<1_000 {
            if await manager.count() == 1 { break }
            await Task.yield()
        }
        let secondTask = Task {
            try await session.append(
                streamId: "s", generation: 1, sequence: 2, audioURL: second,
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
                streamId: "s", generation: 1, sequence: 1, audioURL: outside,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        )
    }

    func testFlushDestroysOneShotManagerAndProcessesTail() async throws {
        let driver = FakeLiveDriver(finishText: "tail")
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .mic, generation: 1)

        let result = try await session.flush(streamId: "s", generation: 1)

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
            try await session.cancel(streamId: "s", generation: 1)
        )
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
                    text: "synthetic", isConfirmed: true, confidence: 0.9
                )
            ],
            partialWindowFailed: true
        )
        let session = makeSession(driver: FakeLiveDriver(outcomes: [outcome]))
        try await session.open(streamId: "s", source: .system, generation: 1)
        let audio = try makeAudio("one.wav", contents: "one")

        let result = try await session.append(
            streamId: "s", generation: 1, sequence: 1, audioURL: audio,
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
    }

    func testCancelRemovesManagerAndPreventsLateAppendResults() async throws {
        let driver = FakeLiveDriver()
        let session = makeSession(driver: driver)
        try await session.open(streamId: "s", source: .mic, generation: 1)

        try await session.cancel(streamId: "s", generation: 1)

        let state = await session.state(streamId: "s")
        XCTAssertNil(state)
        let audio = try makeAudio("late.wav", contents: "late")
        await assertThrows(
            .streamNotFound,
            try await session.append(
                streamId: "s", generation: 1, sequence: 1, audioURL: audio,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        )
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

    private func waitForAppendCount(_ expected: Int, manager: BlockingLiveManager) async {
        for _ in 0..<1_000 {
            if await manager.appendedNames.count == expected { return }
            await Task.yield()
        }
        XCTFail("append did not start")
    }
}
