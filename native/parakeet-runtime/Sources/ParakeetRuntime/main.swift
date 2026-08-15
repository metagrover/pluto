import Foundation
import ParakeetRuntimeCore
import ParakeetRuntimeEngine

private actor ResponseWriter {
    private let encoder = JSONEncoder()

    func write(_ response: RuntimeResponse) {
        guard let data = try? encoder.encode(response) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

private actor RequestCoordinator {
    private let service: ParakeetService
    private let writer: ResponseWriter
    private var tasks: [String: Task<Void, Never>] = [:]

    init(service: ParakeetService, writer: ResponseWriter) {
        self.service = service
        self.writer = writer
    }

    func submit(_ request: RuntimeRequest) {
        if request.method == .cancel {
            guard let targetID = request.targetId, let task = tasks[targetID] else {
                Task { await writer.write(.failure(id: request.id, code: .invalidRequest)) }
                return
            }
            task.cancel()
            Task { await writer.write(.failure(id: request.id, code: .cancelled)) }
            return
        }

        guard request.method != .shutdown else {
            for task in tasks.values { task.cancel() }
            tasks.removeAll()
            Task { await writer.write(.prepared(id: request.id, modelVersion: "shutdown")) }
            return
        }

        guard tasks[request.id] == nil else {
            Task { await writer.write(.failure(id: request.id, code: .invalidRequest)) }
            return
        }
        tasks[request.id] = Task { [service, writer] in
            let response = await service.handle(request)
            await writer.write(response)
            self.finished(request.id)
        }
    }

    private func finished(_ id: String) {
        tasks[id] = nil
    }
}

private struct Arguments {
    let modelRoot: URL
    let audioRoot: URL

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
    }
}

@main
private enum ParakeetRuntimeMain {
    static func main() async {
        guard let arguments = Arguments(Array(CommandLine.arguments.dropFirst())) else {
            return
        }
        let writer = ResponseWriter()
        let service = ParakeetService(
            modelRoot: arguments.modelRoot,
            audioRoot: arguments.audioRoot,
            manifest: ProductionModelManifest.current
        )
        let coordinator = RequestCoordinator(service: service, writer: writer)
        let decoder = JSONDecoder()

        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard let data = line.data(using: .utf8) else { continue }
                guard let request = try? decoder.decode(RuntimeRequest.self, from: data) else {
                    await writer.write(.failure(id: "invalid", code: .invalidRequest))
                    continue
                }
                await coordinator.submit(request)
            }
        } catch {
            return
        }
    }
}
