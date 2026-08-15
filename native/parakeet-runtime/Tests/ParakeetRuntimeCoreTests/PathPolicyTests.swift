import Foundation
import XCTest
@testable import ParakeetRuntimeCore

final class PathPolicyTests: XCTestCase {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("parakeet-path-policy-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }

    func testApprovesRegularFileInsideRoot() throws {
        let root = try makeRoot()
        let audio = root.appendingPathComponent("audio.wav")
        XCTAssertTrue(FileManager.default.createFile(atPath: audio.path, contents: Data()))

        let approved = try PathPolicy(root: root.path).approve(
            path: audio.path,
            kind: .regularFile
        )

        XCTAssertEqual(approved, audio.standardizedFileURL)
    }

    func testRejectsFileOutsideRootWithoutLeakingPath() throws {
        let root = try makeRoot()
        let outside = FileManager.default.temporaryDirectory
            .appendingPathComponent("private-\(UUID().uuidString).wav")
        XCTAssertTrue(FileManager.default.createFile(atPath: outside.path, contents: Data()))
        addTeardownBlock { try? FileManager.default.removeItem(at: outside) }

        XCTAssertThrowsError(
            try PathPolicy(root: root.path).approve(path: outside.path, kind: .regularFile)
        ) { error in
            XCTAssertEqual(error as? RuntimeFailure, .pathNotAllowed)
            XCTAssertFalse(String(describing: error).contains(outside.lastPathComponent))
        }
    }

    func testRejectsSymlinkEscape() throws {
        let root = try makeRoot()
        let outside = FileManager.default.temporaryDirectory
            .appendingPathComponent("outside-\(UUID().uuidString).wav")
        let link = root.appendingPathComponent("linked.wav")
        XCTAssertTrue(FileManager.default.createFile(atPath: outside.path, contents: Data()))
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
        addTeardownBlock { try? FileManager.default.removeItem(at: outside) }

        XCTAssertThrowsError(
            try PathPolicy(root: root.path).approve(path: link.path, kind: .regularFile)
        ) { error in
            XCTAssertEqual(error as? RuntimeFailure, .pathNotAllowed)
        }
    }

    func testRejectsRelativePath() throws {
        let root = try makeRoot()

        XCTAssertThrowsError(
            try PathPolicy(root: root.path).approve(path: "../private.wav", kind: .regularFile)
        ) { error in
            XCTAssertEqual(error as? RuntimeFailure, .pathNotAllowed)
        }
    }

    func testApprovesExistingDirectoryWhenRequested() throws {
        let root = try makeRoot()
        let modelDirectory = root.appendingPathComponent("model", isDirectory: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)

        let approved = try PathPolicy(root: root.path).approve(
            path: modelDirectory.path,
            kind: .directory
        )

        XCTAssertEqual(approved, modelDirectory.standardizedFileURL)
    }
}
