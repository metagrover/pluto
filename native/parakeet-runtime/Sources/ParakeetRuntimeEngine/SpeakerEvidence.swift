import Accelerate
import AVFoundation
@preconcurrency import FluidAudio
import Foundation
import ParakeetRuntimeCore

// Access is serialized by FluidAudioOfflineDiarizer. FluidAudio already treats its
// loaded Core ML models as read-only after initialization.
extension OfflineDiarizerManager: @retroactive @unchecked Sendable {}

public struct OfflineDiarizationResult: Sendable {
    public let turns: [SpeakerEvidenceTurn]
    public let chunkEmbeddings: [ChunkEmbedding]

    public init(turns: [SpeakerEvidenceTurn], chunkEmbeddings: [ChunkEmbedding] = []) {
        self.turns = turns
        self.chunkEmbeddings = chunkEmbeddings
    }
}

public protocol OfflineSpeakerDiarizing: Sendable {
    func diarize(audioURL: URL) async throws -> OfflineDiarizationResult
    func diarize(samples: [Float]) async throws -> OfflineDiarizationResult
    func diarize(audioSource: AudioSampleSource) async throws -> OfflineDiarizationResult
}

extension OfflineSpeakerDiarizing {
    public func diarize(samples _: [Float]) async throws -> OfflineDiarizationResult {
        throw RuntimeFailure.diarizationFailed
    }

    public func diarize(audioSource _: AudioSampleSource) async throws -> OfflineDiarizationResult {
        throw RuntimeFailure.diarizationFailed
    }
}

public protocol SpeakerEvidenceDriving: Sendable {
    func analyze(
        mixedURL: URL,
        micURL: URL,
        systemURL: URL
    ) async throws -> SpeakerEvidenceOutput
    func analyze(
        mixedInput: AudioInput,
        micInput: AudioInput,
        systemInput: AudioInput
    ) async throws -> SpeakerEvidenceOutput
}

extension SpeakerEvidenceDriving {
    public func analyze(
        mixedInput: AudioInput,
        micInput: AudioInput,
        systemInput: AudioInput
    ) async throws -> SpeakerEvidenceOutput {
        guard case .fileURL(let mixedURL) = mixedInput,
              case .fileURL(let micURL) = micInput,
              case .fileURL(let systemURL) = systemInput else {
            throw RuntimeFailure.diarizationFailed
        }
        return try await analyze(mixedURL: mixedURL, micURL: micURL, systemURL: systemURL)
    }
}

func isExpectedDiarizationSilence(_ error: Error) -> Bool {
    guard let error = error as? OfflineDiarizationError else { return false }
    if case .noSpeechDetected = error { return true }
    return false
}

struct SpeakerClusterEvidenceAggregator {
    static let micActiveRmsThreshold = 0.012
    static let systemActiveRmsThreshold = 0.002
    static let nearEndDominanceRatio = 2.5
    static let minimumSegmentDuration = 1.0
    static let minimumCleanChunkRatio = 0.2
    static let minimumConsensusSimilarity = 0.7
    static let minimumConsensusRetentionRatio = 0.6
    static let minimumConsensusChunkCount = 2
    static let embeddingDimension = 256
    static let maxClusters = 64

