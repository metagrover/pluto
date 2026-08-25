import Foundation

public enum ModelPreparationPhase: String, Codable, Equatable, Sendable {
    case sizing
    case downloading
    case loading
    case verifying
}

public struct ModelPreparationProgress: Equatable, Sendable {
    public let phase: ModelPreparationPhase
    public let downloadedBytes: Int64
    public let totalBytes: Int64

    public init(
        phase: ModelPreparationPhase,
        downloadedBytes: Int64,
        totalBytes: Int64
    ) {
        let safeTotal = max(0, totalBytes)
        self.phase = phase
        self.downloadedBytes = min(max(0, downloadedBytes), safeTotal)
        self.totalBytes = safeTotal
    }
}

public typealias ModelPreparationProgressHandler = @Sendable (ModelPreparationProgress) -> Void

public struct RuntimePreparationProgressEvent: Encodable, Equatable, Sendable {
    public let schemaVersion = 1
    public let kind = "event"
    public let event = "prepare_progress"
    public let requestId: String
    public let phase: ModelPreparationPhase
    public let downloadedBytes: Int64
    public let totalBytes: Int64

    public init(requestId: String, progress: ModelPreparationProgress) {
        self.requestId = requestId
        self.phase = progress.phase
        self.downloadedBytes = progress.downloadedBytes
        self.totalBytes = progress.totalBytes
    }
}
