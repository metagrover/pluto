import CryptoKit
import Foundation
import ParakeetRuntimeCore

public enum LiveRuntimeFailure: Error, Equatable, Sendable {
    case streamCapacity
    case streamNotFound
    case generationMismatch
    case sequenceGap
    case duplicateMismatch
    case backpressure
    case pathNotAllowed
    case modelUnavailable
    case inferenceFailed
    case cancelled
}

public struct LiveRuntimeTerminalFailure: Error, Equatable, Sendable {
    public let failure: LiveRuntimeFailure
    public let event: RuntimeEvent

    public init(failure: LiveRuntimeFailure, event: RuntimeEvent) {
        self.failure = failure
        self.event = event
    }
}

public enum ParakeetLiveVocabularyMode: Equatable, Sendable {
    case finalOnly
}

public struct ParakeetLiveConfiguration: Equatable, Sendable {
    public let chunkSeconds: Double
    public let hypothesisChunkSeconds: Double
    public let leftContextSeconds: Double
    public let rightContextSeconds: Double
    public let minContextForConfirmation: Double
    public let confirmationThreshold: Double

    public static let pinnedDefault = ParakeetLiveConfiguration(
        chunkSeconds: 11,
        hypothesisChunkSeconds: 2,
        leftContextSeconds: 2,
        rightContextSeconds: 2,
        minContextForConfirmation: 10,
        confirmationThreshold: 0.85
    )

    public static let lowLatencyCandidate = ParakeetLiveConfiguration(
        chunkSeconds: 2,
        hypothesisChunkSeconds: 2,
        leftContextSeconds: 2,
        rightContextSeconds: 2,
        minContextForConfirmation: 10,
        confirmationThreshold: 0.80
    )

    public init(
        chunkSeconds: Double,
        hypothesisChunkSeconds: Double,
        leftContextSeconds: Double,
        rightContextSeconds: Double,
        minContextForConfirmation: Double,
        confirmationThreshold: Double
    ) {
        self.chunkSeconds = chunkSeconds
        self.hypothesisChunkSeconds = hypothesisChunkSeconds
        self.leftContextSeconds = leftContextSeconds
        self.rightContextSeconds = rightContextSeconds
        self.minContextForConfirmation = minContextForConfirmation
        self.confirmationThreshold = confirmationThreshold
    }
}

public struct ParakeetLiveManagerRequest: Equatable, Sendable {
    public let activeModelURL: URL
    public let source: LiveSource
    public let configuration: ParakeetLiveConfiguration
    public let vocabularyMode: ParakeetLiveVocabularyMode

    public init(
        activeModelURL: URL,
        source: LiveSource,
        configuration: ParakeetLiveConfiguration,
        vocabularyMode: ParakeetLiveVocabularyMode
    ) {
        self.activeModelURL = activeModelURL
        self.source = source
        self.configuration = configuration
        self.vocabularyMode = vocabularyMode
    }
}

public struct LiveDriverUpdate: Equatable, Sendable {
    public let text: String
    public let isConfirmed: Bool
    public let confidence: Double

    public init(text: String, isConfirmed: Bool, confidence: Double) {
        self.text = text
        self.isConfirmed = isConfirmed
        self.confidence = confidence
    }
}

public struct LiveDriverAppendOutcome: Equatable, Sendable {
    public let updates: [LiveDriverUpdate]
    public let partialWindowFailed: Bool

    public init(
        updates: [LiveDriverUpdate] = [],
        partialWindowFailed: Bool = false
    ) {
        self.updates = updates
        self.partialWindowFailed = partialWindowFailed
    }
}

public protocol ParakeetLiveManaging: Sendable {
    func append(audioURL: URL) async throws -> LiveDriverAppendOutcome
    func finish() async throws -> String
    func cancel() async
}

public protocol ParakeetLiveDriving: Sendable {
    func makeManager(request: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
}

public struct LiveAppendResult: Equatable, Sendable {
    public let events: [RuntimeEvent]
    public let wasDuplicate: Bool

    public init(events: [RuntimeEvent], wasDuplicate: Bool) {
        self.events = events
        self.wasDuplicate = wasDuplicate
    }
}

public struct LiveFlushResult: Equatable, Sendable {
    public let finalPreview: String
    public let degradations: [LiveStreamDegraded]

