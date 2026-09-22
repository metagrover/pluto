import Foundation
import ParakeetRuntimeCore

public enum ParakeetEouSnapshotKind: Equatable, Sendable {
    case partial
    case eou
    case final
}

public struct ParakeetEouManagerToken: Equatable, Sendable {
    public let text: String
    public let startSeconds: Double
    public let endSeconds: Double

    public init(text: String, startSeconds: Double, endSeconds: Double) {
        self.text = text
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
    }
}

public struct ParakeetEouManagerSnapshot: Equatable, Sendable {
    public let kind: ParakeetEouSnapshotKind
    public let transcript: String
    public let tokens: [ParakeetEouManagerToken]

    public static func partial(
        _ transcript: String,
        tokens: [ParakeetEouManagerToken] = []
    ) -> Self {
        Self(kind: .partial, transcript: transcript, tokens: tokens)
    }

    public static func eou(
        _ transcript: String,
        tokens: [ParakeetEouManagerToken] = []
    ) -> Self {
        Self(kind: .eou, transcript: transcript, tokens: tokens)
    }

    public static func final(
        _ transcript: String,
        tokens: [ParakeetEouManagerToken] = []
    ) -> Self {
        Self(kind: .final, transcript: transcript, tokens: tokens)
    }
}

public protocol ParakeetEouManaging: Sendable {
    func append(_ frame: EouPcmFrame) async throws -> [ParakeetEouManagerSnapshot]
    func finish() async throws -> [ParakeetEouManagerSnapshot]
    func cancel() async
}

public struct ParakeetEouManagerRequest: Sendable {
    public let activeModelURL: URL
    public let streamId: String
    public let source: LiveSource
    public let generation: Int

    public init(activeModelURL: URL, streamId: String, source: LiveSource, generation: Int) {
        self.activeModelURL = activeModelURL
        self.streamId = streamId
        self.source = source
        self.generation = generation
    }
}

public protocol ParakeetEouDriving: Sendable {
    func makeManager(request: ParakeetEouManagerRequest) async throws
        -> any ParakeetEouManaging
}

enum EouSessionFailure: Error, Equatable, Sendable {
    case streamCapacity
    case streamNotFound
    case generationMismatch
    case sourceMismatch
    case sequenceOutOfOrder
    case audioDiscontinuity
    case modelUnavailable
    case inferenceFailed
    case prefixMutated
    case cancelled
}

struct EouSessionTerminalFailure: Error, Equatable, Sendable {
    let failure: EouSessionFailure
    let event: RuntimeEvent
}

