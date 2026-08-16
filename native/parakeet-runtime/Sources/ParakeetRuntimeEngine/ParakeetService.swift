import Foundation
import ParakeetRuntimeCore

public actor ParakeetService {
    private let modelRoot: URL
    private let audioRoot: URL
    private let manifest: ModelManifest
    private let modelStore: ModelStore
    private let transcriber: ParakeetTranscriber
    private let liveDriver: any ParakeetLiveDriving
    private let liveConfigurationID: ParakeetLiveConfigurationID
    private var activeModelURL: URL?
    private var liveSession: ParakeetLiveSession?

    public init(
        modelRoot: URL,
        audioRoot: URL,
        manifest: ModelManifest,
        installer: any ModelInstalling = FluidAudioModelInstaller(),
        inferenceDriver: any ParakeetInferenceDriving = FluidAudioInferenceDriver(),
        liveDriver: any ParakeetLiveDriving = FluidAudioLiveDriver(),
        liveConfigurationID: ParakeetLiveConfigurationID = .pinnedDefault
    ) {
        self.modelRoot = modelRoot.standardizedFileURL
        self.audioRoot = audioRoot.standardizedFileURL
        self.manifest = manifest
        self.modelStore = ModelStore(root: self.modelRoot, installer: installer)
        self.transcriber = ParakeetTranscriber(driver: inferenceDriver)
        self.liveDriver = liveDriver
        self.liveConfigurationID = liveConfigurationID
    }

    public func handleLive(_ request: RuntimeRequest) async -> ParakeetLiveServiceResult {
        guard
            request.schemaVersion == 1,
            !request.id.isEmpty,
            let metadata = request.live,
            let activeModelURL
        else { return .failure(id: request.id, code: .invalidRequest) }

        let session: ParakeetLiveSession
        if let existing = liveSession {
            session = existing
        } else {
            let created = ParakeetLiveSession(
                driver: liveDriver,
                activeModelURL: activeModelURL,
                audioRoot: audioRoot,
                configuration: liveConfigurationID.configuration
            )
            liveSession = created
            session = created
        }

        do {
            switch request.method {
            case .streamOpen:
                try await session.open(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
                return .success(id: request.id)
            case .streamAppend:
                guard
                    let sequence = metadata.sequence,
                    let audioPath = request.audioPath,
                    let chunkStartSeconds = metadata.chunkStartSeconds,
                    let chunkEndSeconds = metadata.chunkEndSeconds
                else { return .failure(id: request.id, code: .invalidRequest) }
                let result = try await session.append(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation,
                    sequence: sequence,
                    audioURL: URL(fileURLWithPath: audioPath),
                    chunkStartSeconds: chunkStartSeconds,
                    chunkEndSeconds: chunkEndSeconds
                )
                return .success(id: request.id, events: result.events)
            case .streamFlush:
                let result = try await session.flush(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
                return .success(
                    id: request.id,
                    events: result.events,
                    finalPreview: result.finalPreview,
                    degradations: result.degradations
                )
            case .streamCancel:
                try await session.cancel(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
                return .success(id: request.id)
            case .streamReset:
                try await session.reset(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
                return .success(id: request.id)
            case .prepare, .transcribe, .cancel, .shutdown:
                return .failure(id: request.id, code: .invalidRequest)
            }
        } catch let terminal as LiveRuntimeTerminalFailure {
            return .failure(
                id: request.id,
                code: runtimeFailure(for: terminal.failure),
                events: [terminal.event]
            )
        } catch let failure as LiveRuntimeFailure {
            if failure == .unsupportedCapability {
                return .failure(
                    id: request.id,
                    code: runtimeFailure(for: failure),
                    events: [.streamFailed(LiveStreamFailed(
                        streamId: metadata.streamId,
                        source: metadata.source,
                        generation: metadata.generation,
                        revision: 1,
                        reason: .modelUnavailable
                    ))]
                )
            }
            return .failure(id: request.id, code: runtimeFailure(for: failure))
        } catch {
            return .failure(id: request.id, code: .transcriptionFailed)
        }
    }

    public func shutdownLive() async {
        if let liveSession {
            await liveSession.shutdown()
            self.liveSession = nil
        }
    }

    public func handle(_ request: RuntimeRequest) async -> RuntimeResponse {
        guard request.schemaVersion == 1, !request.id.isEmpty else {
            return .failure(id: request.id, code: .invalidRequest)
        }

        switch request.method {
        case .prepare:
            return await prepare(request)
        case .transcribe:
            return await transcribe(request)
        case .cancel, .shutdown, .streamOpen, .streamAppend, .streamFlush, .streamCancel,
            .streamReset:
            return .failure(id: request.id, code: .invalidRequest)
        }
    }

    private func prepare(_ request: RuntimeRequest) async -> RuntimeResponse {
        guard request.modelRoot == nil || request.modelRoot == modelRoot.path else {
            return .failure(id: request.id, code: .pathNotAllowed)
        }
        do {
            if let liveSession {
                await liveSession.shutdown()
                self.liveSession = nil
            }
            activeModelURL = try await modelStore.prepare(manifest: manifest)
            return .prepared(
                id: request.id,
                modelVersion: manifest.version,
                liveConfigId: liveConfigurationID.rawValue
            )
        } catch is CancellationError {
            return .failure(id: request.id, code: .cancelled)
        } catch {
            return .failure(id: request.id, code: .modelPreparationFailed)
        }
    }

    private func transcribe(_ request: RuntimeRequest) async -> RuntimeResponse {
        guard let activeModelURL, let audioPath = request.audioPath else {
            return .failure(id: request.id, code: .invalidRequest)
        }
        do {
            let audioURL = try PathPolicy(root: audioRoot.path).approve(
                path: audioPath,
                kind: .regularFile
            )
            let vocabulary = normalizedVocabulary(request.vocabulary ?? [])
            let output = try await transcriber.transcribe(
                modelURL: activeModelURL,
                audioURL: audioURL,
                language: request.language,
                vocabulary: vocabulary
            )
            try Task.checkCancellation()
            return .transcribed(
                id: request.id,
                output: output,
                vocabularyCount: vocabulary.count
            )
        } catch is CancellationError {
            return .failure(id: request.id, code: .cancelled)
        } catch let failure as RuntimeFailure {
            return .failure(id: request.id, code: failure)
        } catch {
            return .failure(id: request.id, code: .transcriptionFailed)
        }
    }

    private func normalizedVocabulary(_ vocabulary: [String]) -> [String] {
        var seen = Set<String>()
        return vocabulary.prefix(100).compactMap { rawTerm in
            let term = rawTerm.trimmingCharacters(in: .whitespacesAndNewlines)
            guard term.count >= 3, term.count <= 100 else { return nil }
            let key = term.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            guard seen.insert(key).inserted else { return nil }
            return term
        }
    }

    private func runtimeFailure(for failure: LiveRuntimeFailure) -> RuntimeFailure {
        switch failure {
        case .pathNotAllowed:
            return .pathNotAllowed
        case .modelUnavailable, .unsupportedCapability:
            return .modelPreparationFailed
        case .cancelled:
            return .cancelled
        case .inferenceFailed:
            return .transcriptionFailed
        case .streamCapacity, .streamNotFound, .generationMismatch, .sourceMismatch, .sequenceGap,
            .duplicateMismatch, .backpressure:
            return .invalidRequest
        }
    }
}

public struct ParakeetLiveServiceResult: Equatable, Sendable {
    public let response: RuntimeResponse
    public let events: [RuntimeEvent]
    public let finalPreview: String?
    public let degradations: [LiveStreamDegraded]

    public static func success(
        id: String,
        events: [RuntimeEvent] = [],
        finalPreview: String? = nil,
        degradations: [LiveStreamDegraded] = []
    ) -> ParakeetLiveServiceResult {
        ParakeetLiveServiceResult(
            response: RuntimeResponse(
                schemaVersion: 1,
                id: id,
                ok: true,
                result: RuntimeResultPayload(),
                error: nil
            ),
            events: events,
            finalPreview: finalPreview,
            degradations: degradations
        )
    }

    public static func failure(
        id: String,
        code: RuntimeFailure,
        events: [RuntimeEvent] = []
    ) -> ParakeetLiveServiceResult {
        ParakeetLiveServiceResult(
            response: .failure(id: id, code: code),
            events: events,
            finalPreview: nil,
            degradations: []
        )
    }
}
