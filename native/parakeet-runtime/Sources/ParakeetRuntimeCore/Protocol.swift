import Foundation

public enum RuntimeMethod: String, Codable, Sendable {
    case prepare
    case transcribe
    case speakerEvidence = "speaker_evidence"
    case cancel
    case shutdown
    case streamOpen = "stream_open"
    case streamAppend = "stream_append"
    case streamFlush = "stream_flush"
    case streamCancel = "stream_cancel"
    case streamReset = "stream_reset"
    case eouOpen = "eou_open"
    case eouAppend = "eou_append"
    case eouFinish = "eou_finish"
    case eouCancel = "eou_cancel"
    case eouReset = "eou_reset"
    case eouSpeakerEvidence = "eou_speaker_evidence"
}

public struct RuntimeRequest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let id: String
    public let method: RuntimeMethod
    public let modelRoot: String?
    public let audioPath: String?
    public let mixedAudioPath: String?
    public let micAudioPath: String?
    public let systemAudioPath: String?
    public let language: String?
    public let vocabulary: [String]?
    public let targetId: String?
    public let live: LiveRequestMetadata?
    public let eou: EouRequestMetadata?
    public let capability: ScopedMeetingCapability?

    public init(
        schemaVersion: Int = 1,
        id: String,
        method: RuntimeMethod,
        modelRoot: String? = nil,
        audioPath: String? = nil,
        mixedAudioPath: String? = nil,
        micAudioPath: String? = nil,
        systemAudioPath: String? = nil,
        language: String? = nil,
        vocabulary: [String]? = nil,
        targetId: String? = nil,
        live: LiveRequestMetadata? = nil,
        eou: EouRequestMetadata? = nil,
        capability: ScopedMeetingCapability? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.method = method
        self.modelRoot = modelRoot
        self.audioPath = audioPath
        self.mixedAudioPath = mixedAudioPath
        self.micAudioPath = micAudioPath
        self.systemAudioPath = systemAudioPath
        self.language = language
        self.vocabulary = vocabulary
        self.targetId = targetId
        self.live = live
        self.eou = eou
        self.capability = capability
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion
        case id
        case method
        case modelRoot
        case audioPath
        case mixedAudioPath
        case micAudioPath
        case systemAudioPath
        case language
        case vocabulary
        case targetId
        case streamId
        case source
        case generation
        case sequence
        case chunkStartSeconds
        case chunkEndSeconds
        case sampleRate
        case channelCount
        case frameCount
        case audioStartSeconds
        case audioEndSeconds
        case pcmBase64
        case capability
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        id = try container.decode(String.self, forKey: .id)
        method = try container.decode(RuntimeMethod.self, forKey: .method)
        let presentKeys = Set(CodingKeys.allCases.filter { container.contains($0) })
        if let incompatible = Self.incompatibleKnownKey(in: presentKeys, method: method) {
            throw protocolDecodingError(incompatible, "method-incompatible request field")
        }
        modelRoot = try container.decodeIfPresent(String.self, forKey: .modelRoot)
        audioPath = try container.decodeIfPresent(String.self, forKey: .audioPath)
        mixedAudioPath = try container.decodeIfPresent(String.self, forKey: .mixedAudioPath)
        micAudioPath = try container.decodeIfPresent(String.self, forKey: .micAudioPath)
        systemAudioPath = try container.decodeIfPresent(String.self, forKey: .systemAudioPath)
        language = try container.decodeIfPresent(String.self, forKey: .language)
        vocabulary = try container.decodeIfPresent([String].self, forKey: .vocabulary)
        targetId = try container.decodeIfPresent(String.self, forKey: .targetId)
        capability = try container.decodeIfPresent(ScopedMeetingCapability.self, forKey: .capability)

        switch method {
        case .prepare, .transcribe, .cancel, .shutdown:
            live = nil
            eou = nil
        case .speakerEvidence:
            live = nil
            eou = nil
            guard schemaVersion == 1,
                Self.isPresentPath(mixedAudioPath),
                Self.isPresentPath(micAudioPath),
                Self.isPresentPath(systemAudioPath)
            else {
                throw protocolDecodingError(CodingKeys.mixedAudioPath, "missing approved audio path")
            }
        case .streamOpen, .streamAppend, .streamFlush, .streamCancel, .streamReset:
            eou = nil
            guard schemaVersion == 1 else {
                throw protocolDecodingError(CodingKeys.schemaVersion, "unsupported schema version")
            }
            let streamId = try container.decode(String.self, forKey: .streamId)
            let source = try container.decode(LiveSource.self, forKey: .source)
            let generation = try container.decode(Int.self, forKey: .generation)
            guard isValidOpaqueStreamId(streamId) else {
                throw protocolDecodingError(CodingKeys.streamId, "invalid stream identity")
            }
            guard isPositiveSafeInteger(generation) else {
                throw protocolDecodingError(CodingKeys.generation, "invalid generation")
            }

            let sequence = try container.decodeIfPresent(Int.self, forKey: .sequence)
            let chunkStartSeconds = try container.decodeIfPresent(
                Double.self,
                forKey: .chunkStartSeconds
            )
            let chunkEndSeconds = try container.decodeIfPresent(
                Double.self,
                forKey: .chunkEndSeconds
            )

            if method == .streamAppend {
                guard let sequence, isPositiveSafeInteger(sequence) else {
                    throw protocolDecodingError(CodingKeys.sequence, "invalid append sequence")
                }
                guard let audioPath,
                    !audioPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                else {
                    throw protocolDecodingError(CodingKeys.audioPath, "missing approved audio path")
                }
                guard let chunkStartSeconds, let chunkEndSeconds,
                    chunkStartSeconds.isFinite,
                    chunkEndSeconds.isFinite,
                    chunkStartSeconds >= 0,
                    chunkEndSeconds > chunkStartSeconds
                else {
                    throw protocolDecodingError(CodingKeys.chunkStartSeconds, "invalid chunk range")
                }
            } else if sequence != nil || chunkStartSeconds != nil || chunkEndSeconds != nil
                || audioPath != nil
            {
                throw protocolDecodingError(
                    CodingKeys.audioPath,
                    "append fields are not allowed for this method"
                )
            }

            live = LiveRequestMetadata(
                streamId: streamId,
                source: source,
                generation: generation,
                sequence: sequence,
                chunkStartSeconds: chunkStartSeconds,
                chunkEndSeconds: chunkEndSeconds
            )
        case .eouOpen, .eouAppend, .eouFinish, .eouCancel, .eouReset, .eouSpeakerEvidence:
            live = nil
            guard schemaVersion == 1 else {
                throw protocolDecodingError(CodingKeys.schemaVersion, "unsupported schema version")
            }
            let streamId = try container.decode(String.self, forKey: .streamId)
            let source = try container.decode(LiveSource.self, forKey: .source)
            let generation = try container.decode(Int.self, forKey: .generation)
            guard isValidOpaqueStreamId(streamId), isPositiveSafeInteger(generation) else {
                throw protocolDecodingError(CodingKeys.streamId, "invalid EOU identity")
            }
            if method == .eouAppend {
                let sequence = try container.decode(Int.self, forKey: .sequence)
                guard isPositiveSafeInteger(sequence) else {
                    throw protocolDecodingError(CodingKeys.sequence, "invalid append sequence")
                }
                let pcmBase64 = try container.decode(String.self, forKey: .pcmBase64)
                guard let pcmData = Data(base64Encoded: pcmBase64) else {
                    throw protocolDecodingError(CodingKeys.pcmBase64, "invalid PCM payload")
                }
                do {
                    let frame = try EouPcmFrame(
                        sampleRate: container.decode(Int.self, forKey: .sampleRate),
                        channelCount: container.decode(Int.self, forKey: .channelCount),
                        frameCount: container.decode(Int.self, forKey: .frameCount),
                        audioStartSeconds: container.decode(
                            Double.self, forKey: .audioStartSeconds),
                        audioEndSeconds: container.decode(Double.self, forKey: .audioEndSeconds),
                        pcmData: pcmData
                    )
                    eou = EouRequestMetadata(
                        streamId: streamId,
                        source: source,
                        generation: generation,
                        sequence: sequence,
                        frame: frame
                    )
                } catch {
                    throw protocolDecodingError(CodingKeys.pcmBase64, "invalid PCM frame")
                }
            } else {
                eou = EouRequestMetadata(
                    streamId: streamId,
                    source: source,
                    generation: generation
                )
            }
        }
    }

    public func encode(to encoder: Encoder) throws {
        let presentKeys = encodedKnownKeys
        if let incompatible = Self.incompatibleKnownKey(in: presentKeys, method: method) {
            throw EncodingError.invalidValue(
                method,
                .init(
                    codingPath: [incompatible],
                    debugDescription: "method-incompatible request field")
            )
        }

        switch method {
        case .prepare, .transcribe, .cancel, .shutdown:
            break
        case .speakerEvidence:
            guard schemaVersion == 1,
                Self.isPresentPath(mixedAudioPath),
                Self.isPresentPath(micAudioPath),
                Self.isPresentPath(systemAudioPath)
            else {
                throw EncodingError.invalidValue(
                    method,
                    .init(codingPath: [], debugDescription: "speaker evidence requires three audio paths")
                )
            }
        case .streamOpen, .streamAppend, .streamFlush, .streamCancel, .streamReset:
            guard schemaVersion == 1, let live else {
                throw EncodingError.invalidValue(
                    method,
                    .init(
                        codingPath: [], debugDescription: "live method requires schema v1 metadata")
                )
            }
            guard isValidOpaqueStreamId(live.streamId), isPositiveSafeInteger(live.generation)
            else {
                throw EncodingError.invalidValue(
                    live,
                    .init(codingPath: [], debugDescription: "invalid live identity")
                )
            }
            if method == .streamAppend {
                guard let sequence = live.sequence, isPositiveSafeInteger(sequence),
                    let audioPath,
                    !audioPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    let start = live.chunkStartSeconds,
                    let end = live.chunkEndSeconds,
                    start.isFinite,
                    end.isFinite,
                    start >= 0,
                    end > start
                else {
                    throw EncodingError.invalidValue(
                        live,
                        .init(codingPath: [], debugDescription: "invalid live append")
                    )
                }
            }
        case .eouOpen, .eouAppend, .eouFinish, .eouCancel, .eouReset, .eouSpeakerEvidence:
            guard schemaVersion == 1, let eou else {
                throw EncodingError.invalidValue(
                    method,
                    .init(codingPath: [], debugDescription: "EOU method requires schema v1 metadata")
                )
            }
            guard isValidOpaqueStreamId(eou.streamId), isPositiveSafeInteger(eou.generation) else {
                throw EncodingError.invalidValue(
                    eou,
                    .init(codingPath: [], debugDescription: "invalid EOU identity")
                )
            }
            if method == .eouAppend {
                guard let sequence = eou.sequence, isPositiveSafeInteger(sequence), eou.frame != nil
                else {
                    throw EncodingError.invalidValue(
                        eou,
                        .init(codingPath: [], debugDescription: "invalid EOU append")
                    )
                }
            } else if eou.sequence != nil || eou.frame != nil {
                throw EncodingError.invalidValue(
                    eou,
                    .init(codingPath: [], debugDescription: "EOU append fields are not allowed")
                )
            }
        }

        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(id, forKey: .id)
        try container.encode(method, forKey: .method)
        try container.encodeIfPresent(modelRoot, forKey: .modelRoot)
        try container.encodeIfPresent(audioPath, forKey: .audioPath)
        try container.encodeIfPresent(mixedAudioPath, forKey: .mixedAudioPath)
        try container.encodeIfPresent(micAudioPath, forKey: .micAudioPath)
        try container.encodeIfPresent(systemAudioPath, forKey: .systemAudioPath)
        try container.encodeIfPresent(language, forKey: .language)
        try container.encodeIfPresent(vocabulary, forKey: .vocabulary)
        try container.encodeIfPresent(targetId, forKey: .targetId)
        try container.encodeIfPresent(capability, forKey: .capability)
        if let live {
            try container.encode(live.streamId, forKey: .streamId)
            try container.encode(live.source, forKey: .source)
            try container.encode(live.generation, forKey: .generation)
            try container.encodeIfPresent(live.sequence, forKey: .sequence)
            try container.encodeIfPresent(live.chunkStartSeconds, forKey: .chunkStartSeconds)
            try container.encodeIfPresent(live.chunkEndSeconds, forKey: .chunkEndSeconds)
        }
        if let eou {
            try container.encode(eou.streamId, forKey: .streamId)
            try container.encode(eou.source, forKey: .source)
            try container.encode(eou.generation, forKey: .generation)
            try container.encodeIfPresent(eou.sequence, forKey: .sequence)
            if let frame = eou.frame {
                try container.encode(frame.sampleRate, forKey: .sampleRate)
                try container.encode(frame.channelCount, forKey: .channelCount)
                try container.encode(frame.frameCount, forKey: .frameCount)
                try container.encode(frame.audioStartSeconds, forKey: .audioStartSeconds)
                try container.encode(frame.audioEndSeconds, forKey: .audioEndSeconds)
                try container.encode(frame.pcmData.base64EncodedString(), forKey: .pcmBase64)
            }
        }
    }

    private var encodedKnownKeys: Set<CodingKeys> {
        var keys: Set<CodingKeys> = [.schemaVersion, .id, .method]
        if modelRoot != nil { keys.insert(.modelRoot) }
        if audioPath != nil { keys.insert(.audioPath) }
        if mixedAudioPath != nil { keys.insert(.mixedAudioPath) }
        if micAudioPath != nil { keys.insert(.micAudioPath) }
        if systemAudioPath != nil { keys.insert(.systemAudioPath) }
        if language != nil { keys.insert(.language) }
        if vocabulary != nil { keys.insert(.vocabulary) }
        if targetId != nil { keys.insert(.targetId) }
        if capability != nil { keys.insert(.capability) }
        if let live {
            keys.formUnion([.streamId, .source, .generation])
            if live.sequence != nil { keys.insert(.sequence) }
            if live.chunkStartSeconds != nil { keys.insert(.chunkStartSeconds) }
            if live.chunkEndSeconds != nil { keys.insert(.chunkEndSeconds) }
        }
        if let eou {
            keys.formUnion([.streamId, .source, .generation])
            if eou.sequence != nil { keys.insert(.sequence) }
            if eou.frame != nil {
                keys.formUnion([
                    .sampleRate, .channelCount, .frameCount,
                    .audioStartSeconds, .audioEndSeconds, .pcmBase64,
                ])
            }
        }
        return keys
    }

    private static func incompatibleKnownKey(
        in presentKeys: Set<CodingKeys>,
        method: RuntimeMethod
    ) -> CodingKeys? {
        let allowed = allowedKeys(for: method)
        return CodingKeys.allCases.first {
            presentKeys.contains($0) && !allowed.contains($0)
        }
    }

    private static func allowedKeys(for method: RuntimeMethod) -> Set<CodingKeys> {
        let common: Set<CodingKeys> = [.schemaVersion, .id, .method]
        switch method {
        case .prepare:
            return common.union([.modelRoot])
        case .transcribe:
            return common.union([.audioPath, .language, .vocabulary, .capability])
        case .speakerEvidence:
            return common.union([.mixedAudioPath, .micAudioPath, .systemAudioPath, .capability])
        case .cancel:
            return common.union([.targetId])
        case .shutdown:
            return common
        case .streamOpen, .streamFlush, .streamCancel, .streamReset:
            return common.union([.streamId, .source, .generation])
        case .streamAppend:
            return common.union([
                .streamId,
                .source,
                .generation,
                .sequence,
                .audioPath,
                .chunkStartSeconds,
                .chunkEndSeconds,
            ])
        case .eouOpen, .eouFinish, .eouCancel, .eouReset, .eouSpeakerEvidence:
            return common.union([.streamId, .source, .generation])
        case .eouAppend:
            return common.union([
                .streamId, .source, .generation, .sequence,
                .sampleRate, .channelCount, .frameCount,
                .audioStartSeconds, .audioEndSeconds, .pcmBase64,
            ])
        }
    }

    private static func isPresentPath(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

public enum RuntimeFailure: String, Error, Codable, Equatable, Sendable, CustomStringConvertible {
    case invalidRequest = "parakeet_request_invalid"
    case pathNotAllowed = "parakeet_path_not_allowed"
    case pathMissing = "parakeet_path_missing"
    case modelPreparationFailed = "parakeet_model_preparation_failed"
    case transcriptionFailed = "parakeet_transcription_failed"
    case audioAnalysisFailed = "parakeet_audio_analysis_failed"
    case diarizationFailed = "parakeet_diarization_failed"
    case cancelled = "parakeet_cancelled"

    public var description: String { rawValue }
}

public struct RuntimeErrorPayload: Codable, Equatable, Sendable {
    public let code: RuntimeFailure
}

public struct RuntimeResponse: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let id: String
    public let ok: Bool
    public let result: RuntimeResultPayload?
    public let error: RuntimeErrorPayload?

    public init(
        schemaVersion: Int,
        id: String,
        ok: Bool,
        result: RuntimeResultPayload?,
        error: RuntimeErrorPayload?
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.ok = ok
        self.result = result
        self.error = error
    }

    public static func failure(id: String, code: RuntimeFailure) -> RuntimeResponse {
        RuntimeResponse(
            schemaVersion: 1,
            id: id,
            ok: false,
            result: nil,
            error: RuntimeErrorPayload(code: code)
        )
    }

    public static func prepared(
        id: String,
        modelVersion: String,
        liveConfigId: String? = nil
    ) -> RuntimeResponse {
        RuntimeResponse(
            schemaVersion: 1,
            id: id,
            ok: true,
            result: RuntimeResultPayload(
                modelVersion: modelVersion,
                liveConfigId: liveConfigId
            ),
            error: nil
        )
    }

    public static func transcribed(
        id: String,
        output: TranscriptionOutput,
        vocabularyCount: Int
    ) -> RuntimeResponse {
        RuntimeResponse(
            schemaVersion: 1,
            id: id,
            ok: true,
            result: RuntimeResultPayload(
                transcription: output,
                vocabularyCount: vocabularyCount
            ),
            error: nil
        )
    }

    public static func speakerEvidence(
        id: String,
        output: SpeakerEvidenceOutput
    ) -> RuntimeResponse {
        RuntimeResponse(
            schemaVersion: 1,
            id: id,
            ok: true,
            result: RuntimeResultPayload(speakerEvidence: output),
            error: nil
        )
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case id
        case ok
        case result
        case error
        case kind
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if try container.decodeIfPresent(String.self, forKey: .kind) == "event" {
            throw protocolDecodingError(CodingKeys.kind, "event is not a response")
        }
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        id = try container.decode(String.self, forKey: .id)
        ok = try container.decode(Bool.self, forKey: .ok)
        result = try container.decodeIfPresent(RuntimeResultPayload.self, forKey: .result)
        error = try container.decodeIfPresent(RuntimeErrorPayload.self, forKey: .error)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(id, forKey: .id)
        try container.encode(ok, forKey: .ok)
        try container.encodeIfPresent(result, forKey: .result)
        try container.encodeIfPresent(error, forKey: .error)
    }
}