actor ParakeetEouSession {
    private struct State {
        let streamId: String
        let source: LiveSource
        let generation: Int
        let manager: any ParakeetEouManaging
        var nextSequence = 1
        var nextRevision = 1
        var audioEndSeconds = 0.0
        var committed = ""
        var tentative = ""
        var committedTokenCount = 0
        var inFlight = false
    }

    private let driver: any ParakeetEouDriving
    private let activeModelURL: URL
    private var states: [LiveSource: State] = [:]

    init(driver: any ParakeetEouDriving, activeModelURL: URL) {
        self.driver = driver
        self.activeModelURL = activeModelURL.standardizedFileURL
    }

    func open(streamId: String, source: LiveSource, generation: Int) async throws {
        guard
            !states.keys.contains(source),
            !states.values.contains(where: { $0.streamId == streamId }),
            states.count < 2
        else { throw EouSessionFailure.streamCapacity }

        let manager: any ParakeetEouManaging
        do {
            manager = try await driver.makeManager(request: ParakeetEouManagerRequest(
                activeModelURL: activeModelURL,
                streamId: streamId,
                source: source,
                generation: generation
            ))
        } catch let failure as EouSessionFailure {
            throw failure
        } catch {
            throw EouSessionFailure.modelUnavailable
        }
        states[source] = State(
            streamId: streamId,
            source: source,
            generation: generation,
            manager: manager
        )
    }

    func append(
        streamId: String,
        source: LiveSource,
        generation: Int,
        sequence: Int,
        frame: EouPcmFrame
    ) async throws -> [RuntimeEvent] {
        var state = try requireState(
            streamId: streamId,
            source: source,
            generation: generation
        )
        guard !state.inFlight, sequence == state.nextSequence else {
            throw EouSessionFailure.sequenceOutOfOrder
        }
        let tolerance = 0.5 / Double(frame.sampleRate)
        guard abs(frame.audioStartSeconds - state.audioEndSeconds) <= tolerance else {
            throw EouSessionFailure.audioDiscontinuity
        }

        state.inFlight = true
        states[source] = state
        let snapshots: [ParakeetEouManagerSnapshot]
        do {
            snapshots = try await state.manager.append(frame)
        } catch is CancellationError {
            states[source] = nil
            await state.manager.cancel()
            throw terminalFailure(.cancelled, state: state)
        } catch {
            states[source] = nil
            await state.manager.cancel()
            throw terminalFailure(.inferenceFailed, state: state)
        }

        guard var current = states[source], current.streamId == streamId,
            current.generation == generation
        else { throw EouSessionFailure.cancelled }
        current.inFlight = false
        current.nextSequence += 1
        current.audioEndSeconds = frame.audioEndSeconds
        do {
            let events = try apply(snapshots, to: &current)
            states[source] = current
            return events
        } catch let failure as EouSessionFailure {
            states[source] = nil
            await current.manager.cancel()
            throw terminalFailure(failure, state: current)
        }
    }

    func finish(
        streamId: String,
        source: LiveSource,
        generation: Int
    ) async throws -> [RuntimeEvent] {
        var state = try requireState(
            streamId: streamId,
            source: source,
            generation: generation
        )
        guard !state.inFlight else { throw EouSessionFailure.sequenceOutOfOrder }
        let snapshots: [ParakeetEouManagerSnapshot]
        do {
            snapshots = try await state.manager.finish()
        } catch {
            states[source] = nil
            await state.manager.cancel()
            throw EouSessionFailure.inferenceFailed
        }
        states[source] = nil
        return try apply(snapshots, to: &state)
    }

    func cancel(streamId: String, source: LiveSource, generation: Int) async throws {
        let state = try requireState(
            streamId: streamId,
            source: source,
            generation: generation
        )
        states[source] = nil
        await state.manager.cancel()
    }

    func reset(streamId: String, source: LiveSource, generation: Int) async throws {
        guard let old = states[source] else { throw EouSessionFailure.streamNotFound }
        guard old.streamId == streamId else { throw EouSessionFailure.streamNotFound }
        guard generation == old.generation + 1 else {
            throw EouSessionFailure.generationMismatch
        }
        states[source] = nil
        await old.manager.cancel()
        try await open(streamId: streamId, source: source, generation: generation)
    }

    func shutdown() async {
        let active = Array(states.values)
        states.removeAll()
        for state in active {
            await state.manager.cancel()
        }
    }

    private func requireState(
        streamId: String,
        source: LiveSource,
        generation: Int
    ) throws -> State {
        guard let state = states[source] else { throw EouSessionFailure.streamNotFound }
        guard state.streamId == streamId else { throw EouSessionFailure.streamNotFound }
        guard state.source == source else { throw EouSessionFailure.sourceMismatch }
        guard state.generation == generation else { throw EouSessionFailure.generationMismatch }
        return state
    }

    private func apply(
        _ snapshots: [ParakeetEouManagerSnapshot],
        to state: inout State
    ) throws -> [RuntimeEvent] {
        try snapshots.map { snapshot in
            let transcript = normalize(snapshot.transcript)
            let tentative: String
            if state.committed.isEmpty {
                tentative = transcript
            } else if transcript == state.committed {
                tentative = ""
            } else if transcript.hasPrefix(state.committed + " ") {
                tentative = String(transcript.dropFirst(state.committed.count + 1))
            } else {
                throw EouSessionFailure.prefixMutated
            }

            switch snapshot.kind {
            case .partial:
                state.tentative = tentative
            case .eou, .final:
                state.committed = transcript
                state.tentative = ""
                state.committedTokenCount = snapshot.tokens.count
            }

            let boundedTokens = snapshot.tokens.enumerated().compactMap { index, token
                -> EouToken? in
                guard token.startSeconds <= state.audioEndSeconds else { return nil }
                return EouToken(
                    text: token.text,
                    startSeconds: token.startSeconds,
                    endSeconds: min(token.endSeconds, state.audioEndSeconds),
                    committed: index < state.committedTokenCount
                )
            }
            let update = EouUpdate(
                streamId: state.streamId,
                source: state.source,
                generation: state.generation,
                revision: state.nextRevision,
                processedAudioSeconds: state.audioEndSeconds,
                committedText: state.committed,
                tentativeText: state.tentative,
                tokens: boundedTokens
            )
            state.nextRevision += 1
            return .eouUpdate(update)
        }
    }

    private func normalize(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private func terminalFailure(
        _ failure: EouSessionFailure,
        state: State
    ) -> EouSessionTerminalFailure {
        EouSessionTerminalFailure(
            failure: failure,
            event: .eouFailed(EouStreamFailed(
                streamId: state.streamId,
                source: state.source,
                generation: state.generation,
                revision: state.nextRevision,
                reason: failureReason(failure)
            ))
        )
    }

    private func failureReason(_ failure: EouSessionFailure) -> EouFailureReason {
        switch failure {
        case .streamCapacity, .sequenceOutOfOrder, .audioDiscontinuity:
            return .sequenceOutOfOrder
        case .streamNotFound:
            return .streamNotFound
        case .generationMismatch:
            return .generationMismatch
        case .sourceMismatch:
            return .sourceMismatch
        case .modelUnavailable:
            return .modelUnavailable
        case .inferenceFailed:
            return .inferenceFailed
        case .prefixMutated:
            return .prefixMutated
        case .cancelled:
            return .cancelled
        }
    }
}
