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

    func testRequiredArtifactDigestIgnoresUnpinnedExtrasAndRejectsRequiredMutation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let model = root.appendingPathComponent("Model.mlmodelc", isDirectory: true)
        try FileManager.default.createDirectory(at: model, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("weights".utf8).write(to: model.appendingPathComponent("weights.bin"))
        try Data("parameters".utf8).write(to: root.appendingPathComponent("parameters.json"))

        let required = ["Model.mlmodelc", "parameters.json"]
        let digest = try ModelArtifactIntegrity.digest(
            directory: root,
            requiredArtifacts: required
        )
        try Data("not-pinned".utf8).write(to: root.appendingPathComponent("config.json"))

        XCTAssertEqual(
            digest,
            try ModelArtifactIntegrity.digest(directory: root, requiredArtifacts: required)
        )
        XCTAssertNoThrow(
            try ModelArtifactIntegrity.verify(
                directory: root,
                requiredArtifacts: required,
                expectedSHA256: digest
            )
        )

        try Data("changed".utf8).write(to: model.appendingPathComponent("weights.bin"))
        XCTAssertThrowsError(
            try ModelArtifactIntegrity.verify(
                directory: root,
                requiredArtifacts: required,
                expectedSHA256: digest
            )
        )
    }
}