public struct RuntimeResultPayload: Codable, Equatable, Sendable {
    public let modelVersion: String?
    public let liveConfigId: String?
    public let finalPreview: String?
    public let degradations: [LiveStreamDegraded]?
    public let transcription: TranscriptionOutput?
    public let vocabularyCount: Int?
    public let speakerEvidence: SpeakerEvidenceOutput?

    public init(
        modelVersion: String? = nil,
        liveConfigId: String? = nil,
        finalPreview: String? = nil,
        degradations: [LiveStreamDegraded]? = nil,
        transcription: TranscriptionOutput? = nil,
        vocabularyCount: Int? = nil,
        speakerEvidence: SpeakerEvidenceOutput? = nil
    ) {
        self.modelVersion = modelVersion
        self.liveConfigId = liveConfigId
        self.finalPreview = finalPreview
        self.degradations = degradations
        self.transcription = transcription
        self.vocabularyCount = vocabularyCount
        self.speakerEvidence = speakerEvidence
    }
}

public struct SpeakerEvidenceTurn: Codable, Equatable, Sendable {
    public let startTime: Double
    public let endTime: Double
    public let cluster: String

    public init(startTime: Double, endTime: Double, cluster: String) {
        self.startTime = startTime
        self.endTime = endTime
        self.cluster = cluster
    }
}

