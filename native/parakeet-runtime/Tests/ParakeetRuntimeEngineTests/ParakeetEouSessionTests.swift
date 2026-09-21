import Foundation
import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

private actor FakeEouManager: ParakeetEouManaging {
    private var appendSnapshots: [[ParakeetEouManagerSnapshot]]
    private let finishSnapshots: [ParakeetEouManagerSnapshot]
    private(set) var cancelled = false

    init(
        appendSnapshots: [[ParakeetEouManagerSnapshot]],
        finishSnapshots: [ParakeetEouManagerSnapshot] = []
    ) {
        self.appendSnapshots = appendSnapshots
        self.finishSnapshots = finishSnapshots
    }

    func append(_ frame: EouPcmFrame) async throws -> [ParakeetEouManagerSnapshot] {
        guard !appendSnapshots.isEmpty else { return [] }
        return appendSnapshots.removeFirst()
    }

    func finish() async throws -> [ParakeetEouManagerSnapshot] { finishSnapshots }
    func cancel() async { cancelled = true }
}

private actor FakeEouDriver: ParakeetEouDriving {
    private var managers: [LiveSource: [FakeEouManager]]
    private(set) var requests: [ParakeetEouManagerRequest] = []

    init(managers: [LiveSource: FakeEouManager]) {
        self.managers = managers.mapValues { [$0] }
    }

    init(managerQueues: [LiveSource: [FakeEouManager]]) {
        managers = managerQueues
    }

    func makeManager(request: ParakeetEouManagerRequest) async throws
        -> any ParakeetEouManaging
    {
        requests.append(request)
        guard var queue = managers[request.source], !queue.isEmpty else {
            throw EouSessionFailure.modelUnavailable
        }
        let manager = queue.removeFirst()
        managers[request.source] = queue
        return manager
    }
}

