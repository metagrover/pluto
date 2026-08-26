import Foundation
import XCTest
@testable import ParakeetRuntimeCore

private actor FakeModelInstaller: ModelInstalling {
    enum Failure: Error { case requested }

    private(set) var installedVersions: [String] = []
    var shouldFail = false

    func install(
        manifest: ModelManifest,
        into stagingDirectory: URL,
        progressHandler _: ModelPreparationProgressHandler?
    ) async throws {
        installedVersions.append(manifest.version)
        if shouldFail { throw Failure.requested }
        try FileManager.default.createDirectory(
            at: stagingDirectory,
            withIntermediateDirectories: true
        )
        try Data("model".utf8).write(to: stagingDirectory.appendingPathComponent("encoder.mlmodelc"))
    }

    func setShouldFail(_ value: Bool) { shouldFail = value }
}

final class ModelStoreTests: XCTestCase {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("parakeet-model-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }

    func testPreparationActivatesAnImmutableVersionDirectory() async throws {
        let root = try makeRoot()
        let installer = FakeModelInstaller()
        let store = ModelStore(root: root, installer: installer)
        let manifest = ModelManifest.fixture(version: "0.15.5-v3-int8")

        let active = try await store.prepare(manifest: manifest)

        XCTAssertEqual(active.lastPathComponent, "0.15.5-v3-int8")
        XCTAssertTrue(FileManager.default.fileExists(atPath: active.path))
        let activeVersion = try await store.activeVersion()
        XCTAssertEqual(activeVersion, manifest.version)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("staging").path))
    }

    func testPreparingSameVersionReusesActiveInstall() async throws {
        let root = try makeRoot()
        let installer = FakeModelInstaller()
        let store = ModelStore(root: root, installer: installer)
        let manifest = ModelManifest.fixture(version: "same-version")

        _ = try await store.prepare(manifest: manifest)
        _ = try await store.prepare(manifest: manifest)

        let installedVersions = await installer.installedVersions
        XCTAssertEqual(installedVersions, ["same-version"])
    }

    func testFailedPreparationPreservesPreviouslyActiveVersion() async throws {
        let root = try makeRoot()
        let installer = FakeModelInstaller()
        let store = ModelStore(root: root, installer: installer)
        let first = ModelManifest.fixture(version: "known-good")
        _ = try await store.prepare(manifest: first)
        await installer.setShouldFail(true)

        do {
            _ = try await store.prepare(manifest: .fixture(version: "broken-update"))
            XCTFail("Expected preparation to fail")
        } catch {
            let activeVersion = try await store.activeVersion()
            XCTAssertEqual(activeVersion, "known-good")
            XCTAssertTrue(FileManager.default.fileExists(
                atPath: root.appendingPathComponent("versions/known-good").path
            ))
            XCTAssertFalse(String(describing: error).contains(root.path))
        }
    }
}

private extension ModelManifest {
    static func fixture(version: String) -> ModelManifest {
        ModelManifest(
            identifier: "parakeet-tdt-0.6b-v3",
            version: version,
            repository: "FluidInference/parakeet-tdt-0.6b-v3-coreml",
            encoderPrecision: "int8"
        )
    }
}