public struct SpeakerEnergyWindow: Codable, Equatable, Sendable {
    public let startTime: Double
    public let endTime: Double
    public let micRms: Double
    public let systemRms: Double

    public init(
        startTime: Double,
        endTime: Double,
        micRms: Double,
        systemRms: Double
    ) {
        self.startTime = startTime
        self.endTime = endTime
        self.micRms = micRms
        self.systemRms = systemRms
    }
}

public struct SpeakerClusterEvidence: Codable, Equatable, Sendable {
    public let cluster: String
    public let embedding: [Float]
    public let representativeEmbeddings: [[Float]]?
    public let cleanChunkCount: Int
    public let cleanSegmentCount: Int
    public let cleanDurationSeconds: Double
    public let minimumChunkSimilarity: Double
    public let meanChunkSimilarity: Double

    public init(
        cluster: String,
        embedding: [Float],
        representativeEmbeddings: [[Float]]? = nil,
        cleanChunkCount: Int,
        cleanSegmentCount: Int,
        cleanDurationSeconds: Double,
        minimumChunkSimilarity: Double,
        meanChunkSimilarity: Double
    ) {
        self.cluster = cluster
        self.embedding = embedding
        self.representativeEmbeddings = representativeEmbeddings
        self.cleanChunkCount = cleanChunkCount
        self.cleanSegmentCount = cleanSegmentCount
        self.cleanDurationSeconds = cleanDurationSeconds
        self.minimumChunkSimilarity = minimumChunkSimilarity
        self.meanChunkSimilarity = meanChunkSimilarity
    }
}

