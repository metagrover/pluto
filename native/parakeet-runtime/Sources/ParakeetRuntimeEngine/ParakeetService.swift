import Foundation
import ParakeetRuntimeCore

public actor ParakeetService {
    private let modelRoot: URL
    private let audioRoot: URL
    private let manifest: ModelManifest
    private let modelStore: ModelStore
    private let transcriber: ParakeetTranscriber
    private var activeModelURL: URL?

    public init(
        modelRoot: URL,
        audioRoot: URL,
        manifest: ModelManifest,
        installer: any ModelInstalling = FluidAudioModelInstaller(),
        inferenceDriver: any ParakeetInferenceDriving = FluidAudioInferenceDriver()
    ) {
        self.modelRoot = modelRoot.standardizedFileURL
        self.audioRoot = audioRoot.standardizedFileURL
        self.manifest = manifest
        self.modelStore = ModelStore(root: self.modelRoot, installer: installer)
        self.transcriber = ParakeetTranscriber(driver: inferenceDriver)
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
        case .cancel, .shutdown:
            return .failure(id: request.id, code: .invalidRequest)
        }
    }

    private func prepare(_ request: RuntimeRequest) async -> RuntimeResponse {
        guard request.modelRoot == nil || request.modelRoot == modelRoot.path else {
            return .failure(id: request.id, code: .pathNotAllowed)
        }
        do {
            activeModelURL = try await modelStore.prepare(manifest: manifest)
            return .prepared(id: request.id, modelVersion: manifest.version)
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
}
