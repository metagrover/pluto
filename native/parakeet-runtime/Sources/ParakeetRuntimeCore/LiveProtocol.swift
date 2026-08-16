import Foundation

let maximumJSONSafeInteger = 9_007_199_254_740_991

public enum LiveSource: String, Codable, Equatable, Sendable {
    case mic
    case system
}

public struct LiveRequestMetadata: Equatable, Sendable {
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let sequence: Int?
    public let chunkStartSeconds: Double?
    public let chunkEndSeconds: Double?

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        sequence: Int? = nil,
        chunkStartSeconds: Double? = nil,
        chunkEndSeconds: Double? = nil
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.sequence = sequence
        self.chunkStartSeconds = chunkStartSeconds
        self.chunkEndSeconds = chunkEndSeconds
    }
}

public enum RuntimeEnvelopeKind: String, Codable, Equatable, Sendable {
    case event
}

public enum RuntimeEventName: String, Codable, Equatable, Sendable {
    case streamUpdate = "stream_update"
    case streamDegraded = "stream_degraded"
    case streamFailed = "stream_failed"
}

public enum LiveDegradationReason: String, Codable, Equatable, Sendable {
    case backpressure
    case sequenceGap = "sequence_gap"
    case partialWindow = "partial_window"
    case coverageGap = "coverage_gap"
    case thermalPressure = "thermal_pressure"
}

public enum LiveFailureReason: String, Codable, Equatable, Sendable {
    case invalidRequest = "invalid_request"
    case streamNotFound = "stream_not_found"
    case generationMismatch = "generation_mismatch"
    case sequenceOutOfOrder = "sequence_out_of_order"
    case pathNotAllowed = "path_not_allowed"
    case audioDecodeFailed = "audio_decode_failed"
    case modelUnavailable = "model_unavailable"
    case inferenceFailed = "inference_failed"
    case cancelled
}

public struct LiveStreamUpdate: Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let eventSequence: Int
    public let priorTentativeQualified: Bool
    public let text: String
    public let confidence: Double
    public let audioEndSeconds: Double

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        eventSequence: Int,
        priorTentativeQualified: Bool,
        text: String,
        confidence: Double,
        audioEndSeconds: Double
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.eventSequence = eventSequence
        self.priorTentativeQualified = priorTentativeQualified
        self.text = text
        self.confidence = confidence
        self.audioEndSeconds = audioEndSeconds
    }

    public var description: String {
        "LiveStreamUpdate(streamId: \(streamId), source: \(source.rawValue), generation: \(generation), eventSequence: \(eventSequence), priorTentativeQualified: \(priorTentativeQualified), confidence: \(confidence), audioEndSeconds: \(audioEndSeconds), text: <redacted>)"
    }

    public var debugDescription: String { description }
}

public struct LiveStreamDegraded: Equatable, Sendable {
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let eventSequence: Int
    public let reason: LiveDegradationReason
    public let affectedSequence: Int?
    public let chunkStartSeconds: Double?
    public let chunkEndSeconds: Double?

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        eventSequence: Int,
        reason: LiveDegradationReason,
        affectedSequence: Int? = nil,
        chunkStartSeconds: Double? = nil,
        chunkEndSeconds: Double? = nil
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.eventSequence = eventSequence
        self.reason = reason
        self.affectedSequence = affectedSequence
        self.chunkStartSeconds = chunkStartSeconds
        self.chunkEndSeconds = chunkEndSeconds
    }
}

public struct LiveStreamFailed: Equatable, Sendable {
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let eventSequence: Int
    public let reason: LiveFailureReason

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        eventSequence: Int,
        reason: LiveFailureReason
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.eventSequence = eventSequence
        self.reason = reason
    }
}

