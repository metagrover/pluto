import AVFoundation
import CoreML
import CryptoKit
import FluidAudio
import Foundation
import ParakeetRuntimeCore

public enum FluidAudioModelLayout {
    public static let asrDirectoryName = "parakeet-tdt-0.6b-v3-coreml"
    public static let installedAsrDirectoryName = "parakeet-tdt-0.6b-v3"
    public static let ctcDirectoryName = "parakeet-ctc-110m-coreml"
}

public enum ProductionModelManifest {
    public static let current = ModelManifest(
        identifier: "parakeet-tdt-0.6b-v3",
        version: "fluidaudio-0.15.5-asr-aed02740-ctc-accdafd8-int8-verified1",
        repository: "FluidInference/parakeet-tdt-0.6b-v3-coreml",
        repositoryRevision: "aed02740059203c4a87495924f685de3722ae9ce",
        auxiliaryRepository: "FluidInference/parakeet-ctc-110m-coreml",
        auxiliaryRepositoryRevision: "accdafd8cf8a2ff1cabe3c11e54416b405d409aa",
        recognitionArtifactSHA256: "f03b69d2d516896b78676270164b54f7c1fd2add37de4d06f9671752f88c688f",
        vocabularyArtifactSHA256: "b955323ed3f2769beb287c97f172a7dd2ccc7493218a2e6e6b930ccbc41d17d7",
        encoderPrecision: "int8"
    )
}

public struct FluidAudioModelInstaller: ModelInstalling {
    public init() {}

    public func install(manifest: ModelManifest, into stagingDirectory: URL) async throws {
        try await verifyCurrentRevision(
            repository: manifest.repository,
            expected: manifest.repositoryRevision
        )
        try await verifyCurrentRevision(
            repository: manifest.auxiliaryRepository,
            expected: manifest.auxiliaryRepositoryRevision
        )
        let asrDirectory = stagingDirectory.appendingPathComponent(
            FluidAudioModelLayout.asrDirectoryName,
            isDirectory: true
        )
        _ = try await AsrModels.downloadAndLoad(
            to: asrDirectory,
            version: .v3,
            encoderPrecision: .int8,
            encoderComputeUnits: .cpuAndNeuralEngine
        )

        let ctcDirectory = stagingDirectory.appendingPathComponent(
            FluidAudioModelLayout.ctcDirectoryName,
            isDirectory: true
        )
        _ = try await CtcModels.downloadAndLoad(to: ctcDirectory, variant: .ctc110m)
        try ModelArtifactIntegrity.verify(
            directory: stagingDirectory.appendingPathComponent(
                FluidAudioModelLayout.installedAsrDirectoryName,
                isDirectory: true
            ),
            expectedSHA256: manifest.recognitionArtifactSHA256
        )
        try ModelArtifactIntegrity.verify(
            directory: ctcDirectory,
            expectedSHA256: manifest.vocabularyArtifactSHA256
        )
    }

