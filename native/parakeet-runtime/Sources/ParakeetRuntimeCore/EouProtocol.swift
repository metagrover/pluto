import Foundation

public struct EouRequestMetadata: Equatable, Sendable {
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let sequence: Int?
    public let frame: EouPcmFrame?

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        sequence: Int? = nil,
        frame: EouPcmFrame? = nil
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.sequence = sequence
        self.frame = frame
    }
}

public struct EouPcmFrame: Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    public static let maximumDurationSeconds = 2
    public static let minimumSampleRate = 8_000
    public static let maximumSampleRate = 192_000

    public let sampleRate: Int
    public let channelCount: Int
    public let frameCount: Int
    public let audioStartSeconds: Double
    public let audioEndSeconds: Double
    public let pcmData: Data

    public init(
        sampleRate: Int,
        channelCount: Int,
        frameCount: Int,
        audioStartSeconds: Double,
        audioEndSeconds: Double,
        pcmData: Data
    ) throws {
        guard
            (Self.minimumSampleRate...Self.maximumSampleRate).contains(sampleRate),
            channelCount == 1,
            frameCount > 0,
            frameCount <= sampleRate * Self.maximumDurationSeconds,
            pcmData.count == frameCount * MemoryLayout<Float>.size,
            audioStartSeconds.isFinite,
            audioEndSeconds.isFinite,
            audioStartSeconds >= 0,
            audioEndSeconds > audioStartSeconds
        else { throw EouProtocolFailure.invalidFrame }

        let declaredDuration = audioEndSeconds - audioStartSeconds
        let sampleDuration = Double(frameCount) / Double(sampleRate)
        guard abs(declaredDuration - sampleDuration) <= (0.5 / Double(sampleRate)) else {
            throw EouProtocolFailure.invalidFrame
        }

        let decoded = Self.decodeSamples(pcmData)
        guard decoded.allSatisfy(\.isFinite) else {
            throw EouProtocolFailure.invalidFrame
        }

        self.sampleRate = sampleRate
        self.channelCount = channelCount
        self.frameCount = frameCount
        self.audioStartSeconds = audioStartSeconds
        self.audioEndSeconds = audioEndSeconds
        self.pcmData = pcmData
    }

    public var samples: [Float] { Self.decodeSamples(pcmData) }

    public var description: String {
        "EouPcmFrame(sampleRate: \(sampleRate), channelCount: \(channelCount), frameCount: \(frameCount), audioStartSeconds: \(audioStartSeconds), audioEndSeconds: \(audioEndSeconds), pcm: <redacted>)"
    }

    public var debugDescription: String { description }

    private static func decodeSamples(_ data: Data) -> [Float] {
        data.withUnsafeBytes { bytes in
            stride(from: 0, to: data.count, by: MemoryLayout<Float>.size).map { offset in
                let raw = bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self)
                return Float(bitPattern: UInt32(littleEndian: raw))
            }
        }
    }
}

public enum EouProtocolFailure: Error, Equatable, Sendable {
    case invalidFrame
}

public struct EouToken: Codable, Equatable, Sendable {
    public let text: String
    public let startSeconds: Double
    public let endSeconds: Double
    public let committed: Bool

    public init(text: String, startSeconds: Double, endSeconds: Double, committed: Bool) {
        self.text = text
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
        self.committed = committed
    }

    private enum CodingKeys: String, CodingKey {
        case text
        case startSeconds
        case endSeconds
        case committed
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decode(String.self, forKey: .text)
        startSeconds = try container.decode(Double.self, forKey: .startSeconds)
        endSeconds = try container.decode(Double.self, forKey: .endSeconds)
        committed = try container.decode(Bool.self, forKey: .committed)
        try validate()
    }

    public func encode(to encoder: Encoder) throws {
        try validate()
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(text, forKey: .text)
        try container.encode(startSeconds, forKey: .startSeconds)
        try container.encode(endSeconds, forKey: .endSeconds)
        try container.encode(committed, forKey: .committed)
    }

