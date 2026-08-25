import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

final class ProductionModelManifestTests: XCTestCase {
    func testCurrentBundlePinsEnglishEou320Assets() {
        let manifest = ProductionModelManifest.current

        XCTAssertEqual(
            manifest.eouRepository,
            "FluidInference/parakeet-realtime-eou-120m-coreml"
        )
        XCTAssertEqual(
            manifest.eouRepositoryRevision,
            "40a23f4c0b333aa17ad8c0f2ea47ec2347f2f355"
        )
        XCTAssertEqual(
            manifest.eouArtifactSHA256,
            "4a23a8120f0a5ae8f13bc778e28af239fd00747a406ffb6e98eb06c578437e7f"
        )
        XCTAssertTrue(manifest.version.contains("eou-40a23f4c"))
    }

    func testEouLayoutNamesOnlyThePinned320MillisecondDirectory() {
        XCTAssertEqual(
            FluidAudioModelLayout.eouDirectoryName,
            "parakeet-eou-streaming/320ms"
        )
    }
}
