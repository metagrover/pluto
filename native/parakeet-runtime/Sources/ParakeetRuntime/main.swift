import Foundation
import ParakeetRuntimeCore
import ParakeetRuntimeEngine
import Darwin

private struct Arguments {
    let modelRoot: URL
    let audioRoot: URL
    let testFixtureLive: Bool
    let liveConfigurationID: ParakeetLiveConfigurationID

    init?(_ values: [String]) {
        guard
            let modelIndex = values.firstIndex(of: "--model-root"),
            let audioIndex = values.firstIndex(of: "--audio-root"),
            values.indices.contains(modelIndex + 1),
            values.indices.contains(audioIndex + 1)
        else { return nil }
        modelRoot = URL(fileURLWithPath: values[modelIndex + 1], isDirectory: true)
        audioRoot = URL(fileURLWithPath: values[audioIndex + 1], isDirectory: true)
        guard modelRoot.path.hasPrefix("/"), audioRoot.path.hasPrefix("/") else { return nil }
        let configIndices = values.indices.filter { values[$0] == "--live-config" }
        guard configIndices.count <= 1 else { return nil }
        if let configIndex = configIndices.first {
            guard values.indices.contains(configIndex + 1),
                let selected = ParakeetLiveConfigurationID(rawValue: values[configIndex + 1])
            else { return nil }
            liveConfigurationID = selected
        } else {
            liveConfigurationID = .pinnedDefault
        }
        testFixtureLive = values.contains("--test-fixture-live")
        #if !DEBUG
            guard !testFixtureLive else { return nil }
        #endif
    }
}

#if DEBUG
    private actor FixtureRuntimeService: ParakeetRuntimeServing {
        private struct Stream {
            let source: LiveSource
            var generation: Int
            var nextSequence = 1
            var revision = 1
        }

        private let liveConfigurationID: ParakeetLiveConfigurationID
        private var streams: [String: Stream] = [:]

        init(liveConfigurationID: ParakeetLiveConfigurationID) {
            self.liveConfigurationID = liveConfigurationID
        }

        func handle(_ request: RuntimeRequest) async -> RuntimeResponse {
            .prepared(
                id: request.id,
                modelVersion: "fixture",
                liveConfigId: liveConfigurationID.rawValue
            )
        }

        func handleLive(_ request: RuntimeRequest) async -> ParakeetLiveServiceResult {
            guard let live = request.live else {
                return .failure(id: request.id, code: .invalidRequest)
            }
            switch request.method {
            case .streamOpen:
                guard streams[live.streamId] == nil,
                    !streams.values.contains(where: { $0.source == live.source }),
                    streams.count < 2
                else { return .failure(id: request.id, code: .invalidRequest) }
                streams[live.streamId] = Stream(
                    source: live.source, generation: live.generation
                )
                return .success(id: request.id)
            case .streamAppend:
                guard var stream = streams[live.streamId],
                    stream.source == live.source,
                    stream.generation == live.generation,
                    live.sequence == stream.nextSequence
                else { return .failure(id: request.id, code: .invalidRequest) }
                let update = RuntimeEvent.streamUpdate(LiveStreamUpdate(
                    streamId: live.streamId,
                    source: live.source,
                    generation: live.generation,
                    revision: stream.revision,
                    qualifiesPriorTentative: stream.nextSequence > 1,
                    committedThroughSequence: max(0, stream.nextSequence - 1),
                    tentativeThroughSequence: stream.nextSequence,
                    text: "synthetic",
                    confidence: 0.8,
                    audioEndSeconds: live.chunkEndSeconds ?? 0
                ))
                stream.nextSequence += 1
                stream.revision += 1
                streams[live.streamId] = stream
                return .success(id: request.id, events: [update])
            case .streamFlush:
                guard let stream = streams[live.streamId],
                    stream.source == live.source,
                    stream.generation == live.generation
                else { return .failure(id: request.id, code: .invalidRequest) }
                streams[live.streamId] = nil
                return .success(
                    id: request.id,
                    finalPreview: "synthetic final",
                    degradations: []
                )
            case .streamCancel:
                guard let stream = streams[live.streamId],
                    stream.source == live.source,
                    stream.generation == live.generation
                else { return .failure(id: request.id, code: .invalidRequest) }
                streams[live.streamId] = nil
                return .success(id: request.id)
            case .streamReset:
                guard var stream = streams[live.streamId],
                    stream.source == live.source,
                    live.generation == stream.generation + 1
                else { return .failure(id: request.id, code: .invalidRequest) }
                stream.generation = live.generation
                stream.nextSequence = 1
                stream.revision = 1
                streams[live.streamId] = stream
                return .success(id: request.id)
            case .prepare, .transcribe, .cancel, .shutdown:
                return .failure(id: request.id, code: .invalidRequest)
            }
        }

        func shutdownLive() async { streams.removeAll() }
    }
#endif

@main
private enum ParakeetRuntimeMain {
    static func main() async {
        guard let arguments = Arguments(Array(CommandLine.arguments.dropFirst())) else {
            return
        }
        let service: any ParakeetRuntimeServing
        #if DEBUG
            if arguments.testFixtureLive {
                service = FixtureRuntimeService(
                    liveConfigurationID: arguments.liveConfigurationID
                )
            } else {
                service = ParakeetService(
                    modelRoot: arguments.modelRoot,
                    audioRoot: arguments.audioRoot,
                    manifest: ProductionModelManifest.current,
                    liveConfigurationID: arguments.liveConfigurationID
                )
            }
        #else
            service = ParakeetService(
                modelRoot: arguments.modelRoot,
                audioRoot: arguments.audioRoot,
                manifest: ProductionModelManifest.current,
                liveConfigurationID: arguments.liveConfigurationID
            )
        #endif
        let router = RuntimeJSONLineRouter(service: service)
        let writer = RuntimeJSONLineWriter { data in
            data.withUnsafeBytes { bytes in
                guard var cursor = bytes.baseAddress else { return }
                var remaining = bytes.count
                while remaining > 0 {
                    let written = Darwin.write(STDOUT_FILENO, cursor, remaining)
                    guard written > 0 else { return }
                    cursor = cursor.advanced(by: written)
                    remaining -= written
                }
            }
        }
        let coordinator = RuntimeRequestCoordinator(router: router, writer: writer)

        var framer = BoundedJSONLineFramer()
        while true {
            let data = FileHandle.standardInput.availableData
            if data.isEmpty { break }
            for frame in framer.ingest(data) {
                await handle(frame, router: router, writer: writer, coordinator: coordinator)
            }
        }
        for frame in framer.finish() {
            await handle(frame, router: router, writer: writer, coordinator: coordinator)
        }
        await coordinator.finish()
    }

    private static func handle(
        _ frame: BoundedJSONLineFrame,
        router: RuntimeJSONLineRouter,
        writer: RuntimeJSONLineWriter,
        coordinator: RuntimeRequestCoordinator
    ) async {
        switch frame {
        case .oversized:
            await writer.write(RuntimeJSONLineOutput(
                events: [], response: .failure(id: "invalid", code: .invalidRequest)
            ))
        case .line(let line):
            guard let request = await router.decode(line: line) else {
                await writer.write(RuntimeJSONLineOutput(
                    events: [], response: .failure(id: "invalid", code: .invalidRequest)
                ))
                return
            }
            await coordinator.submit(request)
        }
    }
}