    public init(finalPreview: String, degradations: [LiveStreamDegraded]) {
        self.finalPreview = finalPreview
        self.degradations = degradations
    }
}

public struct ParakeetLiveSessionState: Equatable, Sendable {
    public let source: LiveSource
    public let generation: Int
    public let nextSequence: Int
}

public actor ParakeetLiveSession {
    private struct AppendIdentity: Equatable, Sendable {
        let checksum: String
        let chunkStartSeconds: Double
        let chunkEndSeconds: Double
    }

    private struct StreamState: Sendable {
        let source: LiveSource
        let generation: Int
        let manager: any ParakeetLiveManaging
        var nextSequence = 1
        var revision = 0
        var accepted: [Int: AppendIdentity] = [:]
        var degradations: [LiveStreamDegraded] = []
        var appendTail: Task<LiveDriverAppendOutcome, Error>?
        var admittedAppendCount = 0
    }

    private let driver: any ParakeetLiveDriving
    private let activeModelURL: URL
    private let pathPolicy: PathPolicy
    private let configuration: ParakeetLiveConfiguration
    private let maximumStreams: Int
    private let maximumAdmittedAppendsPerStream: Int
    private var streams: [String: StreamState] = [:]

    public init(
        driver: any ParakeetLiveDriving,
        activeModelURL: URL,
        audioRoot: URL,
        configuration: ParakeetLiveConfiguration = .pinnedDefault,
        maximumStreams: Int = 2,
        maximumAdmittedAppendsPerStream: Int = 2
    ) {
        self.driver = driver
        self.activeModelURL = activeModelURL.standardizedFileURL
        self.pathPolicy = PathPolicy(root: audioRoot.standardizedFileURL.path)
        self.configuration = configuration
        self.maximumStreams = maximumStreams
        self.maximumAdmittedAppendsPerStream = maximumAdmittedAppendsPerStream
    }

    public func open(streamId: String, source: LiveSource, generation: Int) async throws {
        guard
            streams[streamId] == nil,
            streams.count < maximumStreams,
            !streams.values.contains(where: { $0.source == source })
        else {
            throw LiveRuntimeFailure.streamCapacity
        }
        var isDirectory: ObjCBool = false
        guard
            FileManager.default.fileExists(
                atPath: activeModelURL.path,
                isDirectory: &isDirectory
            ),
            isDirectory.boolValue
        else { throw LiveRuntimeFailure.modelUnavailable }

        let manager: any ParakeetLiveManaging
        do {
            manager = try await driver.makeManager(
                request: ParakeetLiveManagerRequest(
                    activeModelURL: activeModelURL,
                    source: source,
                    configuration: configuration,
                    vocabularyMode: .finalOnly
                ))
        } catch {
            throw LiveRuntimeFailure.modelUnavailable
        }
        streams[streamId] = StreamState(
            source: source,
            generation: generation,
            manager: manager
        )
    }

    public func append(
        streamId: String,
        generation: Int,
        sequence: Int,
        audioURL: URL,
        chunkStartSeconds: Double,
        chunkEndSeconds: Double
    ) async throws -> LiveAppendResult {
        guard var stream = streams[streamId] else {
            throw LiveRuntimeFailure.streamNotFound
        }
        guard stream.generation == generation else {
            throw LiveRuntimeFailure.generationMismatch
        }

        let approvedURL: URL
        do {
            approvedURL = try pathPolicy.approve(path: audioURL.path, kind: .regularFile)
        } catch {
            throw LiveRuntimeFailure.pathNotAllowed
        }
        let identity = AppendIdentity(
            checksum: try checksum(of: approvedURL),
            chunkStartSeconds: chunkStartSeconds,
            chunkEndSeconds: chunkEndSeconds
        )
        if let accepted = stream.accepted[sequence] {
            guard accepted == identity else { throw LiveRuntimeFailure.duplicateMismatch }
            return LiveAppendResult(events: [], wasDuplicate: true)
        }
        guard sequence == stream.nextSequence else {
            throw LiveRuntimeFailure.sequenceGap
        }
        guard stream.admittedAppendCount < maximumAdmittedAppendsPerStream else {
            throw LiveRuntimeFailure.backpressure
        }

        let priorAppend = stream.appendTail
        let manager = stream.manager
        let operation = Task<LiveDriverAppendOutcome, Error> {
            if let priorAppend { _ = try await priorAppend.value }
            try Task.checkCancellation()
            return try await manager.append(audioURL: approvedURL)
        }
        stream.accepted[sequence] = identity
        stream.nextSequence += 1
        stream.admittedAppendCount += 1
        stream.appendTail = operation
        streams[streamId] = stream

        let outcome: LiveDriverAppendOutcome
        do {
            outcome = try await operation.value
        } catch is CancellationError {
            throw LiveRuntimeFailure.cancelled
        } catch {
            let terminal = streams[streamId] ?? stream
            let event = RuntimeEvent.streamFailed(
                LiveStreamFailed(
                    streamId: streamId,
                    source: terminal.source,
                    generation: terminal.generation,
                    revision: terminal.revision + 1,
                    reason: .inferenceFailed
                ))
            streams[streamId] = nil
            await manager.cancel()
            throw LiveRuntimeTerminalFailure(failure: .inferenceFailed, event: event)
        }

        guard let current = streams[streamId], current.generation == generation else {
            throw LiveRuntimeFailure.cancelled
        }
        stream = current
        stream.admittedAppendCount -= 1
        if stream.admittedAppendCount == 0 { stream.appendTail = nil }
        var events: [RuntimeEvent] = []
        for update in outcome.updates {
            stream.revision += 1
            events.append(
                .streamUpdate(
                    LiveStreamUpdate(
                        streamId: streamId,
                        source: stream.source,
                        generation: generation,
                        revision: stream.revision,
                        qualifiesPriorTentative: update.isConfirmed,
                        text: update.text,
                        confidence: update.confidence,
                        audioEndSeconds: chunkEndSeconds
                    )))
        }
        if outcome.partialWindowFailed {
            stream.revision += 1
            let degraded = LiveStreamDegraded(
                streamId: streamId,
                source: stream.source,
                generation: generation,
                revision: stream.revision,
                reason: .partialWindow,
                affectedSequence: sequence,
                chunkStartSeconds: chunkStartSeconds,
                chunkEndSeconds: chunkEndSeconds
            )
            stream.degradations.append(degraded)
            events.append(.streamDegraded(degraded))
        }
        streams[streamId] = stream
        return LiveAppendResult(events: events, wasDuplicate: false)
    }

    public func flush(streamId: String, generation: Int) async throws -> LiveFlushResult {
        let stream = try remove(streamId: streamId, generation: generation)
        do {
            let preview = try await stream.manager.finish()
            return LiveFlushResult(
                finalPreview: preview,
                degradations: stream.degradations
            )
        } catch is CancellationError {
            throw LiveRuntimeFailure.cancelled
        } catch {
            throw LiveRuntimeFailure.inferenceFailed
        }
    }

    public func cancel(streamId: String, generation: Int) async throws {
        let stream = try remove(streamId: streamId, generation: generation)
        await stream.manager.cancel()
    }

    public func reset(
        streamId: String,
        source: LiveSource,
        generation: Int
    ) async throws {
        guard let current = streams[streamId] else {
            throw LiveRuntimeFailure.streamNotFound
        }
        guard current.source == source, generation > current.generation else {
            throw LiveRuntimeFailure.generationMismatch
        }
        streams[streamId] = nil
        await current.manager.cancel()
        try await open(streamId: streamId, source: source, generation: generation)
    }

    public func state(streamId: String) -> ParakeetLiveSessionState? {
        streams[streamId].map {
            ParakeetLiveSessionState(
                source: $0.source,
                generation: $0.generation,
                nextSequence: $0.nextSequence
            )
        }
    }

    public func shutdown() async {
        let active = streams.values.map(\.manager)
        streams.removeAll()
        for manager in active { await manager.cancel() }
    }

    private func remove(streamId: String, generation: Int) throws -> StreamState {
        guard let stream = streams[streamId] else {
            throw LiveRuntimeFailure.streamNotFound
        }
        guard stream.generation == generation else {
            throw LiveRuntimeFailure.generationMismatch
        }
        streams[streamId] = nil
        return stream
    }

    private func checksum(of url: URL) throws -> String {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
