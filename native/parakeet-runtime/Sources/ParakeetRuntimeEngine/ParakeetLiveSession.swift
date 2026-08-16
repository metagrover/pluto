import CryptoKit
import Foundation
import ParakeetRuntimeCore

public enum LiveRuntimeFailure: Error, Equatable, Sendable {
    case streamCapacity
    case streamNotFound
    case generationMismatch
    case sourceMismatch
    case sequenceGap
    case duplicateMismatch
    case backpressure
    case pathNotAllowed
    case modelUnavailable
    case unsupportedCapability
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

public enum ParakeetLiveVocabularyMode: Equatable, Sendable { case finalOnly }

public struct ParakeetLiveConfiguration: Equatable, Sendable {
    public let chunkSeconds: Double
    public let hypothesisChunkSeconds: Double
    public let leftContextSeconds: Double
    public let rightContextSeconds: Double
    public let minContextForConfirmation: Double
    public let confirmationThreshold: Double

    public static let pinnedDefault = ParakeetLiveConfiguration(
        chunkSeconds: 11, hypothesisChunkSeconds: 2, leftContextSeconds: 2,
        rightContextSeconds: 2, minContextForConfirmation: 10,
        confirmationThreshold: 0.85
    )
    public static let lowLatencyCandidate = ParakeetLiveConfiguration(
        chunkSeconds: 2, hypothesisChunkSeconds: 2, leftContextSeconds: 2,
        rightContextSeconds: 2, minContextForConfirmation: 10,
        confirmationThreshold: 0.80
    )

    public init(
        chunkSeconds: Double, hypothesisChunkSeconds: Double,
        leftContextSeconds: Double, rightContextSeconds: Double,
        minContextForConfirmation: Double, confirmationThreshold: Double
    ) {
        self.chunkSeconds = chunkSeconds
        self.hypothesisChunkSeconds = hypothesisChunkSeconds
        self.leftContextSeconds = leftContextSeconds
        self.rightContextSeconds = rightContextSeconds
        self.minContextForConfirmation = minContextForConfirmation
        self.confirmationThreshold = confirmationThreshold
    }
}

public struct ParakeetLiveDriverCapabilities: Equatable, Sendable {
    public let boundedProcessingAcknowledgements: Bool
    public let exactProcessedAudioWatermarks: Bool
    public let partialWindowFailureReporting: Bool
    public let transcriptSafeLogging: Bool

    public static let required = ParakeetLiveDriverCapabilities(
        boundedProcessingAcknowledgements: true,
        exactProcessedAudioWatermarks: true,
        partialWindowFailureReporting: true,
        transcriptSafeLogging: true
    )
    public static let unsupported = ParakeetLiveDriverCapabilities(
        boundedProcessingAcknowledgements: false,
        exactProcessedAudioWatermarks: false,
        partialWindowFailureReporting: false,
        transcriptSafeLogging: false
    )
    public var supportsRequiredContract: Bool {
        boundedProcessingAcknowledgements && exactProcessedAudioWatermarks
            && partialWindowFailureReporting && transcriptSafeLogging
    }

