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

public enum BoundedJSONLineFrame: Equatable, Sendable {
    case line(String)
    case oversized
}

public struct BoundedJSONLineFramer: Sendable {
    private let maximumLineBytes: Int
    private var buffer = Data()
    private var drainingOversizedLine = false

    public init(maximumLineBytes: Int = RuntimeJSONLineRouter.maximumLineBytes) {
        precondition(maximumLineBytes > 0)
        self.maximumLineBytes = maximumLineBytes
        buffer.reserveCapacity(min(maximumLineBytes, 64 * 1024))
    }

    public mutating func ingest(_ data: Data) -> [BoundedJSONLineFrame] {
        var frames: [BoundedJSONLineFrame] = []
        for byte in data {
            if drainingOversizedLine {
                if byte == 0x0A { drainingOversizedLine = false }
                continue
            }
            if byte == 0x0A {
                if !buffer.isEmpty {
                    frames.append(.line(String(decoding: buffer, as: UTF8.self)))
                    buffer.removeAll(keepingCapacity: true)
                }
                continue
            }
            buffer.append(byte)
            if buffer.count > maximumLineBytes {
                buffer.removeAll(keepingCapacity: true)
                drainingOversizedLine = true
                frames.append(.oversized)
            }
        }
        return frames
    }

    public mutating func finish() -> [BoundedJSONLineFrame] {
        guard !drainingOversizedLine, !buffer.isEmpty else {
            buffer.removeAll(keepingCapacity: true)
            return []
        }
        let line = String(decoding: buffer, as: UTF8.self)
        buffer.removeAll(keepingCapacity: true)
        return [.line(line)]
    }
}

public actor RuntimeRequestCoordinator {
    private struct PendingRequest {
        let route: Task<RuntimeJSONLineOutput, Never>
        let delivery: Task<Void, Never>
    }

    private let router: RuntimeJSONLineRouter
    private let writer: RuntimeJSONLineWriter
    private var tasks: [String: PendingRequest] = [:]
    private var suppressedRequestIDs: Set<String> = []
    private var accepting = true
    private var suppressOutputs = false

    public init(router: RuntimeJSONLineRouter, writer: RuntimeJSONLineWriter) {
        self.router = router
        self.writer = writer
    }

    public func submit(_ request: RuntimeRequest) async {
        guard accepting else { return }
        if request.method == .shutdown {
            await shutdown(responseID: request.id)
            return
        }
        if request.method == .cancel {
            guard let targetID = request.targetId, let pending = tasks[targetID],
                !suppressedRequestIDs.contains(targetID)
            else {
                await writer.write(RuntimeJSONLineOutput(
                    events: [], response: .failure(id: request.id, code: .invalidRequest)
                ))
                return
            }
            suppressedRequestIDs.insert(targetID)
            pending.route.cancel()
            await writer.write(RuntimeJSONLineOutput(
                events: [], response: .failure(id: request.id, code: .cancelled)
            ))
            return
        }
        guard tasks[request.id] == nil else {
            await writer.write(RuntimeJSONLineOutput(
                events: [], response: .failure(id: request.id, code: .invalidRequest)
            ))
            return
        }
        let route = Task.detached { [router] in
            await router.route(request)
        }
        let delivery = Task.detached {
            let output = await route.value
            await self.complete(id: request.id, output: output)
        }
        tasks[request.id] = PendingRequest(route: route, delivery: delivery)
    }

    public func finish() async {
        guard accepting else { return }
        accepting = false
        await router.shutdown()
        let running = Array(tasks.values)
        for pending in running { await pending.delivery.value }
    }

    private func complete(id: String, output: RuntimeJSONLineOutput) async {
        guard tasks[id] != nil else { return }
        if suppressOutputs || suppressedRequestIDs.remove(id) != nil {
            tasks[id] = nil
            return
        }
        await writer.write(output)
        tasks[id] = nil
    }

    private func shutdown(responseID: String) async {
        accepting = false
        suppressOutputs = true
        await router.shutdown()
        let running = Array(tasks.values)
        for pending in running { pending.route.cancel() }
        for pending in running { await pending.delivery.value }
        tasks.removeAll()
        suppressedRequestIDs.removeAll()
        await writer.write(RuntimeJSONLineOutput(
            events: [], response: .prepared(id: responseID, modelVersion: "shutdown")
        ))
    }
}