public enum RuntimeEvent: Codable, Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    case streamUpdate(LiveStreamUpdate)
    case streamDegraded(LiveStreamDegraded)
    case streamFailed(LiveStreamFailed)

    public var kind: RuntimeEnvelopeKind { .event }

    public var description: String {
        switch self {
        case .streamUpdate(let update):
            return "RuntimeEvent.streamUpdate(\(update))"
        case .streamDegraded(let degraded):
            return
                "RuntimeEvent.streamDegraded(streamId: \(degraded.streamId), source: \(degraded.source.rawValue), generation: \(degraded.generation), eventSequence: \(degraded.eventSequence), reason: \(degraded.reason.rawValue))"
        case .streamFailed(let failed):
            return
                "RuntimeEvent.streamFailed(streamId: \(failed.streamId), source: \(failed.source.rawValue), generation: \(failed.generation), eventSequence: \(failed.eventSequence), reason: \(failed.reason.rawValue))"
        }
    }

    public var debugDescription: String { description }

    fileprivate enum CodingKeys: String, CodingKey {
        case schemaVersion
        case kind
        case event
        case streamId
        case source
        case generation
        case eventSequence
        case priorTentativeQualified
        case text
        case confidence
        case audioEndSeconds
        case reason
        case affectedSequence
        case chunkStartSeconds
        case chunkEndSeconds
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        guard schemaVersion == 1 else {
            throw protocolDecodingError(CodingKeys.schemaVersion, "unsupported schema version")
        }
        guard try container.decode(RuntimeEnvelopeKind.self, forKey: .kind) == .event else {
            throw protocolDecodingError(CodingKeys.kind, "not an event envelope")
        }

        let name = try container.decode(RuntimeEventName.self, forKey: .event)
        let streamId = try container.decode(String.self, forKey: .streamId)
        let source = try container.decode(LiveSource.self, forKey: .source)
        let generation = try container.decode(Int.self, forKey: .generation)
        let eventSequence = try container.decode(Int.self, forKey: .eventSequence)
        try validateLiveIdentity(
            streamId: streamId,
            generation: generation,
            sequence: eventSequence,
            sequenceKey: CodingKeys.eventSequence
        )

        switch name {
        case .streamUpdate:
            let update = LiveStreamUpdate(
                streamId: streamId,
                source: source,
                generation: generation,
                eventSequence: eventSequence,
                priorTentativeQualified: try container.decode(
                    Bool.self,
                    forKey: .priorTentativeQualified
                ),
                text: try container.decode(String.self, forKey: .text),
                confidence: try container.decode(Double.self, forKey: .confidence),
                audioEndSeconds: try container.decode(Double.self, forKey: .audioEndSeconds)
            )
            try validate(update)
            self = .streamUpdate(update)
        case .streamDegraded:
            let degraded = LiveStreamDegraded(
                streamId: streamId,
                source: source,
                generation: generation,
                eventSequence: eventSequence,
                reason: try container.decode(LiveDegradationReason.self, forKey: .reason),
                affectedSequence: try container.decodeIfPresent(
                    Int.self, forKey: .affectedSequence),
                chunkStartSeconds: try container.decodeIfPresent(
                    Double.self,
                    forKey: .chunkStartSeconds
                ),
                chunkEndSeconds: try container.decodeIfPresent(
                    Double.self, forKey: .chunkEndSeconds)
            )
            try validate(degraded)
            self = .streamDegraded(degraded)
        case .streamFailed:
            self = .streamFailed(
                LiveStreamFailed(
                    streamId: streamId,
                    source: source,
                    generation: generation,
                    eventSequence: eventSequence,
                    reason: try container.decode(LiveFailureReason.self, forKey: .reason)
                ))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(1, forKey: .schemaVersion)
        try container.encode(RuntimeEnvelopeKind.event, forKey: .kind)

        switch self {
        case .streamUpdate(let update):
            try validate(update)
            try encodeIdentity(update, name: .streamUpdate, into: &container)
            try container.encode(
                update.priorTentativeQualified,
                forKey: .priorTentativeQualified
            )
            try container.encode(update.text, forKey: .text)
            try container.encode(update.confidence, forKey: .confidence)
            try container.encode(update.audioEndSeconds, forKey: .audioEndSeconds)
        case .streamDegraded(let degraded):
            try validate(degraded)
            try encodeIdentity(degraded, name: .streamDegraded, into: &container)
            try container.encode(degraded.reason, forKey: .reason)
            try container.encodeIfPresent(degraded.affectedSequence, forKey: .affectedSequence)
            try container.encodeIfPresent(degraded.chunkStartSeconds, forKey: .chunkStartSeconds)
            try container.encodeIfPresent(degraded.chunkEndSeconds, forKey: .chunkEndSeconds)
        case .streamFailed(let failed):
            try validateLiveIdentity(
                streamId: failed.streamId,
                generation: failed.generation,
                sequence: failed.eventSequence,
                sequenceKey: CodingKeys.eventSequence
            )
            try encodeIdentity(failed, name: .streamFailed, into: &container)
            try container.encode(failed.reason, forKey: .reason)
        }
    }

    private func encodeIdentity(
        _ update: LiveStreamUpdate,
        name: RuntimeEventName,
        into container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        try encodeIdentity(
            streamId: update.streamId,
            source: update.source,
            generation: update.generation,
            eventSequence: update.eventSequence,
            name: name,
            into: &container
        )
    }

    private func encodeIdentity(
        _ degraded: LiveStreamDegraded,
        name: RuntimeEventName,
        into container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        try encodeIdentity(
            streamId: degraded.streamId,
            source: degraded.source,
            generation: degraded.generation,
            eventSequence: degraded.eventSequence,
            name: name,
            into: &container
        )
    }

    private func encodeIdentity(
        _ failed: LiveStreamFailed,
        name: RuntimeEventName,
        into container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        try encodeIdentity(
            streamId: failed.streamId,
            source: failed.source,
            generation: failed.generation,
            eventSequence: failed.eventSequence,
            name: name,
            into: &container
        )
    }

    private func encodeIdentity(
        streamId: String,
        source: LiveSource,
        generation: Int,
        eventSequence: Int,
        name: RuntimeEventName,
        into container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        try container.encode(name, forKey: .event)
        try container.encode(streamId, forKey: .streamId)
        try container.encode(source, forKey: .source)
        try container.encode(generation, forKey: .generation)
        try container.encode(eventSequence, forKey: .eventSequence)
    }
}

