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
    public static let eouDirectoryName = "parakeet-eou-streaming/320ms"
}

public enum ProductionModelManifest {
    public static let current = ModelManifest(
        identifier: "parakeet-tdt-0.6b-v3",
        version: "fluidaudio-0.15.5-asr-aed02740-ctc-accdafd8-eou-40a23f4c-int8-verified2",
        repository: "FluidInference/parakeet-tdt-0.6b-v3-coreml",
        repositoryRevision: "aed02740059203c4a87495924f685de3722ae9ce",
        auxiliaryRepository: "FluidInference/parakeet-ctc-110m-coreml",
        auxiliaryRepositoryRevision: "accdafd8cf8a2ff1cabe3c11e54416b405d409aa",
        eouRepository: "FluidInference/parakeet-realtime-eou-120m-coreml",
        eouRepositoryRevision: "40a23f4c0b333aa17ad8c0f2ea47ec2347f2f355",
        recognitionArtifactSHA256: "f03b69d2d516896b78676270164b54f7c1fd2add37de4d06f9671752f88c688f",
        vocabularyArtifactSHA256: "b955323ed3f2769beb287c97f172a7dd2ccc7493218a2e6e6b930ccbc41d17d7",
        eouArtifactSHA256: "0ee0eb312901156faf2bd60159204ed8e05bf993d5dee79dc69b753583fa0ad6",
        encoderPrecision: "int8"
    )
}

public struct DiarizationModelManifest: Equatable, Sendable {
    public let identifier: String
    public let repository: String
    public let revision: String
    public let requiredArtifacts: [String]
    public let artifactSHA256: String

    public init(
        identifier: String,
        repository: String,
        revision: String,
        requiredArtifacts: [String],
        artifactSHA256: String
    ) {
        self.identifier = identifier
        self.repository = repository
        self.revision = revision
        self.requiredArtifacts = requiredArtifacts
        self.artifactSHA256 = artifactSHA256
    }
}

public enum ProductionDiarizationManifest {
    public static let current = DiarizationModelManifest(
        identifier: "speaker-diarization-offline-v1",
        repository: "FluidInference/speaker-diarization-coreml",
        revision: "1ed7a662fdc7109e36d822db793ee6eebdaf8594",
        requiredArtifacts: [
            "Segmentation.mlmodelc",
            "FBank.mlmodelc",
            "Embedding.mlmodelc",
            "PldaRho.mlmodelc",
            "plda-parameters.json",
        ],
        artifactSHA256: "e0b6b63bdb2a12d087031067d61600f5e2b6b9a26f9c9e511118d2a6206349cd"
    )
}

protocol RepositoryRevisionChecking: Sendable {
    func require(repository: String, revision: String) async throws
}

protocol FluidAudioModelBundleDownloading: Sendable {
    func download(
        into stagingDirectory: URL,
        manifest: ModelManifest,
        progressHandler: ModelPreparationProgressHandler?
    ) async throws
}

func aggregatedModelPreparationProgress(
    _ progress: DownloadProgress,
    completedBefore: Int64,
    componentBytes: Int64,
    totalBytes: Int64
) -> ModelPreparationProgress? {
    switch progress.phase {
    case .downloading:
        guard progress.totalBytes > 0 else { return nil }
        return ModelPreparationProgress(
            phase: .downloading,
            downloadedBytes: completedBefore + min(progress.completedBytes, componentBytes),
            totalBytes: totalBytes
        )
    case .compiling:
        return ModelPreparationProgress(
            phase: .loading,
            downloadedBytes: completedBefore + componentBytes,
            totalBytes: totalBytes
        )
    case .listing:
        return nil
    }
}

func huggingFaceRevisionMetadataURL(repository: String, revision: String) -> URL? {
    guard !repository.isEmpty, !revision.isEmpty else { return nil }
    let encodedRepository = repository
        .split(separator: "/", omittingEmptySubsequences: false)
        .map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "" }
        .joined(separator: "/")
    let encodedRevision = revision.addingPercentEncoding(
        withAllowedCharacters: .urlPathAllowed
    ) ?? ""
    return URL(
        string: "https://huggingface.co/api/models/\(encodedRepository)/revision/\(encodedRevision)"
    )
}

