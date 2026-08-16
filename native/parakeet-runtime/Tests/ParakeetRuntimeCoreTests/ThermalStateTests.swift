import XCTest
@testable import ParakeetRuntimeCore

final class ThermalStateTests: XCTestCase {
    func testMapsAllFiniteProcessThermalStates() {
        XCTAssertEqual(ResourceProbeThermalState(processThermalRawValue: 0), .nominal)
        XCTAssertEqual(ResourceProbeThermalState(processThermalRawValue: 1), .fair)
        XCTAssertEqual(ResourceProbeThermalState(processThermalRawValue: 2), .serious)
        XCTAssertEqual(ResourceProbeThermalState(processThermalRawValue: 3), .critical)
    }

    func testUnknownThermalStateIsSuppressed() {
        XCTAssertNil(ResourceProbeThermalState(processThermalRawValue: 99))
    }

    func testProbeSamplesBlockedTargetForTwoIntervalsAndCleansUp() throws {
        let target = Process()
        target.executableURL = URL(fileURLWithPath: "/bin/sh")
        target.arguments = ["-c", "sleep 4"]
        try target.run()
        defer {
            if target.isRunning { target.terminate() }
            target.waitUntilExit()
        }

        let probe = Process()
        probe.executableURL = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath
        ).appendingPathComponent(".build/debug/parakeet-resource-probe")
        probe.arguments = [
            "--pid", String(target.processIdentifier),
            "--parent-pid", String(ProcessInfo.processInfo.processIdentifier),
            "--interval-ms", "100"
        ]
        let output = Pipe()
        probe.standardOutput = output
        try probe.run()
        Thread.sleep(forTimeInterval: 0.65)
        let data = output.fileHandleForReading.availableData
        probe.terminate()
        probe.waitUntilExit()

        let lines = String(decoding: data, as: UTF8.self)
            .split(separator: "\n")
        XCTAssertGreaterThanOrEqual(lines.count, 2)
        XCTAssertTrue(lines.allSatisfy { line in
            guard let value = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  let wall = value["wallTimeMs"] as? NSNumber,
                  let rss = value["rssBytes"] as? NSNumber,
                  let thermal = value["thermal"] as? String else { return false }
            return wall.int64Value > 0 && rss.int64Value >= 0 && ["nominal", "fair", "serious", "critical"].contains(thermal)
        })
    }
}
