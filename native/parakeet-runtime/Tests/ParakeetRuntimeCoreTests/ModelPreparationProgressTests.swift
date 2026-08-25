import Foundation
@testable import ParakeetRuntimeCore
import XCTest

final class ModelPreparationProgressTests: XCTestCase {
    func testPreparationProgressEventEncodesOnlyCorrelatedByteTelemetry() throws {
        let event = RuntimePreparationProgressEvent(
            requestId: "prepare-1",
            progress: ModelPreparationProgress(
                phase: .downloading,
                downloadedBytes: 438_000_000,
                totalBytes: 986_000_000
            )
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(event))
                as? [String: Any]
        )
        XCTAssertEqual(object["schemaVersion"] as? Int, 1)
        XCTAssertEqual(object["kind"] as? String, "event")
        XCTAssertEqual(object["event"] as? String, "prepare_progress")
        XCTAssertEqual(object["requestId"] as? String, "prepare-1")
        XCTAssertEqual(object["phase"] as? String, "downloading")
        XCTAssertEqual(object["downloadedBytes"] as? Int, 438_000_000)
        XCTAssertEqual(object["totalBytes"] as? Int, 986_000_000)
        XCTAssertEqual(object.count, 7)
    }

    func testProgressClampsDownloadedBytesToTheKnownTotal() {
        let progress = ModelPreparationProgress(
            phase: .downloading,
            downloadedBytes: 12,
            totalBytes: 10
        )

        XCTAssertEqual(progress.downloadedBytes, 10)
        XCTAssertEqual(progress.totalBytes, 10)
    }
}