private func validate(_ update: LiveStreamUpdate) throws {
    try validateLiveIdentity(
        streamId: update.streamId,
        generation: update.generation,
        sequence: update.eventSequence,
        sequenceKey: RuntimeEvent.CodingKeys.eventSequence
    )
    guard update.confidence.isFinite, (0...1).contains(update.confidence) else {
        throw protocolDecodingError(RuntimeEvent.CodingKeys.confidence, "invalid confidence")
    }
    guard update.audioEndSeconds.isFinite, update.audioEndSeconds >= 0 else {
        throw protocolDecodingError(
            RuntimeEvent.CodingKeys.audioEndSeconds,
            "invalid audio boundary"
        )
    }
}

private func validate(_ degraded: LiveStreamDegraded) throws {
    try validateLiveIdentity(
        streamId: degraded.streamId,
        generation: degraded.generation,
        sequence: degraded.eventSequence,
        sequenceKey: RuntimeEvent.CodingKeys.eventSequence
    )
    if let affectedSequence = degraded.affectedSequence {
        guard isPositiveSafeInteger(affectedSequence) else {
            throw protocolDecodingError(
                RuntimeEvent.CodingKeys.affectedSequence,
                "invalid affected sequence"
            )
        }
    }
    try validateOptionalRange(
        start: degraded.chunkStartSeconds,
        end: degraded.chunkEndSeconds,
        startKey: RuntimeEvent.CodingKeys.chunkStartSeconds,
        endKey: RuntimeEvent.CodingKeys.chunkEndSeconds
    )
}

func isPositiveSafeInteger(_ value: Int) -> Bool {
    value > 0 && value <= maximumJSONSafeInteger
}

func validateLiveIdentity<Key: CodingKey>(
    streamId: String,
    generation: Int,
    sequence: Int,
    sequenceKey: Key
) throws {
    guard !streamId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw protocolDecodingError(sequenceKey, "missing stream identity")
    }
    guard isPositiveSafeInteger(generation) else {
        throw protocolDecodingError(sequenceKey, "invalid generation")
    }
    guard isPositiveSafeInteger(sequence) else {
        throw protocolDecodingError(sequenceKey, "invalid sequence")
    }
}

func validateOptionalRange<Key: CodingKey>(
    start: Double?,
    end: Double?,
    startKey: Key,
    endKey: Key
) throws {
    guard (start == nil) == (end == nil) else {
        throw protocolDecodingError(start == nil ? startKey : endKey, "incomplete range")
    }
    guard let start, let end else { return }
    guard start.isFinite, end.isFinite, start >= 0, end > start else {
        throw protocolDecodingError(startKey, "invalid range")
    }
}

func protocolDecodingError<Key: CodingKey>(_ key: Key, _ description: String) -> DecodingError {
    .dataCorrupted(.init(codingPath: [key], debugDescription: description))
}
