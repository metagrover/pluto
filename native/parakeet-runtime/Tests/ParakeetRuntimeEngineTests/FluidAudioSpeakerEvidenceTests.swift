import Foundation
import XCTest
@preconcurrency @testable import FluidAudio
@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

private struct FixtureDiarizer: OfflineSpeakerDiarizing {
    let turns: [SpeakerEvidenceTurn]
    let chunkEmbeddings: [ChunkEmbedding]

    init(turns: [SpeakerEvidenceTurn], chunkEmbeddings: [ChunkEmbedding] = []) {
        self.turns = turns
        self.chunkEmbeddings = chunkEmbeddings
    }

    func diarize(audioURL _: URL) async throws -> OfflineDiarizationResult {
        OfflineDiarizationResult(turns: turns, chunkEmbeddings: chunkEmbeddings)
    }
}

private actor CapturingDiarizer: OfflineSpeakerDiarizing {
    private var receivedURLs: [URL] = []

    func diarize(audioURL: URL) async throws -> OfflineDiarizationResult {
        receivedURLs.append(audioURL)
        return OfflineDiarizationResult(turns: [SpeakerEvidenceTurn(startTime: 0, endTime: 1, cluster: "S1")])
    }

    func capturedURLsSnapshot() -> [URL] { receivedURLs }
}

private struct FixtureEnergyAnalyzer: SpeakerEnergyAnalyzing {
    let windows: [SpeakerEnergyWindow]

    func analyze(micURL _: URL, systemURL _: URL) async throws -> [SpeakerEnergyWindow] {
        windows
    }
}

private struct CancellingDiarizer: OfflineSpeakerDiarizing {
    func diarize(audioURL _: URL) async throws -> OfflineDiarizationResult {
        throw CancellationError()
    }
}

private struct FailingDiarizer: OfflineSpeakerDiarizing {
    func diarize(audioURL _: URL) async throws -> OfflineDiarizationResult {
        throw RuntimeFailure.diarizationFailed
    }
}

final class FluidAudioSpeakerEvidenceTests: XCTestCase {
    func testProductionClusteringPreservesReferenceEuclideanBoundary() {
        // Unit vectors separated by distance 0.7 must remain separate under
        // Community-1's 0.6 Euclidean AHC radius. FluidAudio consumes cosine
        // similarity, so passing 0.6 directly accidentally admits this pair.
        let cosine = 1.0 - 0.7 * 0.7 / 2.0
        let clusters = AHCClustering().cluster(
            embeddingFeatures: [[1, 0], [cosine, sqrt(1 - cosine * cosine)]],
            threshold: makeProductionOfflineDiarizerConfig().clustering.threshold
        )
        XCTAssertNotEqual(clusters[0], clusters[1])
    }

    func testProductionClusteringKeepsNearbyObservationsTogetherWithoutSpeakerCountConstraints() {
        let config = makeProductionOfflineDiarizerConfig()
        let cosine = 1.0 - 0.5 * 0.5 / 2.0
        let clusters = AHCClustering().cluster(
            embeddingFeatures: [[1, 0], [cosine, sqrt(1 - cosine * cosine)]],
            threshold: config.clustering.threshold
        )
        XCTAssertEqual(clusters[0], clusters[1])
        XCTAssertNil(config.clustering.numSpeakers)
        XCTAssertNil(config.clustering.minSpeakers)
        XCTAssertNil(config.clustering.maxSpeakers)
    }

    func testDigitalSystemSilenceSkipsDiarizerButQuietAudioDoesNot() async throws {
        for rms in [0.0, 0.0000001] {
            let diarizer = CapturingDiarizer()
            let coordinator = SpeakerEvidenceCoordinator(
                diarizer: diarizer,
                energyAnalyzer: FixtureEnergyAnalyzer(windows: [
                    SpeakerEnergyWindow(startTime: 0, endTime: 1, micRms: 0.2, systemRms: rms)
                ]),
                manifest: ProductionDiarizationManifest.current,
                runtimeVersion: "test"
            )
            let output = try await coordinator.analyze(
                mixedURL: URL(fileURLWithPath: "/approved/mixed.wav"),
                micURL: URL(fileURLWithPath: "/approved/mic.wav"),
                systemURL: URL(fileURLWithPath: "/approved/system.wav")
            )
            let urls = await diarizer.capturedURLsSnapshot()
            XCTAssertEqual(urls.count, rms == 0 ? 0 : 1)
            if rms == 0 {
                XCTAssertTrue(output.turns.isEmpty)
                XCTAssertEqual(output.timings.diarizationMs, 0)
            }
        }
    }