    private func verifyCurrentRevision(repository: String, expected: String) async throws {
        guard !repository.isEmpty, !expected.isEmpty else {
            throw RuntimeFailure.modelPreparationFailed
        }
        let encodedRepository = repository.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? ""
        guard let url = URL(string: "https://huggingface.co/api/models/\(encodedRepository)") else {
            throw RuntimeFailure.modelPreparationFailed
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard
            (response as? HTTPURLResponse)?.statusCode == 200,
            let metadata = try? JSONDecoder().decode(RepositoryMetadata.self, from: data),
            metadata.sha == expected
        else { throw RuntimeFailure.modelPreparationFailed }
    }

    private struct RepositoryMetadata: Decodable {
        let sha: String
    }
}

public actor FluidAudioInferenceDriver: ParakeetInferenceDriving {
    private var manager: AsrManager?
    private var ctcModels: CtcModels?
    private var ctcModelDirectory: URL?

    public init() {}

    public func loadModel(at modelContainerURL: URL) async throws {
        let asrDirectory = modelContainerURL.appendingPathComponent(
            FluidAudioModelLayout.asrDirectoryName,
            isDirectory: true
        )
        let ctcDirectory = modelContainerURL.appendingPathComponent(
            FluidAudioModelLayout.ctcDirectoryName,
            isDirectory: true
        )
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuAndNeuralEngine
        let models = try await AsrModels.load(
            from: asrDirectory,
            configuration: configuration,
            version: .v3,
            encoderPrecision: .int8,
            encoderComputeUnits: .cpuAndNeuralEngine
        )
        let config = ASRConfig(
            tdtConfig: TdtConfig(blankId: AsrModelVersion.v3.blankId),
            encoderHiddenSize: AsrModelVersion.v3.encoderHiddenSize,
            parallelChunkConcurrency: 1,
            streamingEnabled: true
        )
        let loadedManager = AsrManager(config: config)
        try await loadedManager.loadModels(models)
        manager = loadedManager
        ctcModels = try await CtcModels.load(from: ctcDirectory, variant: .ctc110m)
        ctcModelDirectory = ctcDirectory
    }

    public func transcribe(
        audioURL: URL,
        language: String?,
        vocabulary: [String],
        decoderIdentifier _: UUID
    ) async throws -> TranscriptionOutput {
        guard let manager else { throw RuntimeFailure.transcriptionFailed }
        let languageHint = language.flatMap(Language.init(rawValue:))
        var decoderState = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
        var result = try await manager.transcribe(
            audioURL,
            decoderState: &decoderState,
            language: languageHint
        )

        var replacements: [VocabularyReplacement] = []
        if !vocabulary.isEmpty {
            (result, replacements) = try await rescore(
                result,
                audioURL: audioURL,
                vocabulary: vocabulary
            )
        }

        let recognizedWords = buildWordTimings(from: result.tokenTimings ?? []).map {
            TranscriptionWord(
                text: $0.word,
                startSeconds: $0.startTime,
                endSeconds: $0.endTime
            )
        }
        let reconciledWords = reconcileVocabularyTimings(
            words: recognizedWords,
            replacements: replacements
        )
        let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let audioFile = try AVAudioFile(forReading: audioURL)
        let fileDuration = audioFile.processingFormat.sampleRate > 0
            ? Double(audioFile.length) / audioFile.processingFormat.sampleRate
            : 0
        let durationSeconds = max(Double(result.duration), fileDuration)
        let words = try normalizeWordTimings(
            reconciledWords,
            durationSeconds: durationSeconds
        )
        return TranscriptionOutput(
            text: text,
            confidence: Double(result.confidence),
            durationSeconds: durationSeconds,
            words: words,
            noSpeech: text.isEmpty
        )
    }

    private func rescore(
        _ result: ASRResult,
        audioURL: URL,
        vocabulary: [String]
    ) async throws -> (ASRResult, [VocabularyReplacement]) {
        guard
            let ctcModels,
            let ctcModelDirectory,
            let tokenTimings = result.tokenTimings,
            !tokenTimings.isEmpty
        else { return (result, []) }

        let tokenizer = try await CtcTokenizer.load(from: ctcModelDirectory)
        let terms = vocabulary.prefix(100).compactMap { rawTerm -> CustomVocabularyTerm? in
            let term = rawTerm.trimmingCharacters(in: .whitespacesAndNewlines)
            guard term.count >= 3, term.count <= 100 else { return nil }
            return CustomVocabularyTerm(text: term, ctcTokenIds: tokenizer.encode(term))
        }
        guard !terms.isEmpty else { return (result, []) }

        let context = CustomVocabularyContext(terms: terms)
        let spotter = CtcKeywordSpotter(models: ctcModels, blankId: ctcModels.vocabulary.count)
        let samples = try AudioConverter().resampleAudioFile(audioURL)
        let spotted = try await spotter.spotKeywordsWithLogProbs(
            audioSamples: samples,
            customVocabulary: context
        )
        guard !spotted.logProbs.isEmpty else { return (result, []) }
        let rescorer = try await VocabularyRescorer.create(
            spotter: spotter,
            vocabulary: context,
            ctcModelDirectory: ctcModelDirectory
        )
        let policy = ContextBiasingConstants.rescorerConfig(forVocabSize: terms.count)
        let rescored = rescorer.ctcTokenRescore(
            transcript: result.text,
            tokenTimings: tokenTimings,
            logProbs: spotted.logProbs,
            frameDuration: spotted.frameDuration,
            cbw: policy.cbw,
            marginSeconds: ContextBiasingConstants.defaultMarginSeconds,
            minSimilarity: policy.minSimilarity
        )
        guard rescored.wasModified else { return (result, []) }
        let appliedReplacements: [VocabularyReplacement] = rescored.replacements.compactMap { replacement in
            guard replacement.shouldReplace, let replacementWord = replacement.replacementWord else {
                return nil
            }
            return VocabularyReplacement(
                original: replacement.originalWord,
                replacement: replacementWord
            )
        }
        return (
            result.withRescoring(
                text: rescored.text,
                detected: rescored.replacements.map(\.originalWord),
                applied: appliedReplacements.map(\.replacement)
            ),
            appliedReplacements
        )
    }
}

public actor FluidAudioLiveDriver: ParakeetLiveDriving {
    private let modelLoader: SingleFlightModelLoader<AsrModels>

    public init() {
        AppLogger.setProcessLogging(.disabled)
        modelLoader = SingleFlightModelLoader<AsrModels>()
    }

    public func capabilities() async -> ParakeetLiveDriverCapabilities {
        .required
    }

    public func makeManager(request: ParakeetLiveManagerRequest) async throws
        -> any ParakeetLiveManaging
    {
        AppLogger.setProcessLogging(.disabled)
        let modelURL = request.activeModelURL.standardizedFileURL
        let models = try await modelLoader.load(at: modelURL) {
            let asrDirectory = modelURL.appendingPathComponent(
                FluidAudioModelLayout.asrDirectoryName,
                isDirectory: true
            )
            let configuration = MLModelConfiguration()
            configuration.computeUnits = .cpuAndNeuralEngine
            return try await AsrModels.load(
                from: asrDirectory,
                configuration: configuration,
                version: .v3,
                encoderPrecision: .int8,
                encoderComputeUnits: .cpuAndNeuralEngine
            )
        }

        let liveConfiguration = request.configuration
        let slidingConfiguration = SlidingWindowAsrConfig(
            chunkSeconds: liveConfiguration.chunkSeconds,
            hypothesisChunkSeconds: liveConfiguration.hypothesisChunkSeconds,
            leftContextSeconds: liveConfiguration.leftContextSeconds,
            rightContextSeconds: liveConfiguration.rightContextSeconds,
            minContextForConfirmation: liveConfiguration.minContextForConfirmation,
            confirmationThreshold: liveConfiguration.confirmationThreshold,
            tdtConfig: TdtConfig(blankId: AsrModelVersion.v3.blankId)
        )
        let manager = SlidingWindowAsrManager(config: slidingConfiguration)
        try await manager.loadModels(models)
        try await manager.startStreaming(
            source: request.source == .mic ? .microphone : .system
        )
        return FluidAudioLiveManager(
            backend: manager, streamId: request.streamId,
            source: request.source, generation: request.generation
        )
    }
}

protocol FluidAudioAcknowledgedLiveBackend: Sendable {
    func ingestAudio(
        _ buffer: sending AVAudioPCMBuffer,
        receipt: String
    ) async throws -> SlidingWindowIngestionReport
    func finishDetailed() async throws -> SlidingWindowFinishReport
    func cancel() async
}

extension SlidingWindowAsrManager: FluidAudioAcknowledgedLiveBackend {}

actor FluidAudioLiveManager: ParakeetLiveManaging {
    private enum Lifecycle { case open, finishing, finished, cancelled }

    private let backend: any FluidAudioAcknowledgedLiveBackend
    private let streamId: String
    private let source: LiveSource
    private let generation: Int
    private var lifecycle = Lifecycle.open
    private var nextAcceptedSample = 0
    private var activeReceipt: String?

    init(
        backend: any FluidAudioAcknowledgedLiveBackend,
        streamId: String, source: LiveSource, generation: Int
    ) {
        self.backend = backend
        self.streamId = streamId
        self.source = source
        self.generation = generation
    }

    func append(request: ParakeetLiveAppendRequest) async throws -> LiveDriverAppendOutcome {
        guard lifecycle == .open, activeReceipt == nil else {
            throw LiveRuntimeFailure.cancelled
        }
        guard request.streamId == streamId, request.source == source,
            request.generation == generation
        else { throw LiveRuntimeFailure.inferenceFailed }
        let buffer = try Self.makeCanonicalBuffer(audioURL: request.audioURL)
        let startSample = nextAcceptedSample
        let endSample = startSample + Int(buffer.frameLength)
        let receipt = makeReceipt(
            request: request, startSample: startSample, endSample: endSample
        )
        activeReceipt = receipt
        let report: SlidingWindowIngestionReport
        do {
            report = try await backend.ingestAudio(buffer, receipt: receipt)
        } catch {
            if activeReceipt == receipt { activeReceipt = nil }
            guard lifecycle == .open else { throw LiveRuntimeFailure.cancelled }
            throw LiveRuntimeFailure.inferenceFailed
        }
        guard lifecycle == .open, activeReceipt == receipt else {
            throw LiveRuntimeFailure.cancelled
        }
        activeReceipt = nil
        guard report.receipt == receipt,
            report.acceptedSamples
                == SlidingWindowSampleRange(startSample: startSample, endSample: endSample)
        else { throw LiveRuntimeFailure.inferenceFailed }
        nextAcceptedSample = endSample
        return try mapAppendReport(report)
    }

    func finish() async throws -> LiveDriverFinishOutcome {
        guard lifecycle == .open, activeReceipt == nil else {
            throw LiveRuntimeFailure.cancelled
        }
        lifecycle = .finishing
        let report: SlidingWindowFinishReport
        do { report = try await backend.finishDetailed() } catch {
            guard lifecycle == .finishing else { throw LiveRuntimeFailure.cancelled }
            lifecycle = .cancelled
            throw LiveRuntimeFailure.inferenceFailed
        }
        guard lifecycle == .finishing else { throw LiveRuntimeFailure.cancelled }
        lifecycle = .finished
        let mapped = try mapReport(
            attempted: report.attemptedCenterRanges,
            processed: report.processedCenterRanges,
            failed: report.failedCenterRanges,
            updates: report.finalUpdates
        )
        return LiveDriverFinishOutcome(
            finalText: report.finalTranscript,
            updates: mapped.updates,
            degradations: mapped.degradations
        )
    }

    func cancel() async {
        guard lifecycle != .cancelled, lifecycle != .finished else { return }
        lifecycle = .cancelled
        activeReceipt = nil
        await backend.cancel()
    }

    nonisolated private static func makeCanonicalBuffer(
        audioURL: URL
    ) throws -> AVAudioPCMBuffer {
        let audioFile = try AVAudioFile(forReading: audioURL)
        let frameCount = AVAudioFrameCount(audioFile.length)
        guard
            frameCount > 0,
            let buffer = AVAudioPCMBuffer(
                pcmFormat: audioFile.processingFormat,
                frameCapacity: frameCount
            )
        else { throw RuntimeFailure.transcriptionFailed }
        try audioFile.read(into: buffer)
        let samples = try AudioConverter().resampleBuffer(buffer)
        guard !samples.isEmpty,
            let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: 16_000,
                channels: 1, interleaved: false
            ),
            let canonical = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(samples.count)
            ),
            let channel = canonical.floatChannelData?[0]
        else { throw RuntimeFailure.transcriptionFailed }
        canonical.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            channel.update(from: source.baseAddress!, count: samples.count)
        }
        return canonical
    }

    private func makeReceipt(
        request: ParakeetLiveAppendRequest, startSample: Int, endSample: Int
    ) -> String {
        let sourceValue = request.source == .mic ? "mic" : "system"
        let identity = [
            "pluto-live-v1", request.streamId, sourceValue,
            String(request.generation), String(request.sequence),
            String(request.chunkStartSeconds.bitPattern),
            String(request.chunkEndSeconds.bitPattern),
            String(startSample), String(endSample),
        ].joined(separator: "|")
        return SHA256.hash(data: Data(identity.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    private func mapAppendReport(
        _ report: SlidingWindowIngestionReport
    ) throws -> LiveDriverAppendOutcome {
        let mapped = try mapReport(
            attempted: report.attemptedCenterRanges,
            processed: report.processedCenterRanges,
            failed: report.failedCenterRanges,
            updates: report.updates
        )
        return LiveDriverAppendOutcome(
            updates: mapped.updates, degradations: mapped.degradations
        )
    }

    private func mapReport(
        attempted: [SlidingWindowSampleRange],
        processed: [SlidingWindowSampleRange],
        failed: [SlidingWindowFailedRange],
        updates: [SlidingWindowTranscriptionUpdate]
    ) throws -> (updates: [LiveDriverUpdate], degradations: [LiveDriverDegradation]) {
        guard updates.count == processed.count else {
            throw LiveRuntimeFailure.inferenceFailed
        }
        guard processed.allSatisfy({ attempted.contains($0) }),
            failed.allSatisfy({ attempted.contains($0.centerRange) })
        else { throw LiveRuntimeFailure.inferenceFailed }

        var mappedUpdates: [LiveDriverUpdate] = []
        for (range, update) in zip(processed, updates) {
            mappedUpdates.append(LiveDriverUpdate(
                text: update.text,
                isConfirmed: update.isConfirmed,
                confidence: Double(update.confidence),
                processedAudioEndSeconds: seconds(range.endSample)
            ))
        }
        var degradations: [LiveDriverDegradation] = []
        for range in attempted {
            let processedMatches = processed.filter { $0 == range }.count
            let failedMatches = failed.filter { $0.centerRange == range }.count
            guard processedMatches + failedMatches <= 1 else {
                throw LiveRuntimeFailure.inferenceFailed
            }
            if failedMatches == 1 {
                degradations.append(degradation(reason: .partialWindow, range: range))
            } else if processedMatches == 0 {
                degradations.append(degradation(reason: .coverageGap, range: range))
            }
        }
        return (mappedUpdates, degradations)
    }

    private func degradation(
        reason: LiveDegradationReason, range: SlidingWindowSampleRange
    ) -> LiveDriverDegradation {
        LiveDriverDegradation(
            reason: reason, startSeconds: seconds(range.startSample),
            endSeconds: seconds(range.endSample)
        )
    }

    private func seconds(_ sample: Int) -> Double {
        Double(sample) / 16_000
    }
}

public actor SingleFlightModelLoader<Model: Sendable> {
    private struct InFlight: Sendable {
        let token: UUID
        let modelURL: URL
        let task: Task<Model, Error>
    }

    private var loadedModelURL: URL?
    private var loadedModel: Model?
    private var inFlight: InFlight?

    public init() {}

    public func load(
        at modelURL: URL,
        operation: @escaping @Sendable () async throws -> Model
    ) async throws -> Model {
        let standardizedURL = modelURL.standardizedFileURL
        if loadedModelURL == standardizedURL, let loadedModel { return loadedModel }
        if let inFlight, inFlight.modelURL == standardizedURL {
            return try await inFlight.task.value
        }

        let token = UUID()
        let task = Task { try await operation() }
        inFlight = InFlight(token: token, modelURL: standardizedURL, task: task)
        do {
            let model = try await task.value
            if inFlight?.token == token {
                loadedModelURL = standardizedURL
                loadedModel = model
                inFlight = nil
            }
            return model
        } catch {
            if inFlight?.token == token { inFlight = nil }
            throw error
        }
    }
}