private struct HuggingFaceRepositoryRevisionChecker: RepositoryRevisionChecking {
    func require(repository: String, revision: String) async throws {
        guard let url = huggingFaceRevisionMetadataURL(
            repository: repository,
            revision: revision
        ) else {
            throw RuntimeFailure.modelPreparationFailed
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard
            (response as? HTTPURLResponse)?.statusCode == 200,
            let metadata = try? JSONDecoder().decode(RepositoryMetadata.self, from: data),
            metadata.sha == revision
        else { throw RuntimeFailure.modelPreparationFailed }
    }

    private struct RepositoryMetadata: Decodable {
        let sha: String
    }
}

private struct FluidAudioProductionBundleDownloader: FluidAudioModelBundleDownloading {
    func download(
        into stagingDirectory: URL,
        manifest: ModelManifest,
        progressHandler: ModelPreparationProgressHandler?
    ) async throws {
        ModelRegistry.setPinnedRevision(manifest.repositoryRevision, for: manifest.repository)
        ModelRegistry.setPinnedRevision(
            manifest.auxiliaryRepositoryRevision,
            for: manifest.auxiliaryRepository
        )
        ModelRegistry.setPinnedRevision(
            manifest.eouRepositoryRevision,
            for: manifest.eouRepository
        )
        defer {
            ModelRegistry.setPinnedRevision(nil, for: manifest.repository)
            ModelRegistry.setPinnedRevision(nil, for: manifest.auxiliaryRepository)
            ModelRegistry.setPinnedRevision(nil, for: manifest.eouRepository)
        }

        progressHandler?(ModelPreparationProgress(
            phase: .sizing,
            downloadedBytes: 0,
            totalBytes: 0
        ))
        let asrBytes = try await ModelHub.requiredDownloadSize(.parakeetV3, variant: "int8")
        let ctcBytes = try await ModelHub.requiredDownloadSize(.parakeetCtc110m)
        let eouBytes = try await ModelHub.requiredDownloadSize(.parakeetEou320)
        let totalBytes = asrBytes + ctcBytes + eouBytes
        guard totalBytes > 0 else { throw RuntimeFailure.modelPreparationFailed }
        progressHandler?(ModelPreparationProgress(
            phase: .downloading,
            downloadedBytes: 0,
            totalBytes: totalBytes
        ))

        let asrProgress = aggregateProgress(
            completedBefore: 0,
            componentBytes: asrBytes,
            totalBytes: totalBytes,
            progressHandler: progressHandler
        )

        let asrDirectory = stagingDirectory.appendingPathComponent(
            FluidAudioModelLayout.asrDirectoryName,
            isDirectory: true
        )
        _ = try await AsrModels.downloadAndLoad(
            to: asrDirectory,
            version: .v3,
            encoderPrecision: .int8,
            encoderComputeUnits: .cpuAndNeuralEngine,
            progressHandler: asrProgress
        )

        let ctcProgress = aggregateProgress(
            completedBefore: asrBytes,
            componentBytes: ctcBytes,
            totalBytes: totalBytes,
            progressHandler: progressHandler
        )

        let ctcDirectory = stagingDirectory.appendingPathComponent(
            FluidAudioModelLayout.ctcDirectoryName,
            isDirectory: true
        )
        _ = try await CtcModels.downloadAndLoad(
            to: ctcDirectory,
            variant: .ctc110m,
            progressHandler: ctcProgress
        )
        let eouProgress = aggregateProgress(
            completedBefore: asrBytes + ctcBytes,
            componentBytes: eouBytes,
            totalBytes: totalBytes,
            progressHandler: progressHandler
        )
        try await ModelHub.download(
            .parakeetEou320,
            to: stagingDirectory,
            progressHandler: eouProgress
        )
        progressHandler?(ModelPreparationProgress(
            phase: .verifying,
            downloadedBytes: totalBytes,
            totalBytes: totalBytes
        ))
    }