    public init(
        boundedProcessingAcknowledgements: Bool,
        exactProcessedAudioWatermarks: Bool,
        partialWindowFailureReporting: Bool,
        transcriptSafeLogging: Bool
    ) {
        self.boundedProcessingAcknowledgements = boundedProcessingAcknowledgements
        self.exactProcessedAudioWatermarks = exactProcessedAudioWatermarks
        self.partialWindowFailureReporting = partialWindowFailureReporting
        self.transcriptSafeLogging = transcriptSafeLogging
    }
}

public struct ParakeetLiveManagerRequest: Equatable, Sendable {
    public let activeModelURL: URL
    public let source: LiveSource
    public let configuration: ParakeetLiveConfiguration
    public let vocabularyMode: ParakeetLiveVocabularyMode
    public init(
        activeModelURL: URL, source: LiveSource,
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
    public let processedAudioEndSeconds: Double?
    public init(
        text: String, isConfirmed: Bool, confidence: Double,
        processedAudioEndSeconds: Double?
    ) {
        self.text = text
        self.isConfirmed = isConfirmed
        self.confidence = confidence
        self.processedAudioEndSeconds = processedAudioEndSeconds
    }
}

public struct LiveDriverAppendOutcome: Equatable, Sendable {
    public let updates: [LiveDriverUpdate]
    public let partialWindowFailed: Bool
    public init(updates: [LiveDriverUpdate] = [], partialWindowFailed: Bool = false) {
        self.updates = updates
        self.partialWindowFailed = partialWindowFailed
    }
}

public struct LiveDriverFinishOutcome: Equatable, Sendable {
    public let finalText: String
    public let updates: [LiveDriverUpdate]
    public let partialWindowFailed: Bool
    public init(
        finalText: String, updates: [LiveDriverUpdate] = [],
        partialWindowFailed: Bool = false
    ) {
        self.finalText = finalText
        self.updates = updates
        self.partialWindowFailed = partialWindowFailed
    }
}

public protocol ParakeetLiveManaging: Sendable {
    func append(audioURL: URL) async throws -> LiveDriverAppendOutcome
    func finish() async throws -> LiveDriverFinishOutcome
    func cancel() async
}
public protocol ParakeetLiveDriving: Sendable {
    func capabilities() async -> ParakeetLiveDriverCapabilities
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
    public let events: [RuntimeEvent]
    public let degradations: [LiveStreamDegraded]
    public init(
        finalPreview: String, events: [RuntimeEvent],
        degradations: [LiveStreamDegraded]
    ) {
        self.finalPreview = finalPreview
        self.events = events
        self.degradations = degradations
    }
}

public enum ParakeetLiveLifecycle: Equatable, Sendable {
    case opening, open, flushing, cancelled, failed
}
public struct ParakeetLiveSessionState: Equatable, Sendable {
    public let source: LiveSource
    public let generation: Int
    public let nextSequence: Int
    public let lifecycle: ParakeetLiveLifecycle
}

public actor ParakeetLiveSession {
    private struct AppendIdentity: Equatable, Sendable {
        let checksum: String
        let chunkStartSeconds: Double
        let chunkEndSeconds: Double
    }
    private struct PendingAppend: Sendable {
        let sequence: Int
        let audioURL: URL
        let chunkStartSeconds: Double
        let chunkEndSeconds: Double
        let continuation: CheckedContinuation<LiveAppendResult, Error>
    }
    private struct StreamState: Sendable {
        let source: LiveSource
        let generation: Int
        let manager: any ParakeetLiveManaging
        var lifecycle: ParakeetLiveLifecycle = .open
        var nextSequence = 1
        var revision = 0
        var accepted: [Int: AppendIdentity] = [:]
        var degradations: [LiveStreamDegraded] = []
        var queue: [PendingAppend] = []
        var active: PendingAppend?
        var drainWaiters: [CheckedContinuation<Void, Error>] = []
    }
    private struct OpenReservation: Equatable, Sendable {
        let token: UUID
        let source: LiveSource
        let generation: Int
        let lifecycle: ParakeetLiveLifecycle
    }

    private let driver: any ParakeetLiveDriving
    private let activeModelURL: URL
    private let pathPolicy: PathPolicy
    private let configuration: ParakeetLiveConfiguration
    private let maximumStreams: Int
    private let maximumAdmittedAppendsPerStream: Int
    private var streams: [String: StreamState] = [:]
    private var reservations: [String: OpenReservation] = [:]

    public init(
        driver: any ParakeetLiveDriving, activeModelURL: URL, audioRoot: URL,
        configuration: ParakeetLiveConfiguration = .pinnedDefault,
        maximumStreams: Int = 2, maximumAdmittedAppendsPerStream: Int = 2
    ) {
        self.driver = driver
        self.activeModelURL = activeModelURL.standardizedFileURL
        self.pathPolicy = PathPolicy(root: audioRoot.standardizedFileURL.path)
        self.configuration = configuration
        self.maximumStreams = maximumStreams
        self.maximumAdmittedAppendsPerStream = maximumAdmittedAppendsPerStream
    }

    public func open(streamId: String, source: LiveSource, generation: Int) async throws {
        guard generation > 0 else { throw LiveRuntimeFailure.generationMismatch }
        guard canReserve(streamId: streamId, source: source) else {
            throw LiveRuntimeFailure.streamCapacity
        }
        let reservation = OpenReservation(
            token: UUID(), source: source, generation: generation, lifecycle: .opening
        )
        reservations[streamId] = reservation
        let capabilities = await driver.capabilities()
        try validateOpening(streamId: streamId, reservation: reservation)
        guard capabilities.supportsRequiredContract else {
            removeReservation(streamId: streamId, matching: reservation)
            throw LiveRuntimeFailure.unsupportedCapability
        }
        var isDirectory: ObjCBool = false
        guard
            FileManager.default.fileExists(
                atPath: activeModelURL.path, isDirectory: &isDirectory
            ), isDirectory.boolValue
        else {
            removeReservation(streamId: streamId, matching: reservation)
            throw LiveRuntimeFailure.modelUnavailable
        }
        let manager: any ParakeetLiveManaging
        do {
            manager = try await driver.makeManager(
                request: ParakeetLiveManagerRequest(
                    activeModelURL: activeModelURL, source: source,
                    configuration: configuration, vocabularyMode: .finalOnly
                ))
        } catch {
            let wasCurrent = reservations[streamId] == reservation
            removeReservation(streamId: streamId, matching: reservation)
            do {
                try Task.checkCancellation()
            } catch {
                throw LiveRuntimeFailure.cancelled
            }
            guard wasCurrent else { throw LiveRuntimeFailure.cancelled }
            throw LiveRuntimeFailure.modelUnavailable
        }
        do {
            try validateOpening(streamId: streamId, reservation: reservation)
        } catch {
            await manager.cancel()
            throw error
        }
        reservations[streamId] = nil
        streams[streamId] = StreamState(
            source: source, generation: generation, manager: manager
        )
    }

    public func append(
        streamId: String, source: LiveSource, generation: Int, sequence: Int,
        audioURL: URL, chunkStartSeconds: Double, chunkEndSeconds: Double
    ) async throws -> LiveAppendResult {
        var stream = try requireStream(
            streamId: streamId, source: source, generation: generation
        )
        guard stream.lifecycle == .open else { throw LiveRuntimeFailure.cancelled }
        let approvedURL: URL
        do {
            approvedURL = try pathPolicy.approve(path: audioURL.path, kind: .regularFile)
        } catch { throw LiveRuntimeFailure.pathNotAllowed }
        let identity = AppendIdentity(
            checksum: try checksum(of: approvedURL),
            chunkStartSeconds: chunkStartSeconds,
            chunkEndSeconds: chunkEndSeconds
        )
        if let accepted = stream.accepted[sequence] {
            guard accepted == identity else { throw LiveRuntimeFailure.duplicateMismatch }
            return LiveAppendResult(events: [], wasDuplicate: true)
        }
        guard sequence == stream.nextSequence else { throw LiveRuntimeFailure.sequenceGap }
        guard
            stream.queue.count + (stream.active == nil ? 0 : 1)
                < maximumAdmittedAppendsPerStream
        else { throw LiveRuntimeFailure.backpressure }
        stream.accepted[sequence] = identity
        stream.nextSequence += 1
        return try await withCheckedThrowingContinuation { continuation in
            stream.queue.append(
                PendingAppend(
                    sequence: sequence, audioURL: approvedURL,
                    chunkStartSeconds: chunkStartSeconds,
                    chunkEndSeconds: chunkEndSeconds,
                    continuation: continuation
                ))
            let shouldStart = stream.active == nil && stream.queue.count == 1
            streams[streamId] = stream
            if shouldStart {
                Task { await self.processNext(streamId: streamId, generation: generation) }
            }
        }
    }

    public func flush(
        streamId: String, source: LiveSource, generation: Int
    ) async throws -> LiveFlushResult {
        var stream = try requireStream(
            streamId: streamId, source: source, generation: generation
        )
        guard stream.lifecycle == .open else { throw LiveRuntimeFailure.cancelled }
        stream.lifecycle = .flushing
        streams[streamId] = stream
        try await waitUntilDrained(streamId: streamId, generation: generation)
        guard let beforeFinish = streams[streamId], beforeFinish.generation == generation else {
            throw LiveRuntimeFailure.cancelled
        }
        let outcome: LiveDriverFinishOutcome
        do { outcome = try await beforeFinish.manager.finish() } catch {
            throw await failFinish(streamId: streamId, generation: generation)
        }
        guard var current = streams[streamId], current.generation == generation else {
            throw LiveRuntimeFailure.cancelled
        }
        let events = applyUpdates(
            outcome.updates, partialWindowFailed: outcome.partialWindowFailed,
            affectedSequence: nil, chunkStartSeconds: nil, chunkEndSeconds: nil,
            streamId: streamId, stream: &current
        )
        streams[streamId] = nil
        return LiveFlushResult(
            finalPreview: outcome.finalText, events: events,
            degradations: current.degradations
        )
    }

    public func cancel(
        streamId: String, source: LiveSource, generation: Int
    ) async throws {
        if let stream = streams[streamId] {
            guard stream.source == source else { throw LiveRuntimeFailure.sourceMismatch }
            guard stream.generation == generation else {
                throw LiveRuntimeFailure.generationMismatch
            }
            await terminate(streamId: streamId, stream: stream, reason: .cancelled)
            return
        }
        guard let reservation = reservations[streamId] else {
            throw LiveRuntimeFailure.streamNotFound
        }
        guard reservation.source == source else { throw LiveRuntimeFailure.sourceMismatch }
        guard reservation.generation == generation else {
            throw LiveRuntimeFailure.generationMismatch
        }
        reservations[streamId] = nil
    }

    public func reset(
        streamId: String, source: LiveSource, generation: Int
    ) async throws {
        let currentSource: LiveSource
        let currentGeneration: Int
        if let current = streams[streamId] {
            currentSource = current.source
            currentGeneration = current.generation
        } else if let opening = reservations[streamId] {
            currentSource = opening.source
            currentGeneration = opening.generation
        } else {
            throw LiveRuntimeFailure.streamNotFound
        }
        guard currentSource == source else { throw LiveRuntimeFailure.sourceMismatch }
        guard generation > currentGeneration else {
            throw LiveRuntimeFailure.generationMismatch
        }
        if let current = streams[streamId] {
            await terminate(streamId: streamId, stream: current, reason: .cancelled)
        } else {
            reservations[streamId] = nil
        }
        try await open(streamId: streamId, source: source, generation: generation)
    }

    public func state(streamId: String) -> ParakeetLiveSessionState? {
        if let stream = streams[streamId] {
            ParakeetLiveSessionState(
                source: stream.source, generation: stream.generation,
                nextSequence: stream.nextSequence, lifecycle: stream.lifecycle
            )
        } else if let opening = reservations[streamId] {
            ParakeetLiveSessionState(
                source: opening.source, generation: opening.generation,
                nextSequence: 1, lifecycle: opening.lifecycle
            )
        } else {
            nil
        }
    }

    public func shutdown() async {
        reservations.removeAll()
        let active = streams
        streams.removeAll()
        for (_, stream) in active {
            resumePending(stream, with: LiveRuntimeFailure.cancelled)
            await stream.manager.cancel()
        }
    }

    private func canReserve(streamId: String, source: LiveSource) -> Bool {
        guard streams[streamId] == nil, reservations[streamId] == nil else { return false }
        guard streams.count + reservations.count < maximumStreams else { return false }
        return !streams.values.contains { $0.source == source }
            && !reservations.values.contains { $0.source == source }
    }

    private func validateOpening(
        streamId: String, reservation: OpenReservation
    ) throws {
        do {
            try Task.checkCancellation()
        } catch {
            removeReservation(streamId: streamId, matching: reservation)
            throw LiveRuntimeFailure.cancelled
        }
        guard reservations[streamId] == reservation else {
            throw LiveRuntimeFailure.cancelled
        }
    }

    private func removeReservation(
        streamId: String, matching reservation: OpenReservation
    ) {
        if reservations[streamId] == reservation {
            reservations[streamId] = nil
        }
    }

    private func requireStream(
        streamId: String, source: LiveSource, generation: Int
    ) throws -> StreamState {
        guard let stream = streams[streamId] else { throw LiveRuntimeFailure.streamNotFound }
        guard stream.source == source else { throw LiveRuntimeFailure.sourceMismatch }
        guard stream.generation == generation else {
            throw LiveRuntimeFailure.generationMismatch
        }
        return stream
    }

    private func processNext(streamId: String, generation: Int) async {
        guard var stream = streams[streamId], stream.generation == generation else { return }
        guard stream.active == nil, !stream.queue.isEmpty else {
            resumeDrainWaitersIfNeeded(stream: &stream)
            streams[streamId] = stream
            return
        }
        let pending = stream.queue.removeFirst()
        stream.active = pending
        streams[streamId] = stream
        let outcome: LiveDriverAppendOutcome
        do { outcome = try await stream.manager.append(audioURL: pending.audioURL) } catch {
            await failActiveAppend(
                streamId: streamId, generation: generation, pending: pending
            )
            return
        }
        guard var current = streams[streamId], current.generation == generation,
            current.active?.sequence == pending.sequence
        else { return }
        current.active = nil
        let events = applyUpdates(
            outcome.updates, partialWindowFailed: outcome.partialWindowFailed,
            affectedSequence: pending.sequence,
            chunkStartSeconds: pending.chunkStartSeconds,
            chunkEndSeconds: pending.chunkEndSeconds,
            streamId: streamId, stream: &current
        )
        pending.continuation.resume(
            returning: LiveAppendResult(
                events: events, wasDuplicate: false
            ))
        let hasMore = !current.queue.isEmpty
        resumeDrainWaitersIfNeeded(stream: &current)
        streams[streamId] = current
        if hasMore {
            Task { await self.processNext(streamId: streamId, generation: generation) }
        }
    }

    private func applyUpdates(
        _ updates: [LiveDriverUpdate], partialWindowFailed: Bool,
        affectedSequence: Int?, chunkStartSeconds: Double?,
        chunkEndSeconds: Double?, streamId: String, stream: inout StreamState
    ) -> [RuntimeEvent] {
        var events: [RuntimeEvent] = []
        for update in updates {
            guard let end = update.processedAudioEndSeconds, end.isFinite, end >= 0,
                update.confidence.isFinite, (0...1).contains(update.confidence)
            else {
                events.append(
                    makeDegradation(
                        reason: .coverageGap, affectedSequence: affectedSequence,
                        chunkStartSeconds: chunkStartSeconds,
                        chunkEndSeconds: chunkEndSeconds,
                        streamId: streamId, stream: &stream
                    ))
                continue
            }
            stream.revision += 1
            events.append(
                .streamUpdate(
                    LiveStreamUpdate(
                        streamId: streamId, source: stream.source,
                        generation: stream.generation, revision: stream.revision,
                        qualifiesPriorTentative: update.isConfirmed, text: update.text,
                        confidence: update.confidence, audioEndSeconds: end
                    )))
        }
        if partialWindowFailed {
            events.append(
                makeDegradation(
                    reason: .partialWindow, affectedSequence: affectedSequence,
                    chunkStartSeconds: chunkStartSeconds, chunkEndSeconds: chunkEndSeconds,
                    streamId: streamId, stream: &stream
                ))
        }
        return events
    }

    private func makeDegradation(
        reason: LiveDegradationReason, affectedSequence: Int?,
        chunkStartSeconds: Double?, chunkEndSeconds: Double?,
        streamId: String, stream: inout StreamState
    ) -> RuntimeEvent {
        stream.revision += 1
        let degraded = LiveStreamDegraded(
            streamId: streamId, source: stream.source,
            generation: stream.generation, revision: stream.revision,
            reason: reason, affectedSequence: affectedSequence,
            chunkStartSeconds: chunkStartSeconds, chunkEndSeconds: chunkEndSeconds
        )
        stream.degradations.append(degraded)
        return .streamDegraded(degraded)
    }

    private func waitUntilDrained(streamId: String, generation: Int) async throws {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            guard var stream = streams[streamId], stream.generation == generation else {
                continuation.resume(throwing: LiveRuntimeFailure.cancelled)
                return
            }
            if stream.active == nil, stream.queue.isEmpty {
                continuation.resume()
            } else {
                stream.drainWaiters.append(continuation)
                streams[streamId] = stream
            }
        }
    }