    func testOnlyFluidAudioNoSpeechIsAcceptedAsEmptyDiarization() {
        XCTAssertTrue(isExpectedDiarizationSilence(OfflineDiarizationError.noSpeechDetected))
        XCTAssertFalse(isExpectedDiarizationSilence(
            OfflineDiarizationError.processingFailed("model execution failed")
        ))
        XCTAssertFalse(isExpectedDiarizationSilence(RuntimeFailure.diarizationFailed))
    }

    func testCoordinatorDiarizesOnlyTheSystemRecording() async throws {
        let diarizer = CapturingDiarizer()
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: diarizer,
            energyAnalyzer: FixtureEnergyAnalyzer(windows: [
                SpeakerEnergyWindow(startTime: 0, endTime: 0.1, micRms: 0, systemRms: 0.2)
            ]),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "fluidaudio-test"
        )

        let output = try await coordinator.analyze(
            mixedURL: URL(fileURLWithPath: "/approved/mixed.wav"),
            micURL: URL(fileURLWithPath: "/approved/mic.wav"),
            systemURL: URL(fileURLWithPath: "/approved/system.wav")
        )

        let capturedURLs = await diarizer.capturedURLsSnapshot()
        XCTAssertEqual(capturedURLs.map(\.path), ["/approved/system.wav"])
        XCTAssertEqual(output.turns.map(\.cluster), ["S1"])
    }

    func testCoordinatorReturnsOnlyAnonymousTurnsEnergyAndPinnedProvenance() async throws {
        let manifest = ProductionDiarizationManifest.current
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FixtureDiarizer(turns: [
                SpeakerEvidenceTurn(startTime: 0, endTime: 1, cluster: "S1")
            ]),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: [
                SpeakerEnergyWindow(
                    startTime: 0, endTime: 0.1, micRms: 0.2, systemRms: 0.01)
            ]),
            manifest: manifest,
            runtimeVersion: "fluidaudio-test"
        )

        let output = try await coordinator.analyze(
            mixedURL: URL(fileURLWithPath: "/approved/mixed.wav"),
            micURL: URL(fileURLWithPath: "/approved/mic.wav"),
            systemURL: URL(fileURLWithPath: "/approved/system.wav")
        )

        XCTAssertEqual(output.turns.map(\.cluster), ["S1"])
        XCTAssertEqual(output.energyWindows.first?.micRms, 0.2)
        XCTAssertEqual(output.provenance.modelRevision, manifest.revision)
        XCTAssertEqual(output.provenance.artifactDigest, manifest.artifactSHA256)
        XCTAssertGreaterThanOrEqual(output.timings.totalMs, 0)
    }

    func testCoordinatorPreservesEmptyDiarizationForFailClosedFallback() async throws {
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FixtureDiarizer(turns: []),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: [
                SpeakerEnergyWindow(startTime: 0, endTime: 0.1, micRms: 0, systemRms: 0)
            ]),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "fluidaudio-test"
        )

        let output = try await coordinator.analyze(
            mixedURL: URL(fileURLWithPath: "/approved/mixed.wav"),
            micURL: URL(fileURLWithPath: "/approved/mic.wav"),
            systemURL: URL(fileURLWithPath: "/approved/system.wav")
        )

        XCTAssertTrue(output.turns.isEmpty)
        XCTAssertEqual(output.energyWindows.count, 1)
    }

    func testCoordinatorPreservesCancellation() async throws {
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: CancellingDiarizer(),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: [
                SpeakerEnergyWindow(startTime: 0, endTime: 1, micRms: 0, systemRms: 0.1)
            ]),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "fluidaudio-test"
        )

        do {
            _ = try await coordinator.analyze(
                mixedURL: URL(fileURLWithPath: "/approved/mixed.wav"),
                micURL: URL(fileURLWithPath: "/approved/mic.wav"),
                systemURL: URL(fileURLWithPath: "/approved/system.wav")
            )
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            // Expected.
        }
    }

    func testBoundedAggregationOfCleanNonOverlappingChunks() async throws {
        let v1 = [Float](repeating: 0.1, count: 256)
        let v2 = [Float](repeating: 0.2, count: 256)
        let chunks = [
            ChunkEmbedding(
                speakerId: "S1",
                chunkIndex: 0,
                speakerIndex: 0,
                startTimeSeconds: 0.0,
                endTimeSeconds: 1.5,
                embedding256: v1
            ),
            ChunkEmbedding(
                speakerId: "S1",
                chunkIndex: 1,
                speakerIndex: 0,
                startTimeSeconds: 1.5,
                endTimeSeconds: 3.0,
                embedding256: v2
            ),
        ]
        let turns = [
            SpeakerEvidenceTurn(startTime: 0.0, endTime: 3.0, cluster: "S1")
        ]
        let windows = (0..<30).map { i in
            SpeakerEnergyWindow(
                startTime: Double(i) * 0.1,
                endTime: Double(i + 1) * 0.1,
                micRms: 0.001,
                systemRms: 0.05
            )
        }
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FixtureDiarizer(turns: turns, chunkEmbeddings: chunks),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: windows),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "test"
        )
        let output = try await coordinator.analyze(
            mixedURL: URL(fileURLWithPath: "/dummy/mixed.wav"),
            micURL: URL(fileURLWithPath: "/dummy/mic.wav"),
            systemURL: URL(fileURLWithPath: "/dummy/system.wav")
        )
        let clusterEvidence = try XCTUnwrap(output.clusterEvidence)
        XCTAssertEqual(clusterEvidence.count, 1)
        XCTAssertEqual(clusterEvidence[0].cluster, "S1")
        XCTAssertEqual(clusterEvidence[0].cleanChunkCount, 2)
        XCTAssertEqual(clusterEvidence[0].cleanSegmentCount, 1)
        XCTAssertEqual(clusterEvidence[0].cleanDurationSeconds, 3.0, accuracy: 1e-4)
        XCTAssertEqual(clusterEvidence[0].embedding.count, 256)
        let norm = sqrt(clusterEvidence[0].embedding.reduce(0) { $0 + $1 * $1 })
        XCTAssertEqual(norm, 1.0, accuracy: 1e-4)
        XCTAssertGreaterThanOrEqual(clusterEvidence[0].minimumChunkSimilarity, 0.9)
        XCTAssertGreaterThanOrEqual(clusterEvidence[0].meanChunkSimilarity, 0.9)
    }

    func testExcludesMicSpeechAndOverlappingIntervals() async throws {
        let v1 = [Float](repeating: 0.1, count: 256)
        let v2 = [Float](repeating: 0.2, count: 256)
        let v3 = [Float](repeating: 0.3, count: 256)
        let turns = [
            SpeakerEvidenceTurn(startTime: 0.0, endTime: 5.0, cluster: "S1"),
            SpeakerEvidenceTurn(startTime: 2.0, endTime: 3.0, cluster: "S2"),
        ]
        let windows = (0..<50).map { i -> SpeakerEnergyWindow in
            let start = Double(i) * 0.1
            let end = Double(i + 1) * 0.1
            let micRms = (start >= 4.0 && end <= 4.5) ? 0.05 : 0.001
            return SpeakerEnergyWindow(
                startTime: start,
                endTime: end,
                micRms: micRms,
                systemRms: 0.05
            )
        }
        let chunks = [
            ChunkEmbedding(speakerId: "S1", chunkIndex: 0, speakerIndex: 0, startTimeSeconds: 0.0, endTimeSeconds: 1.5, embedding256: v1),
            ChunkEmbedding(speakerId: "S1", chunkIndex: 1, speakerIndex: 0, startTimeSeconds: 2.0, endTimeSeconds: 3.0, embedding256: v2),
            ChunkEmbedding(speakerId: "S1", chunkIndex: 2, speakerIndex: 0, startTimeSeconds: 4.0, endTimeSeconds: 4.5, embedding256: v3),
        ]
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FixtureDiarizer(turns: turns, chunkEmbeddings: chunks),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: windows),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "test"
        )
        let output = try await coordinator.analyze(
            mixedURL: URL(fileURLWithPath: "/dummy/mixed.wav"),
            micURL: URL(fileURLWithPath: "/dummy/mic.wav"),
            systemURL: URL(fileURLWithPath: "/dummy/system.wav")
        )
        let s1Evidence = try XCTUnwrap(output.clusterEvidence?.first { $0.cluster == "S1" })
        XCTAssertEqual(s1Evidence.cleanChunkCount, 1)
        XCTAssertEqual(s1Evidence.cleanSegmentCount, 2)
        XCTAssertEqual(s1Evidence.cleanDurationSeconds, 3.0, accuracy: 1e-4)
    }

    func testRejectsInvalidDimensionsZeroNormAndNonFiniteVectorsWithoutDiscardingTurns() async throws {
        let valid = [Float](repeating: 0.1, count: 256)
        let wrongDim = [Float](repeating: 0.1, count: 128)
        let zeroNorm = [Float](repeating: 0.0, count: 256)
        var nanVec = [Float](repeating: 0.1, count: 256)
        nanVec[5] = Float.nan
        var infVec = [Float](repeating: 0.1, count: 256)
        infVec[10] = Float.infinity

        let turns = [
            SpeakerEvidenceTurn(startTime: 0.0, endTime: 2.0, cluster: "S1")
        ]
        let windows = [
            SpeakerEnergyWindow(startTime: 0.0, endTime: 2.0, micRms: 0.001, systemRms: 0.05)
        ]
        let chunks = [
            ChunkEmbedding(speakerId: "S1", chunkIndex: 0, speakerIndex: 0, startTimeSeconds: 0.0, endTimeSeconds: 0.3, embedding256: wrongDim),
            ChunkEmbedding(speakerId: "S1", chunkIndex: 1, speakerIndex: 0, startTimeSeconds: 0.3, endTimeSeconds: 0.6, embedding256: zeroNorm),
            ChunkEmbedding(speakerId: "S1", chunkIndex: 2, speakerIndex: 0, startTimeSeconds: 0.6, endTimeSeconds: 0.9, embedding256: nanVec),
            ChunkEmbedding(speakerId: "S1", chunkIndex: 3, speakerIndex: 0, startTimeSeconds: 0.9, endTimeSeconds: 1.2, embedding256: infVec),
            ChunkEmbedding(speakerId: "S1", chunkIndex: 4, speakerIndex: 0, startTimeSeconds: 1.2, endTimeSeconds: 1.8, embedding256: valid),
        ]
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FixtureDiarizer(turns: turns, chunkEmbeddings: chunks),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: windows),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "test"
        )
        let output = try await coordinator.analyze(
            mixedURL: URL(fileURLWithPath: "/dummy/mixed.wav"),
            micURL: URL(fileURLWithPath: "/dummy/mic.wav"),
            systemURL: URL(fileURLWithPath: "/dummy/system.wav")
        )
        XCTAssertEqual(output.turns.count, 1)
        XCTAssertEqual(output.turns[0].cluster, "S1")
        let s1Evidence = try XCTUnwrap(output.clusterEvidence?.first { $0.cluster == "S1" })
        XCTAssertEqual(s1Evidence.cleanChunkCount, 1)
        XCTAssertEqual(s1Evidence.embedding.count, 256)
    }

    func testNonCollinearCentroidNormalizedToUnitLength() async throws {
        var v1 = [Float](repeating: 0.0, count: 256)
        v1[0] = 1.0
        var v2 = [Float](repeating: 0.0, count: 256)
        v2[1] = 1.0
        let turns = [
            SpeakerEvidenceTurn(startTime: 0.0, endTime: 3.0, cluster: "S1")
        ]
        let windows = [
            SpeakerEnergyWindow(startTime: 0.0, endTime: 3.0, micRms: 0.001, systemRms: 0.05)
        ]
        let chunks = [
            ChunkEmbedding(speakerId: "S1", chunkIndex: 0, speakerIndex: 0, startTimeSeconds: 0.0, endTimeSeconds: 1.5, embedding256: v1),
            ChunkEmbedding(speakerId: "S1", chunkIndex: 1, speakerIndex: 0, startTimeSeconds: 1.5, endTimeSeconds: 3.0, embedding256: v2),
        ]
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FixtureDiarizer(turns: turns, chunkEmbeddings: chunks),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: windows),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "test"
        )
        let output = try await coordinator.analyze(
            mixedURL: URL(fileURLWithPath: "/dummy/mixed.wav"),
            micURL: URL(fileURLWithPath: "/dummy/mic.wav"),
            systemURL: URL(fileURLWithPath: "/dummy/system.wav")
        )
        let s1 = try XCTUnwrap(output.clusterEvidence?.first)
        let norm = sqrt(s1.embedding.reduce(0) { $0 + $1 * $1 })
        XCTAssertEqual(norm, 1.0, accuracy: 1e-4)
        XCTAssertEqual(s1.embedding[0], Float(1.0 / sqrt(2.0)), accuracy: 1e-4)
        XCTAssertEqual(s1.embedding[1], Float(1.0 / sqrt(2.0)), accuracy: 1e-4)
        XCTAssertEqual(s1.minimumChunkSimilarity, 1.0 / sqrt(2.0), accuracy: 1e-4)
        XCTAssertEqual(s1.meanChunkSimilarity, 1.0 / sqrt(2.0), accuracy: 1e-4)
    }

    func testDiarizationFailureRetainsExistingFailureBehavior() async throws {
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FailingDiarizer(),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: [
                SpeakerEnergyWindow(startTime: 0, endTime: 1, micRms: 0, systemRms: 0.2)
            ]),
            manifest: ProductionDiarizationManifest.current,
            runtimeVersion: "test"
        )
        do {
            _ = try await coordinator.analyze(
                mixedURL: URL(fileURLWithPath: "/dummy/mixed.wav"),
                micURL: URL(fileURLWithPath: "/dummy/mic.wav"),
                systemURL: URL(fileURLWithPath: "/dummy/system.wav")
            )
            XCTFail("Should have thrown diarizationFailed")
        } catch let failure as RuntimeFailure {
            XCTAssertEqual(failure, RuntimeFailure.diarizationFailed)
        }
    }
}