    private func aggregateProgress(
        completedBefore: Int64,
        componentBytes: Int64,
        totalBytes: Int64,
        progressHandler: ModelPreparationProgressHandler?
    ) -> ProgressHandler? {
        guard let progressHandler else { return nil }
        return { progress in
            guard let aggregated = aggregatedModelPreparationProgress(
                progress,
                completedBefore: completedBefore,
                componentBytes: componentBytes,
                totalBytes: totalBytes
            ) else { return }
            progressHandler(aggregated)
        }
    }
}

public struct FluidAudioModelInstaller: ModelInstalling {
    private let revisionChecker: any RepositoryRevisionChecking
    private let downloader: any FluidAudioModelBundleDownloading

    public init() {
        revisionChecker = HuggingFaceRepositoryRevisionChecker()
        downloader = FluidAudioProductionBundleDownloader()
    }

    init(
        revisionChecker: any RepositoryRevisionChecking,
        downloader: any FluidAudioModelBundleDownloading
    ) {
        self.revisionChecker = revisionChecker
        self.downloader = downloader
    }

    public func install(
        manifest: ModelManifest,
        into stagingDirectory: URL,
        progressHandler: ModelPreparationProgressHandler? = nil
    ) async throws {
        try await revisionChecker.require(
            repository: manifest.repository,
            revision: manifest.repositoryRevision
        )
        try await revisionChecker.require(
            repository: manifest.auxiliaryRepository,
            revision: manifest.auxiliaryRepositoryRevision
        )
        try await revisionChecker.require(
            repository: manifest.eouRepository,
            revision: manifest.eouRepositoryRevision
        )
        try await downloader.download(
            into: stagingDirectory,
            manifest: manifest,
            progressHandler: progressHandler
        )
        let ctcDirectory = stagingDirectory.appendingPathComponent(
            FluidAudioModelLayout.ctcDirectoryName,
            isDirectory: true
        )
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
        try ModelArtifactIntegrity.verify(
            directory: stagingDirectory.appendingPathComponent(
                FluidAudioModelLayout.eouDirectoryName,
                isDirectory: true
            ),
            expectedSHA256: manifest.eouArtifactSHA256
        )
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
        decoderIdentifier: UUID
    ) async throws -> TranscriptionOutput {
        try await transcribe(
            audioInput: .fileURL(audioURL),
            language: language,
            vocabulary: vocabulary,
            decoderIdentifier: decoderIdentifier
        )
    }

