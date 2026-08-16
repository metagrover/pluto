#if os(macOS)
import Foundation
import XCTest

@testable import FluidAudioCLI

final class AMIRTTMTests: XCTestCase {

    func testAMIRTTMLookupPrefersCachedHomePath() throws {
        let root = try makeFixtureRoot()
        let homeDir = root.appendingPathComponent("home", isDirectory: true)
        let workingDir = root.appendingPathComponent("workspace", isDirectory: true)
        let cachedRTTM = homeDir.appendingPathComponent("FluidAudioDatasets/ami_official/rttm/ES2004a.rttm")

        try FileManager.default.createDirectory(
            at: cachedRTTM.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "SPEAKER ES2004a 1 0.00 1.00 <NA> <NA> speaker0 <NA> <NA>\n".write(
            to: cachedRTTM,
            atomically: true,
            encoding: .utf8
        )

        let resolvedURL = DiarizationBenchmarkUtils.getAMIRTTMURL(
            for: "ES2004a",
            workingDir: workingDir,
            homeDir: homeDir
        )

        XCTAssertEqual(resolvedURL, cachedRTTM)
    }

    func testDownloadAMIRTTMsCopiesFromForcedAlignmentRepo() async throws {
        let root = try makeFixtureRoot()
        let sourceRoot = root.appendingPathComponent("Datasets/diar-forced-alignment/AMI", isDirectory: true)
        let destinationDir = root.appendingPathComponent("cache/rttm", isDirectory: true)
        let sourceRTTM = sourceRoot.appendingPathComponent("test/ES2004a.rttm")

        try FileManager.default.createDirectory(
            at: sourceRTTM.deletingLastPathComponent(), withIntermediateDirectories: true)
        let expectedContents = "SPEAKER ES2004a 1 0.00 1.00 <NA> <NA> speaker0 <NA> <NA>\n"
        try expectedContents.write(to: sourceRTTM, atomically: true, encoding: .utf8)

        await DatasetDownloader.downloadAMIRTTMs(
            force: false,
            singleFile: "ES2004a",
            sourceRoot: sourceRoot,
            destinationDir: destinationDir
        )

        let copiedRTTM = destinationDir.appendingPathComponent("ES2004a.rttm")
        XCTAssertTrue(FileManager.default.fileExists(atPath: copiedRTTM.path))
        XCTAssertEqual(try String(contentsOf: copiedRTTM), expectedContents)
    }

    private func makeFixtureRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
}
#endif