    static func buildClusterEvidence(
        turns: [SpeakerEvidenceTurn],
        windows: [SpeakerEnergyWindow],
        rawChunks: [ChunkEmbedding]
    ) -> [SpeakerClusterEvidence] {
        let clusters = Array(Set(turns.map(\.cluster))).sorted()
        var results: [SpeakerClusterEvidence] = []

        for cluster in clusters {
            let clusterTurns = turns.filter { $0.cluster == cluster }
            guard !clusterTurns.isEmpty else { continue }

            // Dirty intervals:
            // 1. Cross-speaker overlap (turns from other clusters)
            let otherTurns = turns.filter { $0.cluster != cluster }
            var dirtyIntervals: [(start: Double, end: Double)] = otherTurns.map { ($0.startTime, $0.endTime) }

            // 2. Microphone-exclusive speech. The microphone may contain
            // loudspeaker echo, so activity alone cannot contaminate a remote
            // System-audio voice sample. Apply the same source-dominance rule
            // used by recovered-channel attribution.
            for window in windows where isMicrophoneExclusive(window) {
                dirtyIntervals.append((window.startTime, window.endTime))
            }

            // Merge dirty intervals
            let mergedDirty = mergeIntervals(dirtyIntervals)

            // Extract clean segments by subtracting mergedDirty from clusterTurns
            var cleanSegments: [(start: Double, end: Double)] = []
            for turn in clusterTurns {
                let segments = subtractIntervals(interval: (turn.startTime, turn.endTime), excluding: mergedDirty)
                cleanSegments.append(contentsOf: segments)
            }

            // Filter segments >= 1.0s
            let acceptedSegments = cleanSegments.filter { ($0.end - $0.start) >= (minimumSegmentDuration - 1e-4) }
            guard !acceptedSegments.isEmpty else { continue }

            let cleanDurationSeconds = acceptedSegments.reduce(0.0) { $0 + ($1.end - $1.start) }
            let cleanSegmentCount = acceptedSegments.count

            // Filter chunks time-aligned to accepted segments
            let clusterChunks = rawChunks.filter { $0.speakerId == cluster }
            var acceptedUnitVectors: [[Float]] = []

            for chunk in clusterChunks {
                guard chunk.endTimeSeconds > chunk.startTimeSeconds else { continue }
                // FluidAudio embeddings are already speaker-masked and exclude
                // cross-speaker overlap. Their public interval spans from the
                // first to last active mask frame, including inactive gaps, so
                // requiring the whole span to fit one clean interval discards
                // valid production embeddings. Require meaningful clean support
                // across the span instead.
                let chunkDuration = chunk.endTimeSeconds - chunk.startTimeSeconds
                let cleanOverlap = acceptedSegments.reduce(0.0) { total, segment in
                    total + max(
                        0,
                        min(chunk.endTimeSeconds, segment.end)
                            - max(chunk.startTimeSeconds, segment.start)
                    )
                }
                guard cleanOverlap / chunkDuration >= minimumCleanChunkRatio - 1e-4 else { continue }

                // Validate vector
                guard chunk.embedding256.count == embeddingDimension else { continue }
                guard chunk.embedding256.allSatisfy({ $0.isFinite }) else { continue }

                var sumSquares: Float = 0
                vDSP_svesq(chunk.embedding256, 1, &sumSquares, vDSP_Length(embeddingDimension))
                let norm = sqrt(sumSquares)
                guard norm.isFinite, norm > 1e-6 else { continue }

                var normalized = [Float](repeating: 0, count: embeddingDimension)
                var scale = 1.0 / norm
                vDSP_vsmul(chunk.embedding256, 1, &scale, &normalized, 1, vDSP_Length(embeddingDimension))
                acceptedUnitVectors.append(normalized)
            }

            guard !acceptedUnitVectors.isEmpty else { continue }
            let consensusUnitVectors = stableConsensus(from: acceptedUnitVectors)
            guard !consensusUnitVectors.isEmpty else { continue }
            let cleanChunkCount = consensusUnitVectors.count

            // Compute centroid
            var centroid = [Float](repeating: 0, count: embeddingDimension)
            for vec in consensusUnitVectors {
                vDSP_vadd(centroid, 1, vec, 1, &centroid, 1, vDSP_Length(embeddingDimension))
            }
            var countScale = 1.0 / Float(cleanChunkCount)
            vDSP_vsmul(centroid, 1, &countScale, &centroid, 1, vDSP_Length(embeddingDimension))

            var centroidSumSquares: Float = 0
            vDSP_svesq(centroid, 1, &centroidSumSquares, vDSP_Length(embeddingDimension))
            let centroidNorm = sqrt(centroidSumSquares)
            guard centroidNorm.isFinite, centroidNorm > 1e-6 else { continue }

            var unitCentroid = [Float](repeating: 0, count: embeddingDimension)
            var unitScale = 1.0 / centroidNorm
            vDSP_vsmul(centroid, 1, &unitScale, &unitCentroid, 1, vDSP_Length(embeddingDimension))

            // Compute similarities of each chunk to the unit centroid
            var similarities: [Double] = []
            for vec in consensusUnitVectors {
                var dot: Float = 0
                vDSP_dotpr(vec, 1, unitCentroid, 1, &dot, vDSP_Length(embeddingDimension))
                similarities.append(Double(dot))
            }

            let minSimilarity = similarities.min() ?? 1.0
            let meanSimilarity = similarities.reduce(0.0, +) / Double(similarities.count)

            results.append(
                SpeakerClusterEvidence(
                    cluster: cluster,
                    embedding: unitCentroid,
                    cleanChunkCount: cleanChunkCount,
                    cleanSegmentCount: cleanSegmentCount,
                    cleanDurationSeconds: cleanDurationSeconds,
                    minimumChunkSimilarity: minSimilarity,
                    meanChunkSimilarity: meanSimilarity
                )
            )

            if results.count >= maxClusters { break }
        }

        return results
    }

