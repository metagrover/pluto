import Foundation
import XCTest
@testable import ParakeetRuntimeCore

final class ProtocolTests: XCTestCase {
    func testSuccessPayloadOmitsUnsetFields() throws {
        let response = RuntimeResponse(
            schemaVersion: 1,
            id: "eou-open-1",
            ok: true,
            result: RuntimeResultPayload(),
            error: nil
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as? [String: Any]
        )
        XCTAssertEqual((object["result"] as? [String: Any])?.count, 0)
    }

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

    func testEncodesPreparedAndTranscriptionSuccessPayloads() throws {
        let prepared = RuntimeResponse.prepared(id: "prepare-1", modelVersion: "0.15.5-v3-int8")
        let transcribed = RuntimeResponse.transcribed(
            id: "transcribe-1",
            output: TranscriptionOutput(
                text: "hello",
                confidence: 0.9,
                durationSeconds: 1,
                words: [TranscriptionWord(text: "hello", startSeconds: 0, endSeconds: 1)],
                noSpeech: false
            ),
            vocabularyCount: 2
        )

        let preparedData = try JSONEncoder().encode(prepared)
        let transcribedData = try JSONEncoder().encode(transcribed)
        let decodedPrepared = try JSONDecoder().decode(RuntimeResponse.self, from: preparedData)
        let decodedTranscribed = try JSONDecoder().decode(RuntimeResponse.self, from: transcribedData)

        XCTAssertTrue(decodedPrepared.ok)
        XCTAssertEqual(decodedPrepared.result?.modelVersion, "0.15.5-v3-int8")
        XCTAssertEqual(decodedTranscribed.result?.transcription?.text, "hello")
        XCTAssertEqual(decodedTranscribed.result?.vocabularyCount, 2)
        XCTAssertNil(decodedTranscribed.error)
    }
}
