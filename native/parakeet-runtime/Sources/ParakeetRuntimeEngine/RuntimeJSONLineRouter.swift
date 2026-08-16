import Foundation
import ParakeetRuntimeCore

public protocol ParakeetRuntimeServing: Actor {
    func handle(_ request: RuntimeRequest) async -> RuntimeResponse
    func handleLive(_ request: RuntimeRequest) async -> ParakeetLiveServiceResult
    func shutdownLive() async
}

extension ParakeetService: ParakeetRuntimeServing {}

public struct RuntimeJSONLineOutput: Sendable {
    public let events: [RuntimeEvent]
    public let response: RuntimeResponse

    public init(events: [RuntimeEvent], response: RuntimeResponse) {
        self.events = events
        self.response = response
    }

    public func encodedLines() throws -> [Data] {
        let encoder = JSONEncoder()
        return try events.map { try encoder.encode($0) } + [try encoder.encode(response)]
    }
}

public actor RuntimeJSONLineRouter {
    public static let maximumLineBytes = 1024 * 1024

    private let service: any ParakeetRuntimeServing
    private let decoder = JSONDecoder()

    public init(service: any ParakeetRuntimeServing) {
        self.service = service
    }

    public func decode(line: String) -> RuntimeRequest? {
        guard let data = line.data(using: .utf8), data.count <= Self.maximumLineBytes else {
            return nil
        }
        return try? decoder.decode(RuntimeRequest.self, from: data)
    }

    public func route(line: String) async -> RuntimeJSONLineOutput {
        guard let request = decode(line: line) else {
            return RuntimeJSONLineOutput(
                events: [],
                response: .failure(id: "invalid", code: .invalidRequest)
            )
        }
        return await route(request)
    }

    public func route(_ request: RuntimeRequest) async -> RuntimeJSONLineOutput {
        switch request.method {
        case .streamOpen, .streamAppend, .streamFlush, .streamCancel, .streamReset:
            let result = await service.handleLive(request)
            return RuntimeJSONLineOutput(events: result.events, response: result.response)
        case .shutdown:
            await service.shutdownLive()
            return RuntimeJSONLineOutput(
                events: [],
                response: .prepared(id: request.id, modelVersion: "shutdown")
            )
        case .prepare, .transcribe, .cancel:
            return RuntimeJSONLineOutput(
                events: [],
                response: await service.handle(request)
            )
        }
    }

    public func shutdown() async {
        await service.shutdownLive()
    }
}

public actor RuntimeJSONLineWriter {
    private let sink: @Sendable (Data) -> Void

    public init(sink: @escaping @Sendable (Data) -> Void) {
        self.sink = sink
    }

    public func write(_ output: RuntimeJSONLineOutput) {
        let lines: [Data]
        do {
            lines = try output.encodedLines()
        } catch {
            let failure = RuntimeResponse.failure(
                id: output.response.id,
                code: .invalidRequest
            )
            guard let encoded = try? JSONEncoder().encode(failure) else { return }
            lines = [encoded]
        }
        for line in lines {
            var framed = line
            framed.append(0x0A)
            sink(framed)
        }
    }
}
