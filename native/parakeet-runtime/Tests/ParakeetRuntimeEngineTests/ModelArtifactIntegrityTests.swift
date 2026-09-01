import Foundation
import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

final class ModelArtifactIntegrityTests: XCTestCase {
    func testDigestIsPathIndependentAndVerificationRejectsMutation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let canonicalRoot = root.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: canonicalRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("second".utf8).write(to: canonicalRoot.appendingPathComponent("b.bin"))
        try Data("first".utf8).write(to: canonicalRoot.appendingPathComponent("a.bin"))

        let digest = try ModelArtifactIntegrity.digest(directory: root)
        XCTAssertEqual(
            digest,
            "e444c38d1f247eae43388ac1aef800fabd3b88c4d884cbf7a1118c34a6e10e96"
        )
        XCTAssertEqual(
            digest,
            try ModelArtifactIntegrity.digest(directory: canonicalRoot)
        )
        XCTAssertNoThrow(try ModelArtifactIntegrity.verify(directory: root, expectedSHA256: digest))

        try Data("changed".utf8).write(to: root.appendingPathComponent("a.bin"))
        XCTAssertThrowsError(
            try ModelArtifactIntegrity.verify(directory: root, expectedSHA256: digest)
        )
    }
}