    func validate() throws {
        guard
            !text.isEmpty,
            text.utf8.count <= 4_096,
            startSeconds.isFinite,
            endSeconds.isFinite,
            startSeconds >= 0,
            endSeconds >= startSeconds
        else { throw protocolDecodingError(CodingKeys.startSeconds, "invalid EOU token") }
    }
}

public struct EouUpdate: Codable, Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let revision: Int
    public let processedAudioSeconds: Double
    public let committedText: String
    public let tentativeText: String
    public let tokens: [EouToken]

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        revision: Int,
        processedAudioSeconds: Double,
        committedText: String,
        tentativeText: String,
        tokens: [EouToken]
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.revision = revision
        self.processedAudioSeconds = processedAudioSeconds
        self.committedText = committedText
        self.tentativeText = tentativeText
        self.tokens = tokens
    }

    public var description: String {
        "EouUpdate(streamId: <redacted>, source: \(source.rawValue), generation: \(generation), revision: \(revision), processedAudioSeconds: \(processedAudioSeconds), text: <redacted>, tokenCount: \(tokens.count))"
    }

    public var debugDescription: String { description }

    private enum CodingKeys: String, CodingKey {
        case streamId
        case source
        case generation
        case revision
        case processedAudioSeconds
        case committedText
        case tentativeText
        case tokens
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        streamId = try container.decode(String.self, forKey: .streamId)
        source = try container.decode(LiveSource.self, forKey: .source)
        generation = try container.decode(Int.self, forKey: .generation)
        revision = try container.decode(Int.self, forKey: .revision)
        processedAudioSeconds = try container.decode(Double.self, forKey: .processedAudioSeconds)
        committedText = try container.decode(String.self, forKey: .committedText)
        tentativeText = try container.decode(String.self, forKey: .tentativeText)
        tokens = try container.decode([EouToken].self, forKey: .tokens)
        try validate()
    }

    public func encode(to encoder: Encoder) throws {
        try validate()
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(streamId, forKey: .streamId)
        try container.encode(source, forKey: .source)
        try container.encode(generation, forKey: .generation)
        try container.encode(revision, forKey: .revision)
        try container.encode(processedAudioSeconds, forKey: .processedAudioSeconds)
        try container.encode(committedText, forKey: .committedText)
        try container.encode(tentativeText, forKey: .tentativeText)
        try container.encode(tokens, forKey: .tokens)
    }

    func validate() throws {
        guard
            isValidOpaqueStreamId(streamId),
            isPositiveSafeInteger(generation),
            isPositiveSafeInteger(revision),
            processedAudioSeconds.isFinite,
            processedAudioSeconds >= 0,
            committedText.utf8.count <= 1_048_576,
            tentativeText.utf8.count <= 1_048_576,
            tokens.count <= 100_000,
            tokens.allSatisfy({ $0.endSeconds <= processedAudioSeconds })
        else { throw protocolDecodingError(CodingKeys.revision, "invalid EOU update") }
    }
}

public enum EouFailureReason: String, Codable, Equatable, Sendable {
    case invalidRequest = "invalid_request"
    case streamNotFound = "stream_not_found"
    case generationMismatch = "generation_mismatch"
    case sourceMismatch = "source_mismatch"
    case sequenceOutOfOrder = "sequence_out_of_order"
    case backpressure
    case audioDecodeFailed = "audio_decode_failed"
    case modelUnavailable = "model_unavailable"
    case inferenceFailed = "inference_failed"
    case prefixMutated = "prefix_mutated"
    case cancelled
}

public struct EouStreamFailed: Codable, Equatable, Sendable, CustomStringConvertible,
    CustomDebugStringConvertible
{
    public let streamId: String
    public let source: LiveSource
    public let generation: Int
    public let revision: Int
    public let reason: EouFailureReason

    public init(
        streamId: String,
        source: LiveSource,
        generation: Int,
        revision: Int,
        reason: EouFailureReason
    ) {
        self.streamId = streamId
        self.source = source
        self.generation = generation
        self.revision = revision
        self.reason = reason
    }

    public var description: String {
        "EouStreamFailed(streamId: <redacted>, source: \(source.rawValue), generation: \(generation), revision: \(revision), reason: \(reason.rawValue))"
    }

    public var debugDescription: String { description }
}