    private static func isMicrophoneExclusive(_ window: SpeakerEnergyWindow) -> Bool {
        let micRms = max(0, window.micRms)
        let systemRms = max(0, window.systemRms)
        guard micRms >= micActiveRmsThreshold else { return false }
        guard systemRms >= systemActiveRmsThreshold else { return true }
        return micRms / max(systemRms, 0.000_001) >= nearEndDominanceRatio
    }

    private static func stableConsensus(from vectors: [[Float]]) -> [[Float]] {
        guard vectors.count >= minimumConsensusChunkCount else { return vectors }
        let minimumRetained = max(
            minimumConsensusChunkCount,
            Int(ceil(Double(vectors.count) * minimumConsensusRetentionRatio))
        )
        let maximumSeedCount = 32
        let seedStride = max(1, Int(ceil(Double(vectors.count) / Double(maximumSeedCount))))
        let orderedVectors = vectors.sorted { lhs, rhs in
            for index in lhs.indices {
                if lhs[index] != rhs[index] { return lhs[index] < rhs[index] }
            }
            return false
        }
        let seedVectors = stride(from: 0, to: orderedVectors.count, by: seedStride)
            .map { orderedVectors[$0] }
        let seededConsensus = seedVectors
            .map { seed in
                vectors.filter { vector in
                    cosineSimilarity(vector, seed) >= minimumConsensusSimilarity - 1e-4
                }
            }
            .max { $0.count < $1.count } ?? []
        guard seededConsensus.count >= minimumRetained else { return [] }
        var consensus = seededConsensus

        for _ in 0..<3 {
            guard let centroid = normalizedCentroid(consensus) else { return [] }
            let next = consensus.filter { vector in
                cosineSimilarity(vector, centroid) >= minimumConsensusSimilarity - 1e-4
            }
            if next.count == consensus.count { return consensus }
            if next.count < minimumRetained { return [] }
            consensus = next
        }

        return []
    }

    private static func normalizedCentroid(_ vectors: [[Float]]) -> [Float]? {
        guard !vectors.isEmpty else { return nil }
        var centroid = [Float](repeating: 0, count: embeddingDimension)
        for vector in vectors {
            vDSP_vadd(centroid, 1, vector, 1, &centroid, 1, vDSP_Length(embeddingDimension))
        }
        var scale = 1.0 / Float(vectors.count)
        vDSP_vsmul(centroid, 1, &scale, &centroid, 1, vDSP_Length(embeddingDimension))
        var sumSquares: Float = 0
        vDSP_svesq(centroid, 1, &sumSquares, vDSP_Length(embeddingDimension))
        let norm = sqrt(sumSquares)
        guard norm.isFinite, norm > 1e-6 else { return nil }
        var unitCentroid = [Float](repeating: 0, count: embeddingDimension)
        var unitScale = 1.0 / norm
        vDSP_vsmul(centroid, 1, &unitScale, &unitCentroid, 1, vDSP_Length(embeddingDimension))
        return unitCentroid
    }

    private static func cosineSimilarity(_ vector: [Float], _ centroid: [Float]) -> Double {
        var dot: Float = 0
        vDSP_dotpr(vector, 1, centroid, 1, &dot, vDSP_Length(embeddingDimension))
        return Double(dot)
    }

    private static func mergeIntervals(_ intervals: [(start: Double, end: Double)]) -> [(start: Double, end: Double)] {
        let valid = intervals.filter { $0.end > $0.start }.sorted { $0.start < $1.start }
        guard let first = valid.first else { return [] }
        var merged: [(start: Double, end: Double)] = [first]

        for interval in valid.dropFirst() {
            var last = merged.removeLast()
            if interval.start <= last.end {
                last.end = max(last.end, interval.end)
                merged.append(last)
            } else {
                merged.append(last)
                merged.append(interval)
            }
        }
        return merged
    }