    public func transcribe(
        audioInput: AudioInput,
        language: String?,
        vocabulary: [String],
        decoderIdentifier _: UUID
    ) async throws -> TranscriptionOutput {
        guard let manager else { throw RuntimeFailure.transcriptionFailed }
        let languageHint = language.flatMap(Language.init(rawValue:))
        var decoderState = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
        let resultAndDuration: (ASRResult, Double, [Float]?, (any AudioSampleSource)?)
        switch audioInput {
        case .fileURL(let audioURL):
            let result = try await manager.transcribe(
                audioURL,
                decoderState: &decoderState,
                language: languageHint
            )
            let audioFile = try AVAudioFile(forReading: audioURL)
            let duration = audioFile.processingFormat.sampleRate > 0
                ? Double(audioFile.length) / audioFile.processingFormat.sampleRate
                : 0
            resultAndDuration = (result, duration, nil, nil)
        case .pcmSamples(let samples, let sampleRate):
            let normalized = sampleRate == 16_000
                ? samples
                : try AudioConverter().resample(samples, from: sampleRate)
            let result = try await manager.transcribe(
                normalized,
                decoderState: &decoderState,
                language: languageHint
            )
            resultAndDuration = (result, Double(normalized.count) / 16_000, normalized, nil)
        case .encryptedReader(let reader):
            guard reader.sampleRate == 16_000 else {
                throw RuntimeFailure.transcriptionFailed
            }
            let source = EncryptedAudioSampleSource(reader: reader)
            let result = try await manager.transcribe(
                source,
                decoderState: &decoderState,
                language: languageHint
            )
            resultAndDuration = (
                result,
                Double(source.sampleCount) / 16_000,
                nil,
                source
            )
        }

        var result = resultAndDuration.0

        var replacements: [VocabularyReplacement] = []
        if !vocabulary.isEmpty {
            switch audioInput {
            case .fileURL(let audioURL):
                (result, replacements) = try await rescore(
                    result,
                    samples: try AudioConverter().resampleAudioFile(audioURL),
                    vocabulary: vocabulary
                )
            case .pcmSamples:
                (result, replacements) = try await rescore(
                    result,
                    samples: resultAndDuration.2 ?? [],
                    vocabulary: vocabulary
                )
            case .encryptedReader:
                guard let source = resultAndDuration.3 else {
                    throw RuntimeFailure.transcriptionFailed
                }
                (result, replacements) = try await rescore(
                    result,
                    sampleSource: source,
                    vocabulary: vocabulary
                )
            }
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
        let durationSeconds = max(Double(result.duration), resultAndDuration.1)
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
        samples: [Float] = [],
        sampleSource: (any AudioSampleSource)? = nil,
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
        let spotted = if let sampleSource {
            try await spotter.spotKeywordsWithLogProbs(
                audioSource: sampleSource,
                customVocabulary: context
            )
        } else {
            try await spotter.spotKeywordsWithLogProbs(
                audioSamples: samples,
                customVocabulary: context
            )
        }
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

protocol FluidAudioEouBackend: Sendable {
    func setPartialCallback(_ callback: @escaping @Sendable (String) -> Void) async
    func setEouCallback(_ callback: @escaping @Sendable (String) -> Void) async
    func process(audioBuffer: sending AVAudioPCMBuffer) async throws -> String
    func finish() async throws -> String
    func getTokenTimestampsMs() async -> [Int]
    func getRawTokenStrings() async -> [String]
    func getEouTimestampsMs() async -> [Int]
    func cleanup() async
}

extension StreamingEouAsrManager: FluidAudioEouBackend {
    func setPartialCallback(_ callback: @escaping @Sendable (String) -> Void) {
        setPartialTranscriptCallback(callback)
    }
}

private final class FluidAudioEouCallbackCollector: @unchecked Sendable {
    private struct Callback {
        let kind: ParakeetEouSnapshotKind
        let transcript: String
    }

    private let lock = NSLock()
    private var callbacks: [Callback] = []

    func append(kind: ParakeetEouSnapshotKind, transcript: String) {
        lock.lock()
        callbacks.append(Callback(kind: kind, transcript: transcript))
        lock.unlock()
    }

    func drain() -> [(ParakeetEouSnapshotKind, String)] {
        lock.lock()
        let drained = callbacks.map { ($0.kind, $0.transcript) }
        callbacks.removeAll(keepingCapacity: true)
        lock.unlock()
        return drained
    }
}

actor FluidAudioEouManager: ParakeetEouManaging {
    private let backend: any FluidAudioEouBackend
    private let collector: FluidAudioEouCallbackCollector
    private let maxPendingSeconds: Double
    private var pendingSinceAudioSeconds: Double?
    private var pendingSnapshot: ParakeetEouManagerSnapshot?
    private var pendingNativeEou = false
    private var pendingNativeEouTailStable = false
    private var committedTokenCount = 0
    private var closed = false

    init(
        backend: any FluidAudioEouBackend,
        // Keep continuous speech readable while retaining the unfinished word.
        maxPendingSeconds: Double = 5
    ) async {
        precondition(maxPendingSeconds.isFinite && maxPendingSeconds > 0)
        let collector = FluidAudioEouCallbackCollector()
        self.backend = backend
        self.collector = collector
        self.maxPendingSeconds = maxPendingSeconds
        await backend.setPartialCallback { transcript in
            collector.append(kind: .partial, transcript: transcript)
        }
        await backend.setEouCallback { transcript in
            collector.append(kind: .eou, transcript: transcript)
        }
    }

    func append(_ frame: EouPcmFrame) async throws -> [ParakeetEouManagerSnapshot] {
        guard !closed else { throw EouSessionFailure.cancelled }
        guard
            let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: Double(frame.sampleRate),
                channels: 1,
                interleaved: false
            ),
            let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(frame.frameCount)
            ),
            let channel = buffer.floatChannelData?[0]
        else { throw EouSessionFailure.inferenceFailed }

        let samples = frame.samples
        samples.withUnsafeBufferPointer { source in
            guard let base = source.baseAddress else { return }
            channel.update(from: base, count: samples.count)
        }
        buffer.frameLength = AVAudioFrameCount(frame.frameCount)
        _ = try await backend.process(audioBuffer: buffer)
        let snapshots = await snapshots(from: collector.drain())
        return boundPendingSnapshots(
            snapshots,
            audioEndSeconds: frame.audioEndSeconds
        )
    }

    func finish() async throws -> [ParakeetEouManagerSnapshot] {
        guard !closed else { throw EouSessionFailure.cancelled }
        closed = true
        let tokens = await currentTokens()
        let transcript: String
        do {
            transcript = try await backend.finish()
        } catch {
            await backend.cleanup()
            throw error
        }
        var snapshots = collector.drain().map { callback in
            ParakeetEouManagerSnapshot(
                kind: callback.0,
                transcript: callback.1,
                tokens: tokens
            )
        }
        if !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            snapshots.append(.final(transcript, tokens: tokens))
        }
        await backend.cleanup()
        return snapshots
    }

