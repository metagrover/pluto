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
    public let revision: Int
    public let qualifiesPriorTentative: Bool
    public let text: String
    public let confidence: Double
    public let audioEndSeconds: Double

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        revision: Int,
        qualifiesPriorTentative: Bool,
        text: String,
        confidence: Double,
        audioEndSeconds: Double
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.revision = revision
        self.qualifiesPriorTentative = qualifiesPriorTentative
        self.text = text
        self.confidence = confidence
        self.audioEndSeconds = audioEndSeconds
    }

    public var description: String {
        "LiveStreamUpdate(streamId: <redacted>, source: \(source.rawValue), generation: \(generation), revision: \(revision), qualifiesPriorTentative: \(qualifiesPriorTentative), confidence: \(confidence), audioEndSeconds: \(audioEndSeconds), text: <redacted>)"
    }

    public var debugDescription: String { description }
}

public struct LiveStreamDegraded: Codable, Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let revision: Int
    public let reason: LiveDegradationReason
    public let affectedSequence: Int?
    public let chunkStartSeconds: Double?
    public let chunkEndSeconds: Double?

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        revision: Int,
        reason: LiveDegradationReason,
        affectedSequence: Int? = nil,
        chunkStartSeconds: Double? = nil,
        chunkEndSeconds: Double? = nil
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.revision = revision
        self.reason = reason
        self.affectedSequence = affectedSequence
        self.chunkStartSeconds = chunkStartSeconds
        self.chunkEndSeconds = chunkEndSeconds
    }

    public var description: String {
        "LiveStreamDegraded(streamId: <redacted>, source: \(source.rawValue), generation: \(generation), revision: \(revision), reason: \(reason.rawValue))"
    }

    public var debugDescription: String { description }
}

public struct LiveStreamFailed: Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let revision: Int
    public let reason: LiveFailureReason

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        revision: Int,
        reason: LiveFailureReason
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.revision = revision
        self.reason = reason
    }

    public var description: String {
        "LiveStreamFailed(streamId: <redacted>, source: \(source.rawValue), generation: \(generation), revision: \(revision), reason: \(reason.rawValue))"
    }

    public var debugDescription: String { description }
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
                "RuntimeEvent.streamDegraded(streamId: <redacted>, source: \(degraded.source.rawValue), generation: \(degraded.generation), revision: \(degraded.revision), reason: \(degraded.reason.rawValue))"
        case .streamFailed(let failed):
            return
                "RuntimeEvent.streamFailed(streamId: <redacted>, source: \(failed.source.rawValue), generation: \(failed.generation), revision: \(failed.revision), reason: \(failed.reason.rawValue))"
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
        case revision
        case qualifiesPriorTentative
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
        let revision = try container.decode(Int.self, forKey: .revision)
        try validateLiveIdentity(
            streamId: streamId,
            generation: generation,
            sequence: revision,
            sequenceKey: CodingKeys.revision
        )

        switch name {
        case .streamUpdate:
            let update = LiveStreamUpdate(
                streamId: streamId,
                source: source,
                generation: generation,
                revision: revision,
                qualifiesPriorTentative: try container.decode(
                    Bool.self,
                    forKey: .qualifiesPriorTentative
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
                revision: revision,
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
                    revision: revision,
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
                update.qualifiesPriorTentative,
                forKey: .qualifiesPriorTentative
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
                sequence: failed.revision,
                sequenceKey: CodingKeys.revision
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
            revision: update.revision,
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
            revision: degraded.revision,
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
            revision: failed.revision,
            name: name,
            into: &container
        )
    }

    private func encodeIdentity(
        streamId: String,
        source: LiveSource,
        generation: Int,
        revision: Int,
        name: RuntimeEventName,
        into container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        try container.encode(name, forKey: .event)
        try container.encode(streamId, forKey: .streamId)
        try container.encode(source, forKey: .source)
        try container.encode(generation, forKey: .generation)
        try container.encode(revision, forKey: .revision)
    }
}

private func validate(_ update: LiveStreamUpdate) throws {
    try validateLiveIdentity(
        streamId: update.streamId,
        generation: update.generation,
        sequence: update.revision,
        sequenceKey: RuntimeEvent.CodingKeys.revision
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
        sequence: degraded.revision,
        sequenceKey: RuntimeEvent.CodingKeys.revision
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

func isValidOpaqueStreamId(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard !bytes.isEmpty, bytes.count <= 128 else { return false }

    func isASCIIAlphanumeric(_ byte: UInt8) -> Bool {
        (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
    }

    guard let first = bytes.first, let last = bytes.last,
        isASCIIAlphanumeric(first), isASCIIAlphanumeric(last)
    else {
        return false
    }

    let safeSeparators: Set<UInt8> = [45, 46, 58, 95]  // - . : _
    guard bytes.allSatisfy({ isASCIIAlphanumeric($0) || safeSeparators.contains($0) }) else {
        return false
    }
    return !value.contains("..")
}

func validateLiveIdentity<Key: CodingKey>(
    streamId: String,
    generation: Int,
    sequence: Int,
    sequenceKey: Key
) throws {
    guard isValidOpaqueStreamId(streamId) else {
        throw protocolDecodingError(sequenceKey, "invalid stream identity")
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