    private func resumeDrainWaitersIfNeeded(stream: inout StreamState) {
        guard stream.active == nil, stream.queue.isEmpty else { return }
        let waiters = stream.drainWaiters
        stream.drainWaiters.removeAll()
        for waiter in waiters { waiter.resume() }
    }

    private func failActiveAppend(
        streamId: String, generation: Int, pending: PendingAppend
    ) async {
        guard var stream = streams[streamId], stream.generation == generation,
            stream.active?.sequence == pending.sequence
        else { return }
        stream.lifecycle = .failed
        stream.revision += 1
        let event = RuntimeEvent.streamFailed(
            LiveStreamFailed(
                streamId: streamId, source: stream.source, generation: generation,
                revision: stream.revision, reason: .inferenceFailed
            ))
        streams[streamId] = nil
        pending.continuation.resume(
            throwing: LiveRuntimeTerminalFailure(
                failure: .inferenceFailed, event: event
            ))
        for queued in stream.queue {
            queued.continuation.resume(throwing: LiveRuntimeFailure.inferenceFailed)
        }
        for waiter in stream.drainWaiters {
            waiter.resume(throwing: LiveRuntimeFailure.inferenceFailed)
        }
        await stream.manager.cancel()
    }

    private func failFinish(
        streamId: String, generation: Int
    ) async -> any Error {
        guard var stream = streams[streamId], stream.generation == generation else {
            return LiveRuntimeFailure.cancelled
        }
        stream.lifecycle = .failed
        stream.revision += 1
        let event = RuntimeEvent.streamFailed(
            LiveStreamFailed(
                streamId: streamId, source: stream.source, generation: generation,
                revision: stream.revision, reason: .inferenceFailed
            ))
        streams[streamId] = nil
        await stream.manager.cancel()
        return LiveRuntimeTerminalFailure(failure: .inferenceFailed, event: event)
    }

    private func terminate(
        streamId: String, stream: StreamState, reason: LiveRuntimeFailure
    ) async {
        var terminal = stream
        terminal.lifecycle = .cancelled
        streams[streamId] = nil
        resumePending(terminal, with: reason)
        await terminal.manager.cancel()
    }

    private func resumePending(_ stream: StreamState, with failure: LiveRuntimeFailure) {
        stream.active?.continuation.resume(throwing: failure)
        for pending in stream.queue { pending.continuation.resume(throwing: failure) }
        for waiter in stream.drainWaiters { waiter.resume(throwing: failure) }
    }

    private func checksum(of url: URL) throws -> String {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