public struct SpeakerEvidenceProvenance: Codable, Equatable, Sendable {
    public let modelIdentifier: String
    public let modelRevision: String
    public let artifactDigest: String
    public let runtimeVersion: String
    public let profileAlgorithmVersion: String

    public init(
        modelIdentifier: String,
        modelRevision: String,
        artifactDigest: String,
        runtimeVersion: String,
        profileAlgorithmVersion: String = "v1"
    ) {
        self.modelIdentifier = modelIdentifier
        self.modelRevision = modelRevision
        self.artifactDigest = artifactDigest
        self.runtimeVersion = runtimeVersion
        self.profileAlgorithmVersion = profileAlgorithmVersion
    }

    private enum CodingKeys: String, CodingKey {
        case modelIdentifier
        case modelRevision
        case artifactDigest
        case runtimeVersion
        case profileAlgorithmVersion
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        modelIdentifier = try container.decode(String.self, forKey: .modelIdentifier)
        modelRevision = try container.decode(String.self, forKey: .modelRevision)
        artifactDigest = try container.decode(String.self, forKey: .artifactDigest)
        runtimeVersion = try container.decode(String.self, forKey: .runtimeVersion)
        profileAlgorithmVersion = try container.decodeIfPresent(String.self, forKey: .profileAlgorithmVersion) ?? "v1"
    }
}

