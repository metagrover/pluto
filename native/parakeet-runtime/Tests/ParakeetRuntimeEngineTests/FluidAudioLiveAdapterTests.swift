import AVFoundation
import FluidAudio
import Foundation
import XCTest

@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

private actor AcknowledgedBackendProbe: FluidAudioAcknowledgedLiveBackend {
    private let attempted: [SlidingWindowSampleRange]
    private let processed: [SlidingWindowSampleRange]
    private let failed: [SlidingWindowFailedRange]
    private let updates: [SlidingWindowTranscriptionUpdate]
    private let finishReport: SlidingWindowFinishReport
    private let blocksIngestion: Bool
    private var waiter: CheckedContinuation<Void, Never>?
    let ingestionStarted: AsyncStream<Void>
    private let signalIngestionStarted: AsyncStream<Void>.Continuation
    private var acceptedSampleCount = 0
    private(set) var receipts: [String] = []
    private(set) var frameCounts: [Int] = []
    private(set) var cancelCount = 0

    init(
        attempted: [SlidingWindowSampleRange] = [],
        processed: [SlidingWindowSampleRange] = [],
        failed: [SlidingWindowFailedRange] = [],
        updates: [SlidingWindowTranscriptionUpdate] = [],
        finishReport: SlidingWindowFinishReport = SlidingWindowFinishReport(
            finalTranscript: "", attemptedCenterRanges: [],
            processedCenterRanges: [], failedCenterRanges: [], finalUpdates: []
        ),
        blocksIngestion: Bool = false
    ) {
        self.attempted = attempted
        self.processed = processed
        self.failed = failed
        self.updates = updates
        self.finishReport = finishReport
        self.blocksIngestion = blocksIngestion
        (ingestionStarted, signalIngestionStarted) = AsyncStream.makeStream(
            bufferingPolicy: .bufferingNewest(1)
        )
    }

    func ingestAudio(
        _ buffer: sending AVAudioPCMBuffer,
        receipt: String
    ) async throws -> SlidingWindowIngestionReport {
        receipts.append(receipt)
        frameCounts.append(Int(buffer.frameLength))
        if blocksIngestion {
            await withCheckedContinuation {
                waiter = $0
                signalIngestionStarted.yield(())
            }
        }
        let count = Int(buffer.frameLength)
        let accepted = SlidingWindowSampleRange(
            startSample: acceptedSampleCount,
            endSample: acceptedSampleCount + count
        )
        acceptedSampleCount += count
        return SlidingWindowIngestionReport(
            receipt: receipt,
            acceptedSamples: accepted,
            attemptedCenterRanges: attempted,
            processedCenterRanges: processed,
            failedCenterRanges: failed,
            updates: updates
        )
    }

    func finishDetailed() async throws -> SlidingWindowFinishReport { finishReport }

    func cancel() async {
        cancelCount += 1
        waiter?.resume()
        waiter = nil
    }

    func releaseIngestion() {
        waiter?.resume()
        waiter = nil
    }
}

private actor CompletionProbe {
    private(set) var completed = false
    func markCompleted() { completed = true }
}

final class FluidAudioLiveAdapterTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("fluid-live-adapter-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testAppendAwaitsAcknowledgementAndMapsExactRanges() async throws {
        let processed = SlidingWindowSampleRange(startSample: 2_000, endSample: 4_000)
        let failed = SlidingWindowSampleRange(startSample: 4_000, endSample: 6_000)
        let backend = AcknowledgedBackendProbe(
            attempted: [processed, failed],
            processed: [processed],
            failed: [
                SlidingWindowFailedRange(centerRange: failed, reason: .processingFailed)
            ],
            updates: [makeUpdate("bounded")],
            blocksIngestion: true
        )
        let manager = FluidAudioLiveManager(
            backend: backend, streamId: "stream", source: .mic, generation: 7
        )
        let audio = try makeAudio(sampleCount: 16_000)
        let request = makeRequest(audio: audio, sequence: 3)
        let completion = CompletionProbe()

        let append = Task {
            let outcome = try await manager.append(request: request)
            await completion.markCompleted()
            return outcome
        }
        try await waitForReceipt(backend)
        let completedBeforeAcknowledgement = await completion.completed
        XCTAssertFalse(completedBeforeAcknowledgement)
        await backend.releaseIngestion()
        let outcome = try await append.value

        XCTAssertEqual(outcome.updates.map(\.processedAudioEndSeconds), [0.25])
        XCTAssertEqual(
            outcome.degradations,
            [LiveDriverDegradation(reason: .partialWindow, startSeconds: 0.25, endSeconds: 0.375)]
        )
        let frameCounts = await backend.frameCounts
        let receiptCount = await backend.receipts.count
        XCTAssertEqual(frameCounts.count, 1)
        XCTAssertGreaterThan(frameCounts[0], 0)
        XCTAssertEqual(receiptCount, 1)
    }

    func testReceiptChangesWithImmutableAppendIdentity() async throws {
        let backend = AcknowledgedBackendProbe()
        let manager = FluidAudioLiveManager(
            backend: backend, streamId: "stream", source: .system, generation: 4
        )
        let first = try makeAudio(sampleCount: 16_000, name: "first.wav")
        let second = try makeAudio(sampleCount: 16_000, name: "second.wav")

        _ = try await manager.append(
            request: makeRequest(
                audio: first, source: .system, generation: 4, sequence: 1
            )
        )
        _ = try await manager.append(
            request: makeRequest(
                audio: second, source: .system, generation: 4, sequence: 2
            )
        )

        let receipts = await backend.receipts
        XCTAssertEqual(receipts.count, 2)
        XCTAssertNotEqual(receipts[0], receipts[1])
        XCTAssertFalse(receipts[0].contains("stream"))
    }

    func testFinishDetailedPreservesShortTailUpdateExactlyOnce() async throws {
        let tail = SlidingWindowSampleRange(startSample: 0, endSample: 8_000)
        let backend = AcknowledgedBackendProbe(
            finishReport: SlidingWindowFinishReport(
                finalTranscript: "tail", attemptedCenterRanges: [tail],
                processedCenterRanges: [tail], failedCenterRanges: [],
                finalUpdates: [makeUpdate("tail")]
            )
        )
        let manager = FluidAudioLiveManager(
            backend: backend, streamId: "stream", source: .mic, generation: 1
        )

        let outcome = try await manager.finish()

        XCTAssertEqual(outcome.finalText, "tail")
        XCTAssertEqual(outcome.updates.map(\.processedAudioEndSeconds), [0.5])
        do {
            _ = try await manager.finish()
            XCTFail("expected terminal manager")
        } catch {
            XCTAssertEqual(error as? LiveRuntimeFailure, .cancelled)
        }
    }

    func testCancelSuppressesAcknowledgementThatArrivesLate() async throws {
        let backend = AcknowledgedBackendProbe(blocksIngestion: true)
        let manager = FluidAudioLiveManager(
            backend: backend, streamId: "stream", source: .mic, generation: 1
        )
        let audio = try makeAudio(sampleCount: 16_000)
        let request = makeRequest(audio: audio, generation: 1, sequence: 1)
        let append = Task {
            try await manager.append(request: request)
        }
        try await waitForReceipt(backend)

        await manager.cancel()

        do {
            _ = try await append.value
            XCTFail("expected cancelled append")
        } catch {
            XCTAssertEqual(error as? LiveRuntimeFailure, .cancelled)
        }
        let cancelCount = await backend.cancelCount
        XCTAssertEqual(cancelCount, 1)
    }

    private func makeRequest(
        audio: URL, source: LiveSource = .mic, generation: Int = 7,
        sequence: Int
    ) -> ParakeetLiveAppendRequest {
        ParakeetLiveAppendRequest(
            audioURL: audio, streamId: "stream", source: source,
            generation: generation, sequence: sequence,
            chunkStartSeconds: Double(sequence - 1) / 10,
            chunkEndSeconds: Double(sequence) / 10
        )
    }

    private func makeAudio(
        sampleCount: Int, name: String = "audio.wav"
    ) throws -> URL {
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16_000,
            channels: 1,
            interleaved: false
        )!
        let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(sampleCount)
        )!
        buffer.frameLength = AVAudioFrameCount(sampleCount)
        let url = root.appendingPathComponent(name)
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
        return url
    }

    private func makeUpdate(_ text: String) -> SlidingWindowTranscriptionUpdate {
        SlidingWindowTranscriptionUpdate(
            text: text, isConfirmed: false, confidence: 0.8,
            timestamp: Date(timeIntervalSince1970: 0)
        )
    }

    private enum ProbeFailure: Error { case ingestionDidNotStart }

    private func waitForReceipt(_ backend: AcknowledgedBackendProbe) async throws {
        // Wait for the installed continuation, not a scheduler-dependent number
        // of yields. Never release ingestion before the backend can receive it.
        let started = backend.ingestionStarted
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                for await _ in started { return }
                throw ProbeFailure.ingestionDidNotStart
            }
            group.addTask {
                try await Task.sleep(for: .seconds(2))
                throw ProbeFailure.ingestionDidNotStart
            }
            defer { group.cancelAll() }
            _ = try await group.next()
        }
    }
}
