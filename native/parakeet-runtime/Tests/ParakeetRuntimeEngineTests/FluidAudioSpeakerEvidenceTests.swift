import Foundation
import XCTest
@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

private struct FixtureDiarizer: OfflineSpeakerDiarizing {
    let turns: [SpeakerEvidenceTurn]

    func diarize(audioURL _: URL) async throws -> [SpeakerEvidenceTurn] { turns }
}

private actor CapturingDiarizer: OfflineSpeakerDiarizing {
    private var receivedURLs: [URL] = []

    func diarize(audioURL: URL) async throws -> [SpeakerEvidenceTurn] {
        receivedURLs.append(audioURL)
        let cluster = audioURL.lastPathComponent == "mic.wav" ? "M1" : "S1"
        return [SpeakerEvidenceTurn(startTime: 0, endTime: 1, cluster: cluster)]
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
    func diarize(audioURL _: URL) async throws -> [SpeakerEvidenceTurn] {
        throw CancellationError()
    }
}

final class FluidAudioSpeakerEvidenceTests: XCTestCase {
    func testCoordinatorDiarizesTheSystemAndMicrophoneRecordingsIndependently() async throws {
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
        XCTAssertEqual(capturedURLs.map(\.path), [
            "/approved/system.wav",
            "/approved/mic.wav"
        ])
        XCTAssertEqual(output.turns.map(\.cluster), ["S1"])
        XCTAssertEqual(output.micTurns.map(\.cluster), ["M1"])
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
        XCTAssertEqual(output.micTurns.map(\.cluster), ["S1"])
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
        XCTAssertTrue(output.micTurns.isEmpty)
        XCTAssertEqual(output.energyWindows.count, 1)
    }

    func testCoordinatorPreservesCancellation() async throws {
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: CancellingDiarizer(),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: []),
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
}