public struct SpeakerEvidenceTimings: Codable, Equatable, Sendable {
    public let diarizationMs: Int
    public let energyAnalysisMs: Int
    public let totalMs: Int

    public init(diarizationMs: Int, energyAnalysisMs: Int, totalMs: Int) {
        self.diarizationMs = diarizationMs
        self.energyAnalysisMs = energyAnalysisMs
        self.totalMs = totalMs
    }
}

public struct SpeakerEvidenceOutput: Codable, Equatable, Sendable {
    public let turns: [SpeakerEvidenceTurn]
    public let energyWindows: [SpeakerEnergyWindow]
    public let provenance: SpeakerEvidenceProvenance
    public let timings: SpeakerEvidenceTimings
    public let windowSeconds: Double
    public let clusterEvidence: [SpeakerClusterEvidence]?

    public init(
        turns: [SpeakerEvidenceTurn],
        energyWindows: [SpeakerEnergyWindow],
        provenance: SpeakerEvidenceProvenance,
        timings: SpeakerEvidenceTimings,
        windowSeconds: Double,
        clusterEvidence: [SpeakerClusterEvidence]? = nil
    ) {
        self.turns = turns
        self.energyWindows = energyWindows
        self.provenance = provenance
        self.timings = timings
        self.windowSeconds = windowSeconds
        self.clusterEvidence = clusterEvidence
    }
}