    private static func subtractIntervals(
        interval: (start: Double, end: Double),
        excluding: [(start: Double, end: Double)]
    ) -> [(start: Double, end: Double)] {
        guard interval.end > interval.start else { return [] }
        var current = interval.start
        var result: [(start: Double, end: Double)] = []

        for dirty in excluding {
            if dirty.end <= current { continue }
            if dirty.start >= interval.end { break }
            if dirty.start > current {
                result.append((current, min(dirty.start, interval.end)))
            }
            current = max(current, dirty.end)
            if current >= interval.end { break }
        }

        if current < interval.end {
            result.append((current, interval.end))
        }
        return result
    }
}

public struct SpeakerEvidenceCoordinator: SpeakerEvidenceDriving, Sendable {
    private let diarizer: any OfflineSpeakerDiarizing
    private let energyAnalyzer: any SpeakerEnergyAnalyzing
    private let manifest: DiarizationModelManifest
    private let runtimeVersion: String

    public init(
        diarizer: any OfflineSpeakerDiarizing,
        energyAnalyzer: any SpeakerEnergyAnalyzing,
        manifest: DiarizationModelManifest,
        runtimeVersion: String
    ) {
        self.diarizer = diarizer
        self.energyAnalyzer = energyAnalyzer
        self.manifest = manifest
        self.runtimeVersion = runtimeVersion
    }

    public func analyze(
        mixedURL: URL,
        micURL: URL,
        systemURL: URL
    ) async throws -> SpeakerEvidenceOutput {
        let totalStart = ContinuousClock.now
        try Task.checkCancellation()
        let energyStart = ContinuousClock.now
        let windows = try await energyAnalyzer.analyze(micURL: micURL, systemURL: systemURL)
        let energyMs = elapsedMilliseconds(since: energyStart)
        try Task.checkCancellation()
        guard !windows.isEmpty else { throw RuntimeFailure.audioAnalysisFailed }

        let diarizationStart = ContinuousClock.now
        // Remote participants are mixed together on the system channel. The
        // microphone is user speech plus possible system echo, so it must not
        // be diarized as a source of local identity.
        // Only exact digital silence skips inference; even very quiet audio
        // still receives the normal model pass.
        let systemIsSilent = windows.allSatisfy { $0.systemRms == 0 }
        let diarizationResult = systemIsSilent
            ? OfflineDiarizationResult(turns: [], chunkEmbeddings: [])
            : try await diarizer.diarize(audioURL: systemURL)
        let turns = diarizationResult.turns
        let diarizationMs = systemIsSilent ? 0 : elapsedMilliseconds(since: diarizationStart)
        try Task.checkCancellation()

        let clusterEvidence: [SpeakerClusterEvidence] = systemIsSilent
            ? []
            : SpeakerClusterEvidenceAggregator.buildClusterEvidence(
                turns: turns,
                windows: windows,
                rawChunks: diarizationResult.chunkEmbeddings
            )

        return SpeakerEvidenceOutput(
            turns: turns,
            energyWindows: windows,
            provenance: SpeakerEvidenceProvenance(
                modelIdentifier: manifest.identifier,
                modelRevision: manifest.revision,
                artifactDigest: manifest.artifactSHA256,
                runtimeVersion: runtimeVersion
            ),
            timings: SpeakerEvidenceTimings(
                diarizationMs: diarizationMs,
                energyAnalysisMs: energyMs,
                totalMs: elapsedMilliseconds(since: totalStart)
            ),
            windowSeconds: 0.1,
            clusterEvidence: clusterEvidence
        )
    }