    func cancel() async {
        guard !closed else { return }
        closed = true
        _ = collector.drain()
        await backend.cleanup()
    }

    private func snapshots(
        from callbacks: [(ParakeetEouSnapshotKind, String)]
    ) async -> [ParakeetEouManagerSnapshot] {
        let tokens = await currentTokens()
        return callbacks.map { callback in
            ParakeetEouManagerSnapshot(
                kind: callback.0,
                transcript: callback.1,
                tokens: tokenPrefix(matching: callback.1, from: tokens)
            )
        }
    }

    private func boundPendingSnapshots(
        _ snapshots: [ParakeetEouManagerSnapshot],
        audioEndSeconds: Double
    ) -> [ParakeetEouManagerSnapshot] {
        var bounded: [ParakeetEouManagerSnapshot] = []
        for snapshot in snapshots {
            switch snapshot.kind {
            case .final:
                bounded.append(snapshot)
                committedTokenCount = snapshot.tokens.count
                pendingSinceAudioSeconds = nil
                pendingSnapshot = nil
                pendingNativeEou = false
                pendingNativeEouTailStable = false
            case .eou:
                let partial = ParakeetEouManagerSnapshot(
                    kind: .partial,
                    transcript: snapshot.transcript,
                    tokens: snapshot.tokens
                )
                trackPending(partial, audioEndSeconds: audioEndSeconds)
                pendingNativeEou = true
                pendingNativeEouTailStable = true
                if bounded.last?.kind != .partial
                    || bounded.last?.transcript != partial.transcript
                {
                    bounded.append(partial)
                }
            case .partial:
                if pendingNativeEou,
                    pendingSnapshot?.transcript != snapshot.transcript
                {
                    pendingNativeEouTailStable = false
                }
                trackPending(snapshot, audioEndSeconds: audioEndSeconds)
                bounded.append(snapshot)
            }
        }
        let pendingTimedOut = pendingSinceAudioSeconds.map {
            audioEndSeconds - $0 >= maxPendingSeconds
        } ?? false
        guard
            let pendingSnapshot,
            pendingNativeEou || pendingTimedOut,
            let checkpoint = pendingNativeEou
                && pendingNativeEouTailStable
                && pendingTimedOut
                ? ParakeetEouManagerSnapshot.eou(
                    pendingSnapshot.transcript,
                    tokens: pendingSnapshot.tokens
                )
                : wordSafeCheckpoint(from: pendingSnapshot)
        else { return bounded }

        bounded.removeAll { $0.kind == .partial }
        bounded.append(checkpoint)
        committedTokenCount = checkpoint.tokens.count
        pendingNativeEou = pendingNativeEou
            && pendingNativeEouTailStable
            && pendingSnapshot.tokens.count > committedTokenCount
        if !pendingNativeEou {
            pendingNativeEouTailStable = false
        }
        if pendingSnapshot.tokens.count > committedTokenCount {
            bounded.append(pendingSnapshot)
            self.pendingSinceAudioSeconds = audioEndSeconds
        } else {
            self.pendingSinceAudioSeconds = nil
            self.pendingSnapshot = nil
        }
        return bounded
    }