final class ParakeetEouSessionTests: XCTestCase {
    func testKeepsMicAndSystemDecoderStateIndependent() async throws {
        let micManager = FakeEouManager(appendSnapshots: [[.partial("hello")]])
        let systemManager = FakeEouManager(appendSnapshots: [[.eou("remote words")]])
        let driver = FakeEouDriver(managers: [.mic: micManager, .system: systemManager])
        let session = ParakeetEouSession(driver: driver, activeModelURL: URL(fileURLWithPath: "/models"))

        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)
        try await session.open(streamId: "meeting.system", source: .system, generation: 1)
        let micEvents = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
            frame: try frame(start: 0)
        )
        let systemEvents = try await session.append(
            streamId: "meeting.system", source: .system, generation: 1, sequence: 1,
            frame: try frame(start: 0)
        )

        XCTAssertEqual(micEvents.compactMap(\.eouUpdate).first?.tentativeText, "hello")
        XCTAssertEqual(systemEvents.compactMap(\.eouUpdate).first?.committedText, "remote words")
        let requestedSources = await driver.requests.map(\.source)
        XCTAssertEqual(requestedSources, [.mic, .system])
    }

    func testCommitsEouAndRejectsLaterCommittedPrefixMutation() async throws {
        let manager = FakeEouManager(appendSnapshots: [
            [.partial("hello wor")],
            [.eou("hello world")],
            [.partial("goodbye")],
        ])
        let session = ParakeetEouSession(
            driver: FakeEouDriver(managers: [.mic: manager]),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)

        let first = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
            frame: try frame(start: 0)
        )
        let second = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 2,
            frame: try frame(start: 0.32)
        )

        XCTAssertEqual(first.compactMap(\.eouUpdate).first?.tentativeText, "hello wor")
        XCTAssertEqual(second.compactMap(\.eouUpdate).first?.committedText, "hello world")
        do {
            _ = try await session.append(
                streamId: "meeting.mic", source: .mic, generation: 1, sequence: 3,
                frame: try self.frame(start: 0.64)
            )
            XCTFail("Expected terminal prefix failure")
        } catch let terminal as EouSessionTerminalFailure {
            XCTAssertEqual(terminal.failure, .prefixMutated)
            guard case .eouFailed(let failed) = terminal.event else {
                return XCTFail("Expected EOU failure event")
            }
            XCTAssertEqual(failed.revision, 3)
            XCTAssertEqual(failed.reason, .prefixMutated)
        }
    }

    func testRejectsSequenceGapAndNoncontiguousAudio() async throws {
        let manager = FakeEouManager(appendSnapshots: [[], []])
        let session = ParakeetEouSession(
            driver: FakeEouDriver(managers: [.mic: manager]),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)

        await XCTAssertThrowsErrorAsync {
            _ = try await session.append(
                streamId: "meeting.mic", source: .mic, generation: 1, sequence: 2,
                frame: try self.frame(start: 0)
            )
        }
        _ = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
            frame: try frame(start: 0)
        )
        await XCTAssertThrowsErrorAsync {
            _ = try await session.append(
                streamId: "meeting.mic", source: .mic, generation: 1, sequence: 2,
                frame: try self.frame(start: 0.5)
            )
        }
    }

    func testFinishCommitsTailAndShutdownCancelsOtherSource() async throws {
        let mic = FakeEouManager(
            appendSnapshots: [[]],
            finishSnapshots: [.final("short tail")]
        )
        let system = FakeEouManager(appendSnapshots: [])
        let session = ParakeetEouSession(
            driver: FakeEouDriver(managers: [.mic: mic, .system: system]),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)
        try await session.open(streamId: "meeting.system", source: .system, generation: 1)
        _ = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
            frame: try frame(start: 0)
        )

        let events = try await session.finish(
            streamId: "meeting.mic", source: .mic, generation: 1
        )
        XCTAssertEqual(events.compactMap(\.eouUpdate).last?.committedText, "short tail")
        await session.shutdown()
        let systemCancelled = await system.cancelled
        XCTAssertTrue(systemCancelled)
    }

    func testResetDestroysOldManagerAndFencesStaleGeneration() async throws {
        let old = FakeEouManager(appendSnapshots: [])
        let replacement = FakeEouManager(appendSnapshots: [[.partial("new generation")]])
        let session = ParakeetEouSession(
            driver: FakeEouDriver(managerQueues: [.mic: [old, replacement]]),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)

        try await session.reset(streamId: "meeting.mic", source: .mic, generation: 2)

        let oldCancelled = await old.cancelled
        XCTAssertTrue(oldCancelled)
        await XCTAssertThrowsErrorAsync {
            _ = try await session.append(
                streamId: "meeting.mic", source: .mic, generation: 1, sequence: 1,
                frame: try self.frame(start: 0)
            )
        }
        let events = try await session.append(
            streamId: "meeting.mic", source: .mic, generation: 2, sequence: 1,
            frame: try frame(start: 0)
        )
        XCTAssertEqual(events.compactMap(\.eouUpdate).first?.tentativeText, "new generation")
    }

    func testSpeakerEvidenceSnapshotIsSynchronizedAndBounded() async throws {
        let mic = FakeEouManager(appendSnapshots: Array(repeating: [], count: 144))
        let system = FakeEouManager(appendSnapshots: Array(repeating: [], count: 144))
        let session = ParakeetEouSession(
            driver: FakeEouDriver(managers: [.mic: mic, .system: system]),
            activeModelURL: URL(fileURLWithPath: "/models")
        )
        try await session.open(streamId: "meeting.mic", source: .mic, generation: 1)
        try await session.open(streamId: "meeting.system", source: .system, generation: 1)
        try await session.setSpeakerEvidenceEnabled(
            true, streamId: "meeting.system", generation: 1
        )

        for sequence in 1...144 {
            let start = Double(sequence - 1) * 0.32
            _ = try await session.append(
                streamId: "meeting.mic", source: .mic, generation: 1,
                sequence: sequence, frame: try frame(start: start)
            )
            _ = try await session.append(
                streamId: "meeting.system", source: .system, generation: 1,
                sequence: sequence, frame: try frame(start: start)
            )
        }

        let snapshot = try await session.speakerEvidenceSnapshot(
            streamId: "meeting.system", generation: 1
        )
        XCTAssertEqual(snapshot.startSeconds, 1.08, accuracy: 0.000_001)
        XCTAssertEqual(snapshot.endSeconds, 46.08, accuracy: 0.000_001)
        XCTAssertEqual(snapshot.micSampleRate, 8_000)
        XCTAssertEqual(snapshot.systemSampleRate, 8_000)
        XCTAssertEqual(snapshot.micSamples.count, 360_000)
        XCTAssertEqual(snapshot.systemSamples.count, 360_000)

        try await session.setSpeakerEvidenceEnabled(
            false, streamId: "meeting.system", generation: 1
        )
        do {
            _ = try await session.speakerEvidenceSnapshot(
                streamId: "meeting.system", generation: 1
            )
            XCTFail("Expected disabled speaker evidence to reject snapshots")
        } catch let failure as EouSessionFailure {
            XCTAssertEqual(failure, .inferenceFailed)
        }
    }

    private func frame(start: Double) throws -> EouPcmFrame {
        let samples = [Float](repeating: 0, count: 2_560)
        let data = samples.withUnsafeBytes { Data($0) }
        return try EouPcmFrame(
            sampleRate: 8_000,
            channelCount: 1,
            frameCount: samples.count,
            audioStartSeconds: start,
            audioEndSeconds: start + 0.32,
            pcmData: data
        )
    }
}

private extension RuntimeEvent {
    var eouUpdate: EouUpdate? {
        guard case .eouUpdate(let update) = self else { return nil }
        return update
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected error", file: file, line: line)
    } catch {}
}
