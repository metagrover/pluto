import Foundation

public enum RuntimeMethod: String, Codable, Sendable {
    case prepare
    case transcribe
    case cancel
    case shutdown
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

    public init(
        schemaVersion: Int = 1,
        id: String,
        method: RuntimeMethod,
        modelRoot: String? = nil,
        audioPath: String? = nil,
        language: String? = nil,
        vocabulary: [String]? = nil,
        targetId: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.method = method
        self.modelRoot = modelRoot
        self.audioPath = audioPath
        self.language = language
        self.vocabulary = vocabulary
        self.targetId = targetId
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
