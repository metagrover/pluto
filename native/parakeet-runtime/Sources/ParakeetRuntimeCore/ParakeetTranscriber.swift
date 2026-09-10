import Foundation

public struct TranscriptionWord: Codable, Equatable, Sendable {
    public let text: String
    public let startSeconds: Double
    public let endSeconds: Double
    public let confidence: Double?

    public init(text: String, startSeconds: Double, endSeconds: Double, confidence: Double? = nil) {
        self.text = text
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
        self.confidence = confidence
    }
}

public struct TranscriptionOutput: Codable, Equatable, Sendable {
    public let text: String
    public let confidence: Double
    public let durationSeconds: Double
    public let words: [TranscriptionWord]
    public let noSpeech: Bool

    public init(
        text: String,
        confidence: Double,
        durationSeconds: Double,
        words: [TranscriptionWord],
        noSpeech: Bool
    ) {
        self.text = text
        self.confidence = confidence
        self.durationSeconds = durationSeconds
        self.words = words
        self.noSpeech = noSpeech
    }
}

public protocol ParakeetInferenceDriving: Sendable {
    func loadModel(at modelURL: URL) async throws
    func transcribe(
        audioURL: URL,
        language: String?,
        vocabulary: [String],
        decoderIdentifier: UUID
    ) async throws -> TranscriptionOutput
    func transcribe(
        audioInput: AudioInput,
        language: String?,
        vocabulary: [String],
        decoderIdentifier: UUID
    ) async throws -> TranscriptionOutput
}

extension ParakeetInferenceDriving {
    public func transcribe(
        audioInput: AudioInput,
        language: String?,
        vocabulary: [String],
        decoderIdentifier: UUID
    ) async throws -> TranscriptionOutput {
        guard case .fileURL(let url) = audioInput else {
            throw RuntimeFailure.transcriptionFailed
        }
        return try await transcribe(
            audioURL: url,
            language: language,
            vocabulary: vocabulary,
            decoderIdentifier: decoderIdentifier
        )
    }
}

public actor ParakeetTranscriber {
    private let driver: any ParakeetInferenceDriving
    private var loadedModelURL: URL?
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    public init(driver: any ParakeetInferenceDriving) {
        self.driver = driver
    }

    public func transcribe(
        modelURL: URL,
        audioURL: URL,
        language: String?,
        vocabulary: [String] = []
    ) async throws -> TranscriptionOutput {
        try await transcribe(
            modelURL: modelURL,
            audioInput: .fileURL(audioURL.standardizedFileURL),
            language: language,
            vocabulary: vocabulary
        )
    }

    public func transcribe(
        modelURL: URL,
        audioInput: AudioInput,
        language: String?,
        vocabulary: [String] = []
    ) async throws -> TranscriptionOutput {
        await acquire()
        defer { release() }

        do {
            let standardizedModelURL = modelURL.standardizedFileURL
            if loadedModelURL != standardizedModelURL {
                try await driver.loadModel(at: standardizedModelURL)
                loadedModelURL = standardizedModelURL
            }
            return try await driver.transcribe(
                audioInput: audioInput,
                language: language,
                vocabulary: Array(vocabulary.prefix(100)),
                decoderIdentifier: UUID()
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw RuntimeFailure.transcriptionFailed
        }
    }

    private func acquire() async {
        if !busy {
            busy = true
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    private func release() {
        if waiters.isEmpty {
            busy = false
        } else {
            waiters.removeFirst().resume()
        }
    }
}
