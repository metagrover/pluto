import Foundation

public enum RuntimeMethod: String, Codable, Sendable {
    case prepare
    case transcribe
    case cancel
    case shutdown
    case streamOpen = "stream_open"
    case streamAppend = "stream_append"
    case streamFlush = "stream_flush"
    case streamCancel = "stream_cancel"
    case streamReset = "stream_reset"
}

public struct RuntimeRequest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let id: String
    public let method: RuntimeMethod
    public let modelRoot: String?
    public let audioPath: String?
    public let language: String?
    public let vocabulary: [String]?
    public let targetId: String?
    public let live: LiveRequestMetadata?

    public init(
        schemaVersion: Int = 1,
        id: String,
        method: RuntimeMethod,
        modelRoot: String? = nil,
        audioPath: String? = nil,
        language: String? = nil,
        vocabulary: [String]? = nil,
        targetId: String? = nil,
        live: LiveRequestMetadata? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.method = method
        self.modelRoot = modelRoot
        self.audioPath = audioPath
        self.language = language
        self.vocabulary = vocabulary
        self.targetId = targetId
        self.live = live
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion
        case id
        case method
        case modelRoot
        case audioPath
        case language
        case vocabulary
        case targetId
        case streamId
        case source
        case generation
        case sequence
        case chunkStartSeconds
        case chunkEndSeconds
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        id = try container.decode(String.self, forKey: .id)
        method = try container.decode(RuntimeMethod.self, forKey: .method)
        let presentKeys = Set(CodingKeys.allCases.filter { container.contains($0) })
        if let incompatible = Self.incompatibleKnownKey(in: presentKeys, method: method) {
            throw protocolDecodingError(incompatible, "method-incompatible request field")
        }
        modelRoot = try container.decodeIfPresent(String.self, forKey: .modelRoot)
        audioPath = try container.decodeIfPresent(String.self, forKey: .audioPath)
        language = try container.decodeIfPresent(String.self, forKey: .language)
        vocabulary = try container.decodeIfPresent([String].self, forKey: .vocabulary)
        targetId = try container.decodeIfPresent(String.self, forKey: .targetId)

        switch method {
        case .prepare, .transcribe, .cancel, .shutdown:
            live = nil
        case .streamOpen, .streamAppend, .streamFlush, .streamCancel, .streamReset:
            guard schemaVersion == 1 else {
                throw protocolDecodingError(CodingKeys.schemaVersion, "unsupported schema version")
            }
            let streamId = try container.decode(String.self, forKey: .streamId)
            let source = try container.decode(LiveSource.self, forKey: .source)
            let generation = try container.decode(Int.self, forKey: .generation)
            guard isValidOpaqueStreamId(streamId) else {
                throw protocolDecodingError(CodingKeys.streamId, "invalid stream identity")
            }
            guard isPositiveSafeInteger(generation) else {
                throw protocolDecodingError(CodingKeys.generation, "invalid generation")
            }

            let sequence = try container.decodeIfPresent(Int.self, forKey: .sequence)
            let chunkStartSeconds = try container.decodeIfPresent(
                Double.self,
                forKey: .chunkStartSeconds
            )
            let chunkEndSeconds = try container.decodeIfPresent(
                Double.self,
                forKey: .chunkEndSeconds
            )

            if method == .streamAppend {
                guard let sequence, isPositiveSafeInteger(sequence) else {
                    throw protocolDecodingError(CodingKeys.sequence, "invalid append sequence")
                }
                guard let audioPath,
                    !audioPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                else {
                    throw protocolDecodingError(CodingKeys.audioPath, "missing approved audio path")
                }
                guard let chunkStartSeconds, let chunkEndSeconds,
                    chunkStartSeconds.isFinite,
                    chunkEndSeconds.isFinite,
                    chunkStartSeconds >= 0,
                    chunkEndSeconds > chunkStartSeconds
                else {
                    throw protocolDecodingError(CodingKeys.chunkStartSeconds, "invalid chunk range")
                }
            } else if sequence != nil || chunkStartSeconds != nil || chunkEndSeconds != nil
                || audioPath != nil
            {
                throw protocolDecodingError(
                    CodingKeys.audioPath,
                    "append fields are not allowed for this method"
                )
            }

            live = LiveRequestMetadata(
                streamId: streamId,
                source: source,
                generation: generation,
                sequence: sequence,
                chunkStartSeconds: chunkStartSeconds,
                chunkEndSeconds: chunkEndSeconds
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        let presentKeys = encodedKnownKeys
        if let incompatible = Self.incompatibleKnownKey(in: presentKeys, method: method) {
            throw EncodingError.invalidValue(
                method,
                .init(
                    codingPath: [incompatible],
                    debugDescription: "method-incompatible request field")
            )
        }

        switch method {
        case .prepare, .transcribe, .cancel, .shutdown:
            break
        case .streamOpen, .streamAppend, .streamFlush, .streamCancel, .streamReset:
            guard schemaVersion == 1, let live else {
                throw EncodingError.invalidValue(
                    method,
                    .init(
                        codingPath: [], debugDescription: "live method requires schema v1 metadata")
                )
            }
            guard isValidOpaqueStreamId(live.streamId), isPositiveSafeInteger(live.generation)
            else {
                throw EncodingError.invalidValue(
                    live,
                    .init(codingPath: [], debugDescription: "invalid live identity")
                )
            }
            if method == .streamAppend {
                guard let sequence = live.sequence, isPositiveSafeInteger(sequence),
                    let audioPath,
                    !audioPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    let start = live.chunkStartSeconds,
                    let end = live.chunkEndSeconds,
                    start.isFinite,
                    end.isFinite,
                    start >= 0,
                    end > start
                else {
                    throw EncodingError.invalidValue(
                        live,
                        .init(codingPath: [], debugDescription: "invalid live append")
                    )
                }
            }
        }

        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(id, forKey: .id)
        try container.encode(method, forKey: .method)
        try container.encodeIfPresent(modelRoot, forKey: .modelRoot)
        try container.encodeIfPresent(audioPath, forKey: .audioPath)
        try container.encodeIfPresent(language, forKey: .language)
        try container.encodeIfPresent(vocabulary, forKey: .vocabulary)
        try container.encodeIfPresent(targetId, forKey: .targetId)
        if let live {
            try container.encode(live.streamId, forKey: .streamId)
            try container.encode(live.source, forKey: .source)
            try container.encode(live.generation, forKey: .generation)
            try container.encodeIfPresent(live.sequence, forKey: .sequence)
            try container.encodeIfPresent(live.chunkStartSeconds, forKey: .chunkStartSeconds)
            try container.encodeIfPresent(live.chunkEndSeconds, forKey: .chunkEndSeconds)
        }
    }

    private var encodedKnownKeys: Set<CodingKeys> {
        var keys: Set<CodingKeys> = [.schemaVersion, .id, .method]
        if modelRoot != nil { keys.insert(.modelRoot) }
        if audioPath != nil { keys.insert(.audioPath) }
        if language != nil { keys.insert(.language) }
        if vocabulary != nil { keys.insert(.vocabulary) }
        if targetId != nil { keys.insert(.targetId) }
        if let live {
            keys.formUnion([.streamId, .source, .generation])
            if live.sequence != nil { keys.insert(.sequence) }
            if live.chunkStartSeconds != nil { keys.insert(.chunkStartSeconds) }
            if live.chunkEndSeconds != nil { keys.insert(.chunkEndSeconds) }
        }
        return keys
    }

    private static func incompatibleKnownKey(
        in presentKeys: Set<CodingKeys>,
        method: RuntimeMethod
    ) -> CodingKeys? {
        let allowed = allowedKeys(for: method)
        return CodingKeys.allCases.first {
            presentKeys.contains($0) && !allowed.contains($0)
        }
    }

    private static func allowedKeys(for method: RuntimeMethod) -> Set<CodingKeys> {
        let common: Set<CodingKeys> = [.schemaVersion, .id, .method]
        switch method {
        case .prepare:
            return common.union([.modelRoot])
        case .transcribe:
            return common.union([.audioPath, .language, .vocabulary])
        case .cancel:
            return common.union([.targetId])
        case .shutdown:
            return common
        case .streamOpen, .streamFlush, .streamCancel, .streamReset:
            return common.union([.streamId, .source, .generation])
        case .streamAppend:
            return common.union([
                .streamId,
                .source,
                .generation,
                .sequence,
                .audioPath,
                .chunkStartSeconds,
                .chunkEndSeconds,
            ])
        }
    }
}

public enum RuntimeFailure: String, Error, Codable, Equatable, Sendable, CustomStringConvertible {
    case invalidRequest = "parakeet_request_invalid"
    case pathNotAllowed = "parakeet_path_not_allowed"
    case pathMissing = "parakeet_path_missing"
    case modelPreparationFailed = "parakeet_model_preparation_failed"
    case transcriptionFailed = "parakeet_transcription_failed"
    case cancelled = "parakeet_cancelled"

    public var description: String { rawValue }
}

public struct RuntimeErrorPayload: Codable, Equatable, Sendable {
    public let code: RuntimeFailure
}

public struct RuntimeResponse: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let id: String
    public let ok: Bool
    public let result: RuntimeResultPayload?
    public let error: RuntimeErrorPayload?

    public init(
        schemaVersion: Int,
        id: String,
        ok: Bool,
        result: RuntimeResultPayload?,
        error: RuntimeErrorPayload?
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.ok = ok
        self.result = result
        self.error = error
    }

    public static func failure(id: String, code: RuntimeFailure) -> RuntimeResponse {
        RuntimeResponse(
            schemaVersion: 1,
            id: id,
            ok: false,
            result: nil,
            error: RuntimeErrorPayload(code: code)
        )
    }

    public static func prepared(id: String, modelVersion: String) -> RuntimeResponse {
        RuntimeResponse(
            schemaVersion: 1,
            id: id,
            ok: true,
            result: RuntimeResultPayload(modelVersion: modelVersion),
            error: nil
        )
    }

    public static func transcribed(
        id: String,
        output: TranscriptionOutput,
        vocabularyCount: Int
    ) -> RuntimeResponse {
        RuntimeResponse(
            schemaVersion: 1,
            id: id,
            ok: true,
            result: RuntimeResultPayload(
                transcription: output,
                vocabularyCount: vocabularyCount
            ),
            error: nil
        )
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case id
        case ok
        case result
        case error
        case kind
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if try container.decodeIfPresent(String.self, forKey: .kind) == "event" {
            throw protocolDecodingError(CodingKeys.kind, "event is not a response")
        }
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        id = try container.decode(String.self, forKey: .id)
        ok = try container.decode(Bool.self, forKey: .ok)
        result = try container.decodeIfPresent(RuntimeResultPayload.self, forKey: .result)
        error = try container.decodeIfPresent(RuntimeErrorPayload.self, forKey: .error)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(id, forKey: .id)
        try container.encode(ok, forKey: .ok)
        try container.encodeIfPresent(result, forKey: .result)
        try container.encodeIfPresent(error, forKey: .error)
    }
}

public struct RuntimeResultPayload: Codable, Equatable, Sendable {
    public let modelVersion: String?
    public let transcription: TranscriptionOutput?
    public let vocabularyCount: Int?

    public init(
        modelVersion: String? = nil,
        transcription: TranscriptionOutput? = nil,
        vocabularyCount: Int? = nil
    ) {
        self.modelVersion = modelVersion
        self.transcription = transcription
        self.vocabularyCount = vocabularyCount
    }
}
