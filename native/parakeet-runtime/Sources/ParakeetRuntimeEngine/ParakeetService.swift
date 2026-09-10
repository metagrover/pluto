import Foundation
import ParakeetRuntimeCore

public actor ParakeetService {
    private let modelRoot: URL
    private let audioRoot: URL
    private let manifest: ModelManifest
    private let modelStore: ModelStore
    private let transcriber: ParakeetTranscriber
    private let liveDriver: any ParakeetLiveDriving
    private let eouDriver: any ParakeetEouDriving
    private let speakerEvidenceDriver: any SpeakerEvidenceDriving
    private let liveConfigurationID: ParakeetLiveConfigurationID
    private let preparationProgressSink:
        (@Sendable (String, ModelPreparationProgress) -> Void)?
    private var activeModelURL: URL?
    private var liveSession: ParakeetLiveSession?
    private var eouSession: ParakeetEouSession?

    public init(
        modelRoot: URL,
        audioRoot: URL,
        manifest: ModelManifest,
        installer: any ModelInstalling = FluidAudioModelInstaller(),
        inferenceDriver: any ParakeetInferenceDriving = FluidAudioInferenceDriver(),
        liveDriver: any ParakeetLiveDriving = FluidAudioLiveDriver(),
        eouDriver: any ParakeetEouDriving = FluidAudioEouDriver(),
        speakerEvidenceDriver: (any SpeakerEvidenceDriving)? = nil,
        liveConfigurationID: ParakeetLiveConfigurationID = .pinnedDefault,
        preparationProgressSink:
            (@Sendable (String, ModelPreparationProgress) -> Void)? = nil
    ) {
        self.modelRoot = modelRoot.standardizedFileURL
        self.audioRoot = audioRoot.standardizedFileURL
        self.manifest = manifest
        self.modelStore = ModelStore(root: self.modelRoot, installer: installer)
        self.transcriber = ParakeetTranscriber(driver: inferenceDriver)
        self.liveDriver = liveDriver
        self.eouDriver = eouDriver
        self.speakerEvidenceDriver = speakerEvidenceDriver ?? SpeakerEvidenceCoordinator(
            diarizer: FluidAudioOfflineDiarizer(
                modelsRoot: self.modelRoot.appendingPathComponent("diarization", isDirectory: true)
            ),
            energyAnalyzer: SpeakerEnergyAnalyzer(),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "fluidaudio-0.15.5"
        )
        self.liveConfigurationID = liveConfigurationID
        self.preparationProgressSink = preparationProgressSink
    }

    public func handleLive(_ request: RuntimeRequest) async -> ParakeetLiveServiceResult {
        if request.eou != nil {
            return await handleEou(request)
        }
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
            case .prepare, .transcribe, .speakerEvidence, .cancel, .shutdown, .eouOpen, .eouAppend, .eouFinish,
                .eouCancel, .eouReset:
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
        if let eouSession {
            await eouSession.shutdown()
            self.eouSession = nil
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
        case .speakerEvidence:
            return await analyzeSpeakerEvidence(request)
        case .cancel, .shutdown, .streamOpen, .streamAppend, .streamFlush, .streamCancel,
            .streamReset, .eouOpen, .eouAppend, .eouFinish, .eouCancel, .eouReset:
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
            if let eouSession {
                await eouSession.shutdown()
                self.eouSession = nil
            }
            let requestId = request.id
            let progressSink = preparationProgressSink
            activeModelURL = try await modelStore.prepare(
                manifest: manifest,
                progressHandler: { progress in
                    progressSink?(requestId, progress)
                }
            )
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
            let audioInput: AudioInput
            if let capability = request.capability {
                let loaded = try EncryptedAudioLoader.load(
                    filePath: audioURL.path,
                    capability: capability,
                    expectedOperation: "transcribe"
                )
                audioInput = .pcmSamples(loaded.samples, sampleRate: loaded.sampleRate)
            } else {
                audioInput = .fileURL(audioURL)
            }
            let vocabulary = normalizedVocabulary(request.vocabulary ?? [])
            let output = try await transcriber.transcribe(
                modelURL: activeModelURL,
                audioInput: audioInput,
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

    private func analyzeSpeakerEvidence(_ request: RuntimeRequest) async -> RuntimeResponse {
        guard
            let mixedAudioPath = request.mixedAudioPath,
            let micAudioPath = request.micAudioPath,
            let systemAudioPath = request.systemAudioPath
        else { return .failure(id: request.id, code: .invalidRequest) }
        do {
            let policy = PathPolicy(root: audioRoot.path)
            let mixedURL = try policy.approve(path: mixedAudioPath, kind: .regularFile)
            let micURL = try policy.approve(path: micAudioPath, kind: .regularFile)
            let systemURL = try policy.approve(path: systemAudioPath, kind: .regularFile)
            let mixedInput: AudioInput
            let micInput: AudioInput
            let systemInput: AudioInput
            if let capability = request.capability {
                let mixed = try EncryptedAudioLoader.load(
                    filePath: mixedURL.path,
                    capability: capability,
                    expectedOperation: "speakerEvidence"
                )
                let mic = try EncryptedAudioLoader.load(
                    filePath: micURL.path,
                    capability: capability,
                    expectedOperation: "speakerEvidence"
                )
                let system = try EncryptedAudioLoader.load(
                    filePath: systemURL.path,
                    capability: capability,
                    expectedOperation: "speakerEvidence"
                )
                mixedInput = .pcmSamples(mixed.samples, sampleRate: mixed.sampleRate)
                micInput = .pcmSamples(mic.samples, sampleRate: mic.sampleRate)
                systemInput = .pcmSamples(system.samples, sampleRate: system.sampleRate)
            } else {
                mixedInput = .fileURL(mixedURL)
                micInput = .fileURL(micURL)
                systemInput = .fileURL(systemURL)
            }
            let output = try await speakerEvidenceDriver.analyze(
                mixedInput: mixedInput,
                micInput: micInput,
                systemInput: systemInput
            )
            try Task.checkCancellation()
            return .speakerEvidence(id: request.id, output: output)
        } catch is CancellationError {
            return .failure(id: request.id, code: .cancelled)
        } catch let failure as RuntimeFailure {
            return .failure(id: request.id, code: failure)
        } catch {
            return .failure(id: request.id, code: .diarizationFailed)
        }
    }

    private func handleEou(_ request: RuntimeRequest) async -> ParakeetLiveServiceResult {
        guard
            request.schemaVersion == 1,
            !request.id.isEmpty,
            let metadata = request.eou,
            let activeModelURL
        else { return .failure(id: request.id, code: .invalidRequest) }

        let session: ParakeetEouSession
        if let existing = eouSession {
            session = existing
        } else {
            let created = ParakeetEouSession(
                driver: eouDriver,
                activeModelURL: activeModelURL
            )
            eouSession = created
            session = created
        }

        do {
            let events: [RuntimeEvent]
            switch request.method {
            case .eouOpen:
                try await session.open(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
                events = []
            case .eouAppend:
                guard let sequence = metadata.sequence, let frame = metadata.frame else {
                    return .failure(id: request.id, code: .invalidRequest)
                }
                events = try await session.append(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation,
                    sequence: sequence,
                    frame: frame
                )
            case .eouFinish:
                events = try await session.finish(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
            case .eouCancel:
                try await session.cancel(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
                events = []
            case .eouReset:
                try await session.reset(
                    streamId: metadata.streamId,
                    source: metadata.source,
                    generation: metadata.generation
                )
                events = []
            case .prepare, .transcribe, .speakerEvidence, .cancel, .shutdown, .streamOpen, .streamAppend,
                .streamFlush, .streamCancel, .streamReset:
                return .failure(id: request.id, code: .invalidRequest)
            }
            return .success(id: request.id, events: events)
        } catch let terminal as EouSessionTerminalFailure {
            return .failure(
                id: request.id,
                code: runtimeFailure(for: terminal.failure),
                events: [terminal.event]
            )
        } catch let failure as EouSessionFailure {
            return .failure(
                id: request.id,
                code: runtimeFailure(for: failure),
                events: terminalEouEvents(for: failure, metadata: metadata)
            )
        } catch {
            return .failure(id: request.id, code: .transcriptionFailed)
        }
    }

    private func terminalEouEvents(
        for failure: EouSessionFailure,
        metadata: EouRequestMetadata
    ) -> [RuntimeEvent] {
        guard failure == .modelUnavailable || failure == .inferenceFailed
            || failure == .prefixMutated || failure == .cancelled
        else { return [] }
        return [.eouFailed(EouStreamFailed(
            streamId: metadata.streamId,
            source: metadata.source,
            generation: metadata.generation,
            revision: 1,
            reason: eouFailureReason(for: failure)
        ))]
    }

    private func eouFailureReason(for failure: EouSessionFailure) -> EouFailureReason {
        switch failure {
        case .streamCapacity, .sequenceOutOfOrder, .audioDiscontinuity:
            return .sequenceOutOfOrder
        case .streamNotFound:
            return .streamNotFound
        case .generationMismatch:
            return .generationMismatch
        case .sourceMismatch:
            return .sourceMismatch
        case .modelUnavailable:
            return .modelUnavailable
        case .inferenceFailed:
            return .inferenceFailed
        case .prefixMutated:
            return .prefixMutated
        case .cancelled:
            return .cancelled
        }
    }

    private func runtimeFailure(for failure: EouSessionFailure) -> RuntimeFailure {
        switch failure {
        case .modelUnavailable:
            return .modelPreparationFailed
        case .inferenceFailed, .prefixMutated:
            return .transcriptionFailed
        case .cancelled:
            return .cancelled
        case .streamCapacity, .streamNotFound, .generationMismatch, .sourceMismatch,
            .sequenceOutOfOrder, .audioDiscontinuity:
            return .invalidRequest
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
        let result = finalPreview == nil && degradations.isEmpty
            ? RuntimeResultPayload()
            : RuntimeResultPayload(
                finalPreview: finalPreview,
                degradations: degradations
            )
        return ParakeetLiveServiceResult(
            response: RuntimeResponse(
                schemaVersion: 1,
                id: id,
                ok: true,
                result: result,
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
