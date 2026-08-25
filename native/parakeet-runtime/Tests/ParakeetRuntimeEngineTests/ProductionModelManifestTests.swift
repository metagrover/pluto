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
            "0ee0eb312901156faf2bd60159204ed8e05bf993d5dee79dc69b753583fa0ad6"
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
