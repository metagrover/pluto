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

    func testMemoryOnlyProbeSamplesBoundedKernelPercentAndStopsWithEitherOwner() throws {
        for watchesParent in [false, true] {
            let target = Process()
            target.executableURL = URL(fileURLWithPath: "/bin/sleep")
            target.arguments = ["5"]
            try target.run()
            defer {
                if target.isRunning { target.terminate() }
                target.waitUntilExit()
            }

            let probe = Process()
            probe.executableURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent(".build/debug/parakeet-resource-probe")
            probe.arguments = [
                "--pid", String(watchesParent ? ProcessInfo.processInfo.processIdentifier : target.processIdentifier),
                "--parent-pid", String(watchesParent ? target.processIdentifier : ProcessInfo.processInfo.processIdentifier),
                "--interval-ms", "25", "--memory-only"
            ]
            let output = Pipe()
            probe.standardOutput = output
            try probe.run()
            defer {
                if probe.isRunning { probe.terminate() }
                probe.waitUntilExit()
            }
            let firstSamples = output.fileHandleForReading.availableData
            // A memory timer must continue at its requested25ms cadence, rather
            // than falling back to the normal100ms RSS sampling interval.
            Thread.sleep(forTimeInterval: 0.3)
            target.terminate()
            target.waitUntilExit()
            let deadline = Date().addingTimeInterval(2)
            while probe.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
            XCTAssertFalse(probe.isRunning, "Memory probe must exit when its target or parent exits")
            if probe.isRunning { probe.terminate() }
            probe.waitUntilExit()
            XCTAssertEqual(probe.terminationStatus, 0)
            let samples = firstSamples + output.fileHandleForReading.readDataToEndOfFile()
            let lines = String(decoding: samples, as: UTF8.self)
                .split(separator: "\n")
            XCTAssertGreaterThanOrEqual(lines.count, 8)
            var previousWall: Int64 = 0
            for line in lines {
                XCTAssertLessThanOrEqual(line.utf8.count, 512)
                let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
                XCTAssertEqual(Set(value.keys), ["wallTimeMs", "memoryPressureFreePercent"])
                let wall = try XCTUnwrap(value["wallTimeMs"] as? NSNumber).int64Value
                let percent = try XCTUnwrap(value["memoryPressureFreePercent"] as? NSNumber).intValue
                XCTAssertGreaterThan(wall, previousWall)
                XCTAssertTrue((0...100).contains(percent))
                previousWall = wall
            }
        }
    }

    func testProbeRejectsFastIntervalsOutsideMemoryModeAndTooFastMemorySampling() throws {
        for (interval, memoryOnly) in [("25", false), ("24", true)] {
            let probe = Process()
            probe.executableURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent(".build/debug/parakeet-resource-probe")
            let pid = String(ProcessInfo.processInfo.processIdentifier)
            probe.arguments = ["--pid", pid, "--parent-pid", pid, "--interval-ms", interval]
                + (memoryOnly ? ["--memory-only"] : [])
            let output = Pipe()
            probe.standardOutput = output
            try probe.run()
            probe.waitUntilExit()
            XCTAssertEqual(probe.terminationStatus, 64)
            XCTAssertTrue(output.fileHandleForReading.readDataToEndOfFile().isEmpty)
        }
    }

}
