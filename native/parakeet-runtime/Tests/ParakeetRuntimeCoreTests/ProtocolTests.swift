import Foundation
import XCTest
@testable import ParakeetRuntimeCore

final class ProtocolTests: XCTestCase {
    func testDecodesPrepareRequest() throws {
        let data = Data(#"{"schemaVersion":1,"id":"request-1","method":"prepare","modelRoot":"/approved/models"}"#.utf8)

        let request = try JSONDecoder().decode(RuntimeRequest.self, from: data)

        XCTAssertEqual(request.schemaVersion, 1)
        XCTAssertEqual(request.id, "request-1")
        XCTAssertEqual(request.method, .prepare)
        XCTAssertEqual(request.modelRoot, "/approved/models")
    }

    func testDecodesTranscribeRequestWithBoundedVocabulary() throws {
        let data = Data(#"{"schemaVersion":1,"id":"request-2","method":"transcribe","audioPath":"/approved/audio.wav","language":"en","vocabulary":["Pluto","FluidAudio"]}"#.utf8)

        let request = try JSONDecoder().decode(RuntimeRequest.self, from: data)

        XCTAssertEqual(request.method, .transcribe)
        XCTAssertEqual(request.audioPath, "/approved/audio.wav")
        XCTAssertEqual(request.language, "en")
        XCTAssertEqual(request.vocabulary, ["Pluto", "FluidAudio"])
    }

    func testDecodesCancellationTarget() throws {
        let data = Data(#"{"schemaVersion":1,"id":"request-3","method":"cancel","targetId":"request-2"}"#.utf8)

        let request = try JSONDecoder().decode(RuntimeRequest.self, from: data)

        XCTAssertEqual(request.method, .cancel)
        XCTAssertEqual(request.targetId, "request-2")
    }

    func testFailureResponseContainsOnlyStableCode() throws {
        let response = RuntimeResponse.failure(
            id: "request-2",
            code: .pathNotAllowed
        )

        let encoded = try XCTUnwrap(String(data: JSONEncoder().encode(response), encoding: .utf8))

        XCTAssertTrue(encoded.contains("parakeet_path_not_allowed"))
        XCTAssertFalse(encoded.contains("private.wav"))
        XCTAssertFalse(encoded.contains("message"))
        XCTAssertFalse(encoded.contains("detail"))
    }
}
