import AVFoundation
import CoreML
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