    public func analyze(
        mixedInput: AudioInput,
        micInput: AudioInput,
        systemInput: AudioInput
    ) async throws -> SpeakerEvidenceOutput {
        if case .fileURL(let mixedURL) = mixedInput,
           case .fileURL(let micURL) = micInput,
           case .fileURL(let systemURL) = systemInput {
            return try await analyze(mixedURL: mixedURL, micURL: micURL, systemURL: systemURL)
        }
        if case .encryptedReader(let micReader) = micInput,
           case .encryptedReader(let systemReader) = systemInput {
            let micSource = EncryptedAudioSampleSource(reader: micReader)
            let systemSource = EncryptedAudioSampleSource(reader: systemReader)
            let totalStart = ContinuousClock.now
            try Task.checkCancellation()
            let energyStart = ContinuousClock.now
            let windows = try await energyAnalyzer.analyze(
                micSource: micSource,
                systemSource: systemSource,
                sampleRate: micReader.sampleRate
            )
            let energyMs = elapsedMilliseconds(since: energyStart)
            guard !windows.isEmpty else { throw RuntimeFailure.audioAnalysisFailed }
            let diarizationStart = ContinuousClock.now
            let systemIsSilent = windows.allSatisfy { $0.systemRms == 0 }
            let diarizationResult = systemIsSilent
                ? OfflineDiarizationResult(turns: [], chunkEmbeddings: [])
                : try await diarizer.diarize(audioSource: systemSource)
            let turns = diarizationResult.turns
            let diarizationMs = systemIsSilent ? 0 : elapsedMilliseconds(since: diarizationStart)
            try Task.checkCancellation()
            return SpeakerEvidenceOutput(
                turns: turns,
                energyWindows: windows,
                provenance: SpeakerEvidenceProvenance(
                    modelIdentifier: manifest.identifier,
                    modelRevision: manifest.revision,
                    artifactDigest: manifest.artifactSHA256,
                    runtimeVersion: runtimeVersion
                ),
                timings: SpeakerEvidenceTimings(
                    diarizationMs: diarizationMs,
                    energyAnalysisMs: energyMs,
                    totalMs: elapsedMilliseconds(since: totalStart)
                ),
                windowSeconds: 0.1,
                clusterEvidence: systemIsSilent ? [] : SpeakerClusterEvidenceAggregator.buildClusterEvidence(
                    turns: turns,
                    windows: windows,
                    rawChunks: diarizationResult.chunkEmbeddings
                )
            )
        }
        guard case .pcmSamples(let micSamples, let micRate) = micInput,
              case .pcmSamples(let systemSamples, let systemRate) = systemInput else {
            throw RuntimeFailure.audioAnalysisFailed
        }

        let totalStart = ContinuousClock.now
        try Task.checkCancellation()
        let energyStart = ContinuousClock.now
        let windows = try await energyAnalyzer.analyze(
            micSamples: micSamples,
            micRate: micRate,
            systemSamples: systemSamples,
            systemRate: systemRate
        )
        let energyMs = elapsedMilliseconds(since: energyStart)
        guard !windows.isEmpty else { throw RuntimeFailure.audioAnalysisFailed }

        let diarizationStart = ContinuousClock.now
        let systemIsSilent = windows.allSatisfy { $0.systemRms == 0 }
        let diarizationResult: OfflineDiarizationResult
        if systemIsSilent {
            diarizationResult = OfflineDiarizationResult(turns: [], chunkEmbeddings: [])
        } else {
            let samples = systemRate == 16_000
                ? systemSamples
                : try AudioConverter().resample(systemSamples, from: systemRate)
            diarizationResult = try await diarizer.diarize(samples: samples)
        }
        let turns = diarizationResult.turns
        let diarizationMs = systemIsSilent ? 0 : elapsedMilliseconds(since: diarizationStart)
        try Task.checkCancellation()
        let clusterEvidence = systemIsSilent ? [] : SpeakerClusterEvidenceAggregator.buildClusterEvidence(
            turns: turns,
            windows: windows,
            rawChunks: diarizationResult.chunkEmbeddings
        )
        return SpeakerEvidenceOutput(
            turns: turns,
            energyWindows: windows,
            provenance: SpeakerEvidenceProvenance(
                modelIdentifier: manifest.identifier,
                modelRevision: manifest.revision,
                artifactDigest: manifest.artifactSHA256,
                runtimeVersion: runtimeVersion
            ),
            timings: SpeakerEvidenceTimings(
                diarizationMs: diarizationMs,
                energyAnalysisMs: energyMs,
                totalMs: elapsedMilliseconds(since: totalStart)
            ),
            windowSeconds: 0.1,
            clusterEvidence: clusterEvidence
        )
    }

    private func elapsedMilliseconds(since start: ContinuousClock.Instant) -> Int {
        let duration = start.duration(to: .now)
        return max(0, Int(duration.components.seconds * 1_000)
            + Int(duration.components.attoseconds / 1_000_000_000_000_000))
    }
}

