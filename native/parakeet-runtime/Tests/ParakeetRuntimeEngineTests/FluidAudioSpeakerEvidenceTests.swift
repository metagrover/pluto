import Foundation
import XCTest
@testable import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine

private struct FixtureDiarizer: OfflineSpeakerDiarizing {
    let turns: [SpeakerEvidenceTurn]

    func diarize(audioURL _: URL) async throws -> [SpeakerEvidenceTurn] { turns }
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

    func testCoordinatorRejectsEmptyDiarization() async throws {
        let coordinator = SpeakerEvidenceCoordinator(
            diarizer: FixtureDiarizer(turns: []),
            energyAnalyzer: FixtureEnergyAnalyzer(windows: [
                SpeakerEnergyWindow(startTime: 0, endTime: 0.1, micRms: 0, systemRms: 0)
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
            XCTFail("Expected diarization failure")
        } catch let failure as RuntimeFailure {
            XCTAssertEqual(failure, .diarizationFailed)
        }
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
