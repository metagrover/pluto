import Foundation
import XCTest
@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

private actor RoutingService: ParakeetRuntimeServing {
    private(set) var liveCalls = 0
    private(set) var ordinaryCalls = 0
    private(set) var shutdownCalls = 0

    func handle(_ request: RuntimeRequest) async -> RuntimeResponse {
        ordinaryCalls += 1
        return .prepared(id: request.id, modelVersion: "fixture")
    }

    func handleLive(_ request: RuntimeRequest) async -> ParakeetLiveServiceResult {
        liveCalls += 1
        return .success(
            id: request.id,
            events: [
                .streamUpdate(LiveStreamUpdate(
                    streamId: "system-live",
                    source: .system,
                    generation: 1,
                    revision: 1,
                    qualifiesPriorTentative: false,
                    text: "synthetic",
                    confidence: 0.8,
                    audioEndSeconds: 1
                ))
            ]
        )
    }

    func shutdownLive() async { shutdownCalls += 1 }

    func counts() -> (live: Int, ordinary: Int, shutdown: Int) {
        (liveCalls, ordinaryCalls, shutdownCalls)
    }
}

final class RuntimeJSONLineRouterTests: XCTestCase {
    func testDebugExecutableRoutesLiveJSONLinesThroughInjectedFixtureService() throws {
        let executable = Self.productsDirectory.appendingPathComponent("parakeet-runtime")
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = executable
        process.arguments = [
            "--model-root", FileManager.default.temporaryDirectory.path,
            "--audio-root", FileManager.default.temporaryDirectory.path,
            "--test-fixture-live",
        ]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors

        try process.run()
        let request = RuntimeRequest(
            id: "append-process-1",
            method: .streamAppend,
            audioPath: "/fixture/chunk.wav",
            live: LiveRequestMetadata(
                streamId: "system-live", source: .system, generation: 1, sequence: 1,
                chunkStartSeconds: 0, chunkEndSeconds: 1
            )
        )
        var framed = try JSONEncoder().encode(request)
        framed.append(0x0A)
        input.fileHandleForWriting.write(framed)
        try input.fileHandleForWriting.close()
        process.waitUntilExit()

        let stdout = output.fileHandleForReading.readDataToEndOfFile()
        let stderr = errors.fileHandleForReading.readDataToEndOfFile()
        let lines = stdout.split(separator: 0x0A)
        XCTAssertEqual(process.terminationStatus, 0)
        XCTAssertEqual(lines.count, 2)
        let event = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(lines[0])) as? [String: Any]
        )
        let response = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(lines[1])) as? [String: Any]
        )
        XCTAssertEqual(event["event"] as? String, "stream_update")
        XCTAssertEqual(response["id"] as? String, "append-process-1")
        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertTrue(stderr.isEmpty)
    }

    func testDebugExecutableReportsSelectedLowLatencyConfiguration() throws {
        let result = try Self.runFixtureProcess(
            arguments: ["--live-config", "low-latency-2s"],
            request: RuntimeRequest(id: "prepare-config", method: .prepare)
        )
        let response = try XCTUnwrap(
            JSONSerialization.jsonObject(with: result.stdout) as? [String: Any]
        )
        let payload = try XCTUnwrap(response["result"] as? [String: Any])

        XCTAssertEqual(response["ok"] as? Bool, true)
        XCTAssertEqual(payload["liveConfigId"] as? String, "low-latency-2s")
        XCTAssertTrue(result.stderr.isEmpty)
    }

    func testDebugExecutableRejectsUnknownLiveConfigurationWithoutOutput() throws {
        let result = try Self.runFixtureProcess(
            arguments: ["--live-config", "private-unknown"],
            request: RuntimeRequest(id: "prepare-config", method: .prepare)
        )

        XCTAssertTrue(result.stdout.isEmpty)
        XCTAssertTrue(result.stderr.isEmpty)
    }

    func testRoutesLiveRequestToLiveHandlerAndWritesEventsBeforeOneResponse() async throws {
        let service = RoutingService()
        let router = RuntimeJSONLineRouter(service: service)
        let request = RuntimeRequest(
            id: "append-1",
            method: .streamAppend,
            audioPath: "/approved/chunk.wav",
            live: LiveRequestMetadata(
                streamId: "system-live",
                source: .system,
                generation: 1,
                sequence: 1,
                chunkStartSeconds: 0,
                chunkEndSeconds: 1
            )
        )

        let output = await router.route(request)
        let lines = try output.encodedLines()

        XCTAssertEqual(lines.count, 2)
        let first = try XCTUnwrap(JSONSerialization.jsonObject(with: lines[0]) as? [String: Any])
        let second = try XCTUnwrap(JSONSerialization.jsonObject(with: lines[1]) as? [String: Any])
        XCTAssertEqual(first["kind"] as? String, "event")
        XCTAssertEqual(first["event"] as? String, "stream_update")
        XCTAssertEqual(second["id"] as? String, "append-1")
        XCTAssertEqual(second["ok"] as? Bool, true)
        let counts = await service.counts()
        XCTAssertEqual(counts.live, 1)
        XCTAssertEqual(counts.ordinary, 0)
    }

    func testOrdinaryRequestWritesExactlyOneResponse() async throws {
        let service = RoutingService()
        let output = await RuntimeJSONLineRouter(service: service).route(
            RuntimeRequest(id: "prepare-1", method: .prepare)
        )

        XCTAssertEqual(try output.encodedLines().count, 1)
        let counts = await service.counts()
        XCTAssertEqual(counts.ordinary, 1)
        XCTAssertEqual(counts.live, 0)
    }

    func testSerializedWriterKeepsEachEmissionContiguousUnderConcurrency() async throws {
        let sink = LockedLineSink()
        let writer = RuntimeJSONLineWriter { data in sink.append(data) }
        let first = RuntimeJSONLineOutput(
            events: [.streamDegraded(LiveStreamDegraded(
                streamId: "system-live", source: .system, generation: 1, revision: 1,
                reason: .partialWindow
            ))],
            response: .prepared(id: "first", modelVersion: "fixture")
        )
        let second = RuntimeJSONLineOutput(
            events: [.streamDegraded(LiveStreamDegraded(
                streamId: "mic-live", source: .mic, generation: 1, revision: 1,
                reason: .partialWindow
            ))],
            response: .prepared(id: "second", modelVersion: "fixture")
        )

        async let one: Void = writer.write(first)
        async let two: Void = writer.write(second)
        _ = await (one, two)

        let identifiers = try sink.values().map { data -> String in
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            return (object["streamId"] as? String) ?? (object["id"] as? String) ?? "missing"
        }
        XCTAssertTrue(
            identifiers == ["system-live", "first", "mic-live", "second"] ||
                identifiers == ["mic-live", "second", "system-live", "first"]
        )
    }

    func testWriterStillEmitsOneCorrelatedResponseWhenAnEventCannotEncode() async throws {
        let sink = LockedLineSink()
        let writer = RuntimeJSONLineWriter { data in sink.append(data) }
        let invalid = RuntimeJSONLineOutput(
            events: [.streamUpdate(LiveStreamUpdate(
                streamId: "system-live", source: .system, generation: 1, revision: 1,
                qualifiesPriorTentative: false, text: "synthetic", confidence: 2,
                audioEndSeconds: 1
            ))],
            response: .prepared(id: "correlated", modelVersion: "fixture")
        )

        await writer.write(invalid)

        let lines = sink.values()
        XCTAssertEqual(lines.count, 1)
        let line = try XCTUnwrap(lines.first)
        let response = try XCTUnwrap(
            JSONSerialization.jsonObject(with: line) as? [String: Any]
        )
        XCTAssertEqual(response["id"] as? String, "correlated")
        XCTAssertEqual(response["ok"] as? Bool, false)
    }

    func testRejectsOversizedInputWithoutEchoingContent() async throws {
        let service = RoutingService()
        let router = RuntimeJSONLineRouter(service: service)
        let privateLine = "{\"id\":\"private\",\"padding\":\"" +
            String(repeating: "x", count: RuntimeJSONLineRouter.maximumLineBytes) + "\"}"

        let output = await router.route(line: privateLine)
        let encoded = try XCTUnwrap(String(data: output.encodedLines()[0], encoding: .utf8))

        XCTAssertFalse(encoded.contains("private"))
        XCTAssertEqual(output.response.error?.code, .invalidRequest)
        let counts = await service.counts()
        XCTAssertEqual(counts.live, 0)
    }

    func testShutdownCleansLiveStateBeforeResponding() async throws {
        let service = RoutingService()
        let router = RuntimeJSONLineRouter(service: service)

        let output = await router.route(RuntimeRequest(id: "shutdown-1", method: .shutdown))

        XCTAssertTrue(output.response.ok)
        let counts = await service.counts()
        XCTAssertEqual(counts.shutdown, 1)
    }

    private static var productsDirectory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent(".build/debug", isDirectory: true)
    }

    private static func runFixtureProcess(
        arguments: [String], request: RuntimeRequest
    ) throws -> (stdout: Data, stderr: Data) {
        let process = Process()
        let input = Pipe()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = productsDirectory.appendingPathComponent("parakeet-runtime")
        process.arguments = [
            "--model-root", FileManager.default.temporaryDirectory.path,
            "--audio-root", FileManager.default.temporaryDirectory.path,
            "--test-fixture-live",
        ] + arguments
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        var framed = try JSONEncoder().encode(request)
        framed.append(0x0A)
        input.fileHandleForWriting.write(framed)
        try input.fileHandleForWriting.close()
        process.waitUntilExit()
        return (
            output.fileHandleForReading.readDataToEndOfFile(),
            errors.fileHandleForReading.readDataToEndOfFile()
        )
    }
}

private final class LockedLineSink: @unchecked Sendable {
    private let lock = NSLock()
    private var lines: [Data] = []

    func append(_ data: Data) {
        lock.lock()
        lines.append(data)
        lock.unlock()
    }

    func values() -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        return lines
    }
}
