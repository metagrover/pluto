import Foundation

public struct ModelManifest: Codable, Equatable, Sendable {
    public let identifier: String
    public let version: String
    public let repository: String
    public let repositoryRevision: String
    public let auxiliaryRepository: String
    public let auxiliaryRepositoryRevision: String
    public let recognitionArtifactSHA256: String
    public let vocabularyArtifactSHA256: String
    public let encoderPrecision: String

    public init(
        identifier: String,
        version: String,
        repository: String,
        repositoryRevision: String = "",
        auxiliaryRepository: String = "",
        auxiliaryRepositoryRevision: String = "",
        recognitionArtifactSHA256: String = "",
        vocabularyArtifactSHA256: String = "",
        encoderPrecision: String
    ) {
        self.identifier = identifier
        self.version = version
        self.repository = repository
        self.repositoryRevision = repositoryRevision
        self.auxiliaryRepository = auxiliaryRepository
        self.auxiliaryRepositoryRevision = auxiliaryRepositoryRevision
        self.recognitionArtifactSHA256 = recognitionArtifactSHA256
        self.vocabularyArtifactSHA256 = vocabularyArtifactSHA256
        self.encoderPrecision = encoderPrecision
    }
}
