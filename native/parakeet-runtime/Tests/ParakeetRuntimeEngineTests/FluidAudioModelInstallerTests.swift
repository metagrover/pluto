import Foundation
import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

private actor FakeRevisionChecker: RepositoryRevisionChecking {
    private(set) var requests: [(String, String)] = []

    func require(repository: String, revision: String) async throws {
        requests.append((repository, revision))
    }
}

private struct FakeBundleDownloader: FluidAudioModelBundleDownloading {
    let includeEou: Bool

    func download(into stagingDirectory: URL) async throws {
        try Self.write("asr", to: stagingDirectory.appendingPathComponent(
            FluidAudioModelLayout.installedAsrDirectoryName,
            isDirectory: true
        ))
        try Self.write("ctc", to: stagingDirectory.appendingPathComponent(
            FluidAudioModelLayout.ctcDirectoryName,
            isDirectory: true
        ))
        if includeEou {
            try Self.write("eou", to: stagingDirectory.appendingPathComponent(
                FluidAudioModelLayout.eouDirectoryName,
                isDirectory: true
            ))
        }
    }

    private static func write(_ value: String, to directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(value.utf8).write(to: directory.appendingPathComponent("artifact.bin"))
    }
}

final class FluidAudioModelInstallerTests: XCTestCase {
    func testInstallerChecksEveryRevisionAndVerifiesCompleteBundle() async throws {
        let root = try makeRoot()
        let digests = try fixtureDigests(at: root.appendingPathComponent("reference"))
        let staging = root.appendingPathComponent("staging")
        let checker = FakeRevisionChecker()
        let installer = FluidAudioModelInstaller(
            revisionChecker: checker,
            downloader: FakeBundleDownloader(includeEou: true)
        )

        try await installer.install(manifest: manifest(digests: digests), into: staging)

        let requests = await checker.requests
        XCTAssertEqual(requests.map(\.0), ["asr-repo", "ctc-repo", "eou-repo"])
        XCTAssertEqual(requests.map(\.1), ["asr-revision", "ctc-revision", "eou-revision"])
    }

    func testInstallerRejectsBundleWithoutEouAssets() async throws {
        let root = try makeRoot()
        let digests = try fixtureDigests(at: root.appendingPathComponent("reference"))
        let checker = FakeRevisionChecker()
        let installer = FluidAudioModelInstaller(
            revisionChecker: checker,
            downloader: FakeBundleDownloader(includeEou: false)
        )

        await XCTAssertThrowsErrorAsync {
            try await installer.install(
                manifest: self.manifest(digests: digests),
                into: root.appendingPathComponent("staging")
            )
        }
    }

    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("parakeet-installer-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }

    private func fixtureDigests(at root: URL) throws -> (String, String, String) {
        try FakeBundleDownloader(includeEou: true).writeFixture(into: root)
        return (
            try ModelArtifactIntegrity.digest(directory: root.appendingPathComponent(
                FluidAudioModelLayout.installedAsrDirectoryName
            )),
            try ModelArtifactIntegrity.digest(directory: root.appendingPathComponent(
                FluidAudioModelLayout.ctcDirectoryName
            )),
            try ModelArtifactIntegrity.digest(directory: root.appendingPathComponent(
                FluidAudioModelLayout.eouDirectoryName
            ))
        )
    }

    private func manifest(digests: (String, String, String)) -> ModelManifest {
        ModelManifest(
            identifier: "parakeet",
            version: "fixture",
            repository: "asr-repo",
            repositoryRevision: "asr-revision",
            auxiliaryRepository: "ctc-repo",
            auxiliaryRepositoryRevision: "ctc-revision",
            eouRepository: "eou-repo",
            eouRepositoryRevision: "eou-revision",
            recognitionArtifactSHA256: digests.0,
            vocabularyArtifactSHA256: digests.1,
            eouArtifactSHA256: digests.2,
            encoderPrecision: "int8"
        )
    }
}

private extension FakeBundleDownloader {
    func writeFixture(into directory: URL) throws {
        try Self.write("asr", to: directory.appendingPathComponent(
            FluidAudioModelLayout.installedAsrDirectoryName,
            isDirectory: true
        ))
        try Self.write("ctc", to: directory.appendingPathComponent(
            FluidAudioModelLayout.ctcDirectoryName,
            isDirectory: true
        ))
        try Self.write("eou", to: directory.appendingPathComponent(
            FluidAudioModelLayout.eouDirectoryName,
            isDirectory: true
        ))
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected error", file: file, line: line)
    } catch {}
}