func makeProductionOfflineDiarizerConfig() -> OfflineDiarizerConfig {
    var config = OfflineDiarizerConfig.default
    // Community-1 cuts centroid linkage at Euclidean distance 0.6 on unit
    // vectors. This FluidAudio revision instead consumes cosine similarity
    // despite its config documentation describing a Euclidean threshold.
    // Translate the reference radius at the dependency boundary; do not force
    // a speaker count or change VBx refinement and overlap handling.
    let referenceEuclideanDistance = 0.6
    config.clustering.threshold = 1 - referenceEuclideanDistance * referenceEuclideanDistance / 2
    config.exposeChunkEmbeddings = true
    return config
}

public actor FluidAudioOfflineDiarizer: OfflineSpeakerDiarizing {
    private let modelsRoot: URL
    private let manifest: DiarizationModelManifest
    private let manager: OfflineDiarizerManager
    private var prepared = false

    public init(
        modelsRoot: URL,
        manifest: DiarizationModelManifest = ProductionDiarizationManifest.current,
        manager: OfflineDiarizerManager? = nil
    ) {
        self.modelsRoot = modelsRoot.standardizedFileURL
        self.manifest = manifest
        self.manager = manager ?? OfflineDiarizerManager(config: makeProductionOfflineDiarizerConfig())
    }

    public func diarize(audioURL: URL) async throws -> OfflineDiarizationResult {
        do {
            if !prepared {
                ModelRegistry.setPinnedRevision(manifest.revision, for: manifest.repository)
                defer { ModelRegistry.setPinnedRevision(nil, for: manifest.repository) }
                try await manager.prepareModels(directory: modelsRoot)
                try verifyInstalledModels()
                prepared = true
            }
            try Task.checkCancellation()
            let result: DiarizationResult
            do {
                result = try await manager.process(audioURL)
            } catch where isExpectedDiarizationSilence(error) {
                return OfflineDiarizationResult(turns: [], chunkEmbeddings: [])
            }
            try Task.checkCancellation()
            let turns = result.segments.compactMap { segment -> SpeakerEvidenceTurn? in
                let start = Double(segment.startTimeSeconds)
                let end = Double(segment.endTimeSeconds)
                guard start.isFinite, end.isFinite, start >= 0, end > start,
                    !segment.speakerId.isEmpty
                else { return nil }
                return SpeakerEvidenceTurn(
                    startTime: start,
                    endTime: end,
                    cluster: segment.speakerId
                )
            }
            let sortedTurns = turns.sorted { left, right in
                left.startTime == right.startTime
                    ? left.endTime < right.endTime
                    : left.startTime < right.startTime
            }
            return OfflineDiarizationResult(
                turns: sortedTurns,
                chunkEmbeddings: result.chunkEmbeddings ?? []
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch let failure as RuntimeFailure {
            throw failure
        } catch {
            throw RuntimeFailure.diarizationFailed
        }
    }

    public func diarize(samples: [Float]) async throws -> OfflineDiarizationResult {
        try await runDiarization { try await self.manager.process(audio: samples) }
    }

    public func diarize(audioSource: AudioSampleSource) async throws -> OfflineDiarizationResult {
        try await runDiarization {
            try await self.manager.process(audioSource: audioSource, audioLoadingSeconds: 0)
        }
    }

    private func runDiarization(
        _ process: () async throws -> DiarizationResult
    ) async throws -> OfflineDiarizationResult {
        do {
            if !prepared {
                ModelRegistry.setPinnedRevision(manifest.revision, for: manifest.repository)
                defer { ModelRegistry.setPinnedRevision(nil, for: manifest.repository) }
                try await manager.prepareModels(directory: modelsRoot)
                try verifyInstalledModels()
                prepared = true
            }
            try Task.checkCancellation()
            let result: DiarizationResult
            do {
                result = try await process()
            } catch where isExpectedDiarizationSilence(error) {
                return OfflineDiarizationResult(turns: [], chunkEmbeddings: [])
            }
            try Task.checkCancellation()
            let turns = result.segments.compactMap { segment -> SpeakerEvidenceTurn? in
                let start = Double(segment.startTimeSeconds)
                let end = Double(segment.endTimeSeconds)
                guard start.isFinite, end.isFinite, start >= 0, end > start,
                    !segment.speakerId.isEmpty else { return nil }
                return SpeakerEvidenceTurn(startTime: start, endTime: end, cluster: segment.speakerId)
            }.sorted { left, right in
                left.startTime == right.startTime
                    ? left.endTime < right.endTime
                    : left.startTime < right.startTime
            }
            return OfflineDiarizationResult(
                turns: turns,
                chunkEmbeddings: result.chunkEmbeddings ?? []
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch let failure as RuntimeFailure {
            throw failure
        } catch {
            throw RuntimeFailure.diarizationFailed
        }
    }

    private func verifyInstalledModels() throws {
        let repositoryDirectory = modelsRoot.appendingPathComponent(
            Repo.diarizer.folderName,
            isDirectory: true
        )
        let manager = FileManager.default
        for artifact in manifest.requiredArtifacts {
            var isDirectory: ObjCBool = false
            let path = repositoryDirectory.appendingPathComponent(artifact).path
            guard manager.fileExists(atPath: path, isDirectory: &isDirectory),
                artifact.hasSuffix(".mlmodelc") ? isDirectory.boolValue : !isDirectory.boolValue
            else { throw RuntimeFailure.modelPreparationFailed }
        }
        try ModelArtifactIntegrity.verify(
            directory: repositoryDirectory,
            requiredArtifacts: manifest.requiredArtifacts,
            expectedSHA256: manifest.artifactSHA256
        )
    }
}

public protocol SpeakerEnergyAnalyzing: Sendable {
    func analyze(micURL: URL, systemURL: URL) async throws -> [SpeakerEnergyWindow]
    func analyze(
        micSamples: [Float],
        micRate: Double,
        systemSamples: [Float],
        systemRate: Double
    ) async throws -> [SpeakerEnergyWindow]
    func analyze(
        micSource: AudioSampleSource,
        systemSource: AudioSampleSource,
        sampleRate: Double
    ) async throws -> [SpeakerEnergyWindow]
}

extension SpeakerEnergyAnalyzing {
    public func analyze(
        micSamples _: [Float],
        micRate _: Double,
        systemSamples _: [Float],
        systemRate _: Double
    ) async throws -> [SpeakerEnergyWindow] {
        throw RuntimeFailure.audioAnalysisFailed
    }

    public func analyze(
        micSource _: AudioSampleSource,
        systemSource _: AudioSampleSource,
        sampleRate _: Double
    ) async throws -> [SpeakerEnergyWindow] {
        throw RuntimeFailure.audioAnalysisFailed
    }
}

public struct SpeakerEnergyAnalyzer: SpeakerEnergyAnalyzing, Sendable {
    public let windowSeconds: Double

    public init(windowSeconds: Double = 0.1) {
        precondition(windowSeconds > 0 && windowSeconds.isFinite)
        self.windowSeconds = windowSeconds
    }

    public func analyze(micURL: URL, systemURL: URL) async throws -> [SpeakerEnergyWindow] {
        try Task.checkCancellation()
        let mic = try readWindows(from: micURL)
        try Task.checkCancellation()
        let system = try readWindows(from: systemURL)
        try Task.checkCancellation()

        let count = max(mic.count, system.count)
        return (0..<count).map { index in
            let start = Double(index) * windowSeconds
            let end = max(
                mic.indices.contains(index) ? mic[index].endTime : start,
                system.indices.contains(index) ? system[index].endTime : start
            )
            return SpeakerEnergyWindow(
                startTime: start,
                endTime: end,
                micRms: mic.indices.contains(index) ? mic[index].rms : 0,
                systemRms: system.indices.contains(index) ? system[index].rms : 0
            )
        }
    }

    public func analyze(
        micSamples: [Float],
        micRate: Double,
        systemSamples: [Float],
        systemRate: Double
    ) async throws -> [SpeakerEnergyWindow] {
        try Task.checkCancellation()
        guard micRate.isFinite, micRate > 0, systemRate.isFinite, systemRate > 0 else {
            throw RuntimeFailure.audioAnalysisFailed
        }
        let mic = computeWindows(samples: micSamples, sampleRate: micRate)
        let system = computeWindows(samples: systemSamples, sampleRate: systemRate)
        let count = max(mic.count, system.count)
        return (0..<count).map { index in
            let start = Double(index) * windowSeconds
            return SpeakerEnergyWindow(
                startTime: start,
                endTime: max(
                    mic.indices.contains(index) ? mic[index].endTime : start,
                    system.indices.contains(index) ? system[index].endTime : start
                ),
                micRms: mic.indices.contains(index) ? mic[index].rms : 0,
                systemRms: system.indices.contains(index) ? system[index].rms : 0
            )
        }
    }

    public func analyze(
        micSource: AudioSampleSource,
        systemSource: AudioSampleSource,
        sampleRate: Double
    ) async throws -> [SpeakerEnergyWindow] {
        try Task.checkCancellation()
        guard sampleRate.isFinite, sampleRate > 0 else {
            throw RuntimeFailure.audioAnalysisFailed
        }
        let framesPerWindow = max(1, Int((sampleRate * windowSeconds).rounded()))
        var windows: [SpeakerEnergyWindow] = []
        var offset = 0
        let totalFrames = max(micSource.sampleCount, systemSource.sampleCount)
        while offset < totalFrames {
            try Task.checkCancellation()
            let count = min(framesPerWindow, totalFrames - offset)
            var mic = [Float](repeating: 0, count: count)
            var system = [Float](repeating: 0, count: count)
            let micCount = min(count, max(0, micSource.sampleCount - offset))
            if micCount > 0 {
                try mic.withUnsafeMutableBufferPointer { buffer in
                    guard let baseAddress = buffer.baseAddress else { return }
                    try micSource.copySamples(into: baseAddress, offset: offset, count: micCount)
                }
            }
            let systemCount = min(count, max(0, systemSource.sampleCount - offset))
            if systemCount > 0 {
                try system.withUnsafeMutableBufferPointer { buffer in
                    guard let baseAddress = buffer.baseAddress else { return }
                    try systemSource.copySamples(into: baseAddress, offset: offset, count: systemCount)
                }
            }
            let start = Double(offset) / sampleRate
            offset += count
            windows.append(SpeakerEnergyWindow(
                startTime: start,
                endTime: Double(offset) / sampleRate,
                micRms: rms(mic),
                systemRms: rms(system)
            ))
        }
        return windows
    }

    private struct RmsWindow {
        let endTime: Double
        let rms: Double
    }

    private func computeWindows(samples: [Float], sampleRate: Double) -> [RmsWindow] {
        let framesPerWindow = max(1, Int((sampleRate * windowSeconds).rounded()))
        var result: [RmsWindow] = []
        var offset = 0
        while offset < samples.count {
            let count = min(framesPerWindow, samples.count - offset)
            var sumSquares = 0.0
            for index in offset..<(offset + count) {
                let sample = Double(samples[index])
                sumSquares += sample * sample
            }
            offset += count
            result.append(RmsWindow(
                endTime: Double(offset) / sampleRate,
                rms: count > 0 ? sqrt(sumSquares / Double(count)) : 0
            ))
        }
        return result
    }

    private func rms(_ samples: [Float]) -> Double {
        guard !samples.isEmpty else { return 0 }
        let sumSquares = samples.reduce(0.0) { partial, sample in
            partial + Double(sample) * Double(sample)
        }
        return sqrt(sumSquares / Double(samples.count))
    }

    private func readWindows(from url: URL) throws -> [RmsWindow] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else {
            throw RuntimeFailure.audioAnalysisFailed
        }
        let framesPerWindow = max(
            1,
            AVAudioFrameCount((format.sampleRate * windowSeconds).rounded())
        )
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: framesPerWindow
        ) else {
            throw RuntimeFailure.audioAnalysisFailed
        }

        var result: [RmsWindow] = []
        var framesRead: AVAudioFramePosition = 0
        while file.framePosition < file.length {
            try Task.checkCancellation()
            buffer.frameLength = 0
            try file.read(into: buffer, frameCount: framesPerWindow)
            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0, let channels = buffer.floatChannelData else { break }

            var sumSquares = 0.0
            for channelIndex in 0..<Int(format.channelCount) {
                let channel = channels[channelIndex]
                for frameIndex in 0..<frameLength {
                    let sample = Double(channel[frameIndex])
                    sumSquares += sample * sample
                }
            }
            let sampleCount = frameLength * Int(format.channelCount)
            framesRead += AVAudioFramePosition(frameLength)
            let endTime = Double(framesRead) / format.sampleRate
            let rms = sampleCount > 0 ? sqrt(sumSquares / Double(sampleCount)) : 0
            guard rms.isFinite, rms >= 0, endTime.isFinite else {
                throw RuntimeFailure.audioAnalysisFailed
            }
            result.append(RmsWindow(endTime: endTime, rms: rms))
        }
        return result
    }
}
