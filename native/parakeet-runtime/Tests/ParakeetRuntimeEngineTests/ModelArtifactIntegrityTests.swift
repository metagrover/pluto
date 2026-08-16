import Foundation
import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

final class ModelArtifactIntegrityTests: XCTestCase {
    func testDigestIsStableAndVerificationRejectsMutation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("second".utf8).write(to: root.appendingPathComponent("b.bin"))
        try Data("first".utf8).write(to: root.appendingPathComponent("a.bin"))

        let digest = try ModelArtifactIntegrity.digest(directory: root)
        XCTAssertNoThrow(try ModelArtifactIntegrity.verify(directory: root, expectedSHA256: digest))

        try Data("changed".utf8).write(to: root.appendingPathComponent("a.bin"))
        XCTAssertThrowsError(
            try ModelArtifactIntegrity.verify(directory: root, expectedSHA256: digest)
        )
    }
}
