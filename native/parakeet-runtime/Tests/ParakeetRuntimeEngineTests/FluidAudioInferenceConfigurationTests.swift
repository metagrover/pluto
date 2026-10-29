import FluidAudio
@testable import ParakeetRuntimeEngine
import XCTest

final class FluidAudioInferenceConfigurationTests: XCTestCase {
    func testFinalTranscriptionUsesV3WithoutSpeechSuppressingMelPrefix() {
        let config = FluidAudioInferenceDriver.makeAsrConfiguration()

        XCTAssertFalse(config.melChunkContext)
        XCTAssertFalse(config.dualDecodeArbitration)
        XCTAssertEqual(config.tdtConfig.blankId, AsrModelVersion.v3.blankId)
        XCTAssertEqual(config.encoderHiddenSize, AsrModelVersion.v3.encoderHiddenSize)
        XCTAssertEqual(config.sampleRate, 16_000)
        XCTAssertEqual(config.parallelChunkConcurrency, 1)
        XCTAssertTrue(config.streamingEnabled)
        XCTAssertEqual(config.streamingThreshold, 480_000)
    }
}
