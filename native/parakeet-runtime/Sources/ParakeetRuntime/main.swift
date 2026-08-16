import Foundation
import ParakeetRuntimeCore
import ParakeetRuntimeEngine

private actor RequestCoordinator {
    private let router: RuntimeJSONLineRouter
    private let writer: RuntimeJSONLineWriter
    private var tasks: [String: Task<Void, Never>] = [:]

    init(router: RuntimeJSONLineRouter, writer: RuntimeJSONLineWriter) {
        self.router = router
        self.writer = writer
    }

    func submit(_ request: RuntimeRequest) {
        if request.method == .cancel {
            guard let targetID = request.targetId, let task = tasks[targetID] else {
                Task {
                    await writer.write(RuntimeJSONLineOutput(
                        events: [], response: .failure(id: request.id, code: .invalidRequest)
                    ))
                }
                return
            }
            task.cancel()
            Task {
                await writer.write(RuntimeJSONLineOutput(
                    events: [], response: .failure(id: request.id, code: .cancelled)
                ))
            }
            return
        }

        guard request.method != .shutdown else {
            for task in tasks.values { task.cancel() }
            tasks.removeAll()
            Task { [router, writer] in
                await writer.write(await router.route(request))
            }
            return
        }

        guard tasks[request.id] == nil else {
            Task {
                await writer.write(RuntimeJSONLineOutput(
                    events: [], response: .failure(id: request.id, code: .invalidRequest)
                ))
            }
            return
        }
        tasks[request.id] = Task { [router, writer] in
            let output = await router.route(request)
            await writer.write(output)
            self.finished(request.id)
        }
    }

    private func finished(_ id: String) {
        tasks[id] = nil
    }

    func finish() async {
        let running = Array(tasks.values)
        for task in running { await task.value }
        await router.shutdown()
    }
}

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
        private let liveConfigurationID: ParakeetLiveConfigurationID

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
            let events: [RuntimeEvent]
            if request.method == .streamAppend {
                events = [.streamUpdate(LiveStreamUpdate(
                    streamId: live.streamId,
                    source: live.source,
                    generation: live.generation,
                    revision: 1,
                    qualifiesPriorTentative: false,
                    text: "synthetic",
                    confidence: 0.8,
                    audioEndSeconds: live.chunkEndSeconds ?? 0
                ))]
            } else {
                events = []
            }
            return .success(id: request.id, events: events)
        }

        func shutdownLive() async {}
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
            FileHandle.standardOutput.write(data)
        }
        let coordinator = RequestCoordinator(router: router, writer: writer)

        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard let request = await router.decode(line: line) else {
                    await writer.write(RuntimeJSONLineOutput(
                        events: [], response: .failure(id: "invalid", code: .invalidRequest)
                    ))
                    continue
                }
                await coordinator.submit(request)
            }
        } catch {}
        await coordinator.finish()
    }
}
