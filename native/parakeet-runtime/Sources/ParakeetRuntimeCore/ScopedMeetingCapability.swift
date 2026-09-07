import Foundation

public struct ScopedMeetingCapability: Codable, Equatable, Sendable {
    public let version: Int
    public let meetingId: String
    public let keyId: String
    public let meetingKeyBase64: String
    public let generation: String?
    public let allowedOperations: [String]?
    public let expiresAtMs: Int64?

    public init(
        version: Int = 1,
        meetingId: String,
        keyId: String,
        meetingKeyBase64: String,
        generation: String? = nil,
        allowedOperations: [String]? = nil,
        expiresAtMs: Int64? = nil
    ) {
        self.version = version
        self.meetingId = meetingId
        self.keyId = keyId
        self.meetingKeyBase64 = meetingKeyBase64
        self.generation = generation
        self.allowedOperations = allowedOperations
        self.expiresAtMs = expiresAtMs
    }
}