    private func trackPending(
        _ snapshot: ParakeetEouManagerSnapshot,
        audioEndSeconds: Double
    ) {
        pendingSnapshot = snapshot
        if snapshot.tokens.count > committedTokenCount,
            !snapshot.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            pendingSinceAudioSeconds == nil
        {
            pendingSinceAudioSeconds = audioEndSeconds
        }
    }

    private func wordSafeCheckpoint(
        from partial: ParakeetEouManagerSnapshot
    ) -> ParakeetEouManagerSnapshot? {
        guard let nextWordIndex = partial.tokens.indices.last(where: { index in
            index > committedTokenCount && startsWord(partial.tokens[index].text)
        }) else { return nil }
        let tokens = Array(partial.tokens.prefix(nextWordIndex))
        guard tokens.count > committedTokenCount else { return nil }
        return .eou(decodedTranscript(from: tokens), tokens: tokens)
    }

    private func tokenPrefix(
        matching transcript: String,
        from tokens: [ParakeetEouManagerToken]
    ) -> [ParakeetEouManagerToken] {
        let target = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return [] }
        let targetByteCount = target.utf8.count
        var decoded = ""
        decoded.reserveCapacity(targetByteCount)
        var decodedByteCount = 0
        for endIndex in tokens.indices {
            var piece = tokens[endIndex].text.replacingOccurrences(of: "▁", with: " ")
            if decoded.isEmpty {
                piece = String(piece.drop(while: \.isWhitespace))
            }
            decoded.append(piece)
            decodedByteCount += piece.utf8.count
            if decodedByteCount == targetByteCount, decoded == target {
                return Array(tokens.prefix(endIndex + 1))
            }
            if decodedByteCount >= targetByteCount { break }
        }
        return tokens
    }

    private func decodedTranscript(from tokens: [ParakeetEouManagerToken]) -> String {
        tokens.map(\.text).joined()
            .replacingOccurrences(of: "▁", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func startsWord(_ token: String) -> Bool {
        token.hasPrefix("▁") || token.first?.isWhitespace == true
    }

    private func currentTokens() async -> [ParakeetEouManagerToken] {
        let timestamps = await backend.getTokenTimestampsMs()
        let rawTokens = await backend.getRawTokenStrings()
        return rawTokens.enumerated().compactMap { index, text in
            guard timestamps.indices.contains(index) else { return nil }
            let start = Double(timestamps[index]) / 1_000
            let next = timestamps.indices.contains(index + 1)
                ? Double(timestamps[index + 1]) / 1_000
                : start + 0.08
            return ParakeetEouManagerToken(
                text: text,
                startSeconds: start,
                endSeconds: max(start, next)
            )
        }
    }
}

public actor FluidAudioEouDriver: ParakeetEouDriving {
    public init() {
        AppLogger.setProcessLogging(.disabled)
    }

    public func makeManager(request: ParakeetEouManagerRequest) async throws
        -> any ParakeetEouManaging
    {
        AppLogger.setProcessLogging(.disabled)
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuAndNeuralEngine
        let backend = StreamingEouAsrManager(
            configuration: configuration,
            chunkSize: .ms320,
            debugFeatures: false
        )
        try await backend.loadModels(from: request.activeModelURL.appendingPathComponent(
            FluidAudioModelLayout.eouDirectoryName,
            isDirectory: true
        ))
        return await FluidAudioEouManager(backend: backend)
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
