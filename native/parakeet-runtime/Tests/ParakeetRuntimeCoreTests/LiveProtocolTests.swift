import Foundation
import XCTest

@testable import ParakeetRuntimeCore

final class LiveProtocolTests: XCTestCase {
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    func testDecodesEveryLiveRequestMethod() throws {
        let cases: [(String, RuntimeMethod, Int?)] = [
            (
                #"{"schemaVersion":1,"id":"open","method":"stream_open","streamId":"s","source":"mic","generation":1}"#,
                .streamOpen, nil
            ),
            (
                #"{"schemaVersion":1,"id":"append","method":"stream_append","streamId":"s","source":"system","generation":2,"sequence":4,"audioPath":"/approved/4.wav","chunkStartSeconds":20,"chunkEndSeconds":25}"#,
                .streamAppend, 4
            ),
            (
                #"{"schemaVersion":1,"id":"flush","method":"stream_flush","streamId":"s","source":"system","generation":2}"#,
                .streamFlush, nil
            ),
            (
                #"{"schemaVersion":1,"id":"cancel","method":"stream_cancel","streamId":"s","source":"system","generation":2}"#,
                .streamCancel, nil
            ),
            (
                #"{"schemaVersion":1,"id":"reset","method":"stream_reset","streamId":"s","source":"system","generation":3}"#,
                .streamReset, nil
            ),
        ]

        for (json, method, sequence) in cases {
            let request = try decoder.decode(RuntimeRequest.self, from: Data(json.utf8))
            XCTAssertEqual(request.schemaVersion, 1)
            XCTAssertEqual(request.method, method)
            XCTAssertEqual(request.live?.streamId, "s")
            XCTAssertEqual(
                request.live?.generation, method == .streamOpen ? 1 : method == .streamReset ? 3 : 2
            )
            XCTAssertEqual(request.live?.sequence, sequence)
            XCTAssertEqual(
                try decoder.decode(RuntimeRequest.self, from: encoder.encode(request)),
                request
            )
        }
    }

    func testAppendRetainsOnlyApprovedPathAndBoundariesInLiveMetadata() throws {
        let data = Data(
            #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"system","generation":2,"sequence":4,"audioPath":"/approved/4.wav","chunkStartSeconds":20,"chunkEndSeconds":25}"#
                .utf8)

        let request = try decoder.decode(RuntimeRequest.self, from: data)

        XCTAssertEqual(request.method, .streamAppend)
        XCTAssertEqual(request.audioPath, "/approved/4.wav")
        XCTAssertEqual(request.live?.source, .system)
        XCTAssertEqual(request.live?.sequence, 4)
        XCTAssertEqual(request.live?.chunkStartSeconds, 20)
        XCTAssertEqual(request.live?.chunkEndSeconds, 25)
    }

    func testExistingBatchRequestsRemainDecodable() throws {
        let requests = [
            #"{"schemaVersion":1,"id":"p","method":"prepare","modelRoot":"/approved/models"}"#,
            #"{"schemaVersion":1,"id":"t","method":"transcribe","audioPath":"/approved/audio.wav","language":"en","vocabulary":["Pluto"]}"#,
            #"{"schemaVersion":1,"id":"c","method":"cancel","targetId":"t"}"#,
            #"{"schemaVersion":1,"id":"s","method":"shutdown"}"#,
        ]

        for json in requests {
            let request = try decoder.decode(RuntimeRequest.self, from: Data(json.utf8))
            XCTAssertNil(request.live)
        }
    }

    func testRejectsMalformedLiveRequestIdentityAndSource() {
        let invalid = [
            #"{"schemaVersion":2,"id":"a","method":"stream_open","streamId":"s","source":"mic","generation":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_open","source":"mic","generation":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_open","streamId":"","source":"mic","generation":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_open","streamId":"s","generation":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_open","streamId":"s","source":"mixed","generation":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_open","streamId":"s","source":"mic","generation":0}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_open","streamId":"s","source":"mic","generation":-1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_open","streamId":"s","source":"mic","generation":9007199254740992}"#,
        ]

        assertAllReject(invalid)
    }

    func testRejectsEncodingLiveMethodWithoutValidatedMetadata() {
        let request = RuntimeRequest(id: "a", method: .streamOpen)

        XCTAssertThrowsError(try encoder.encode(request))
    }

    func testRejectsAppendWithoutPositiveSafeSequenceOrApprovedPath() {
        let invalid = [
            #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"mic","generation":1,"audioPath":"/approved/a.wav","chunkStartSeconds":0,"chunkEndSeconds":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"mic","generation":1,"sequence":0,"audioPath":"/approved/a.wav","chunkStartSeconds":0,"chunkEndSeconds":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"mic","generation":1,"sequence":9007199254740992,"audioPath":"/approved/a.wav","chunkStartSeconds":0,"chunkEndSeconds":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"mic","generation":1,"sequence":1,"chunkStartSeconds":0,"chunkEndSeconds":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"mic","generation":1,"sequence":1,"audioPath":"","chunkStartSeconds":0,"chunkEndSeconds":1}"#,
        ]

        assertAllReject(invalid)
    }

    func testRejectsInvalidAppendBoundaries() {
        let invalid = [
            appendJSON(start: "-1", end: "1"),
            appendJSON(start: "0", end: "-1"),
            appendJSON(start: "1", end: "1"),
            appendJSON(start: "2", end: "1"),
            appendJSON(start: "1e400", end: "2"),
            appendJSON(start: "0", end: "1e400"),
        ]

        assertAllReject(invalid)
    }

    func testRejectsAppendOnlyFieldsOnOtherLiveMethods() {
        let invalid = [
            #"{"schemaVersion":1,"id":"a","method":"stream_open","streamId":"s","source":"mic","generation":1,"audioPath":"/approved/a.wav"}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_flush","streamId":"s","source":"mic","generation":1,"sequence":1}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_cancel","streamId":"s","source":"mic","generation":1,"chunkStartSeconds":0}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_reset","streamId":"s","source":"mic","generation":2,"chunkEndSeconds":1}"#,
        ]

        assertAllReject(invalid)
    }

    func testEncodesAndDecodesEveryLiveEvent() throws {
        let events: [RuntimeEvent] = [
            .streamUpdate(
                LiveStreamUpdate(
                    streamId: "s",
                    source: .system,
                    generation: 2,
                    eventSequence: 3,
                    priorTentativeQualified: true,
                    text: "synthetic",
                    confidence: 0.9,
                    audioEndSeconds: 25
                )),
            .streamDegraded(
                LiveStreamDegraded(
                    streamId: "s",
                    source: .system,
                    generation: 2,
                    eventSequence: 4,
                    reason: .partialWindow,
                    affectedSequence: 4,
                    chunkStartSeconds: 20,
                    chunkEndSeconds: 25
                )),
            .streamFailed(
                LiveStreamFailed(
                    streamId: "s",
                    source: .system,
                    generation: 2,
                    eventSequence: 5,
                    reason: .inferenceFailed
                )),
        ]

        for event in events {
            XCTAssertEqual(event.kind, .event)
            let data = try encoder.encode(event)
            XCTAssertEqual(try decoder.decode(RuntimeEvent.self, from: data), event)
            let encoded = try XCTUnwrap(String(data: data, encoding: .utf8))
            XCTAssertFalse(encoded.contains("message"))
            XCTAssertFalse(encoded.contains("detail"))
            if case .streamUpdate = event {
                XCTAssertTrue(encoded.contains("synthetic"))
            } else {
                XCTAssertFalse(encoded.contains("text"))
            }
        }
    }

    func testUpdateUsesFlatEventEnvelopeAndBoundedConfidence() throws {
        let event = RuntimeEvent.streamUpdate(
            LiveStreamUpdate(
                streamId: "s",
                source: .system,
                generation: 2,
                eventSequence: 3,
                priorTentativeQualified: true,
                text: "synthetic",
                confidence: 0.9,
                audioEndSeconds: 25
            ))

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoder.encode(event)) as? [String: Any])
        XCTAssertEqual(object["schemaVersion"] as? Int, 1)
        XCTAssertEqual(object["kind"] as? String, "event")
        XCTAssertEqual(object["event"] as? String, "stream_update")
        XCTAssertEqual(object["text"] as? String, "synthetic")
        XCTAssertNil(object["payload"])
    }

    func testRejectsMalformedUpdateNumbersAndIdentity() {
        let base =
            #"{"schemaVersion":1,"kind":"event","event":"stream_update","streamId":"s","source":"mic","generation":1,"eventSequence":1,"priorTentativeQualified":false,"text":"synthetic","confidence":0.5,"audioEndSeconds":1}"#
        let invalid = [
            base.replacingOccurrences(of: #""streamId":"s""#, with: #""streamId":"""#),
            base.replacingOccurrences(of: #""source":"mic""#, with: #""source":"mixed""#),
            base.replacingOccurrences(of: #""generation":1"#, with: #""generation":0"#),
            base.replacingOccurrences(of: #""eventSequence":1"#, with: #""eventSequence":0"#),
            base.replacingOccurrences(of: #""confidence":0.5"#, with: #""confidence":-0.1"#),
            base.replacingOccurrences(of: #""confidence":0.5"#, with: #""confidence":1.1"#),
            base.replacingOccurrences(of: #""confidence":0.5"#, with: #""confidence":1e400"#),
            base.replacingOccurrences(of: #""audioEndSeconds":1"#, with: #""audioEndSeconds":-1"#),
            base.replacingOccurrences(
                of: #""audioEndSeconds":1"#, with: #""audioEndSeconds":1e400"#),
        ]

        assertAllEventsReject(invalid)
    }

    func testRejectsUnknownKindsEventsAndArbitraryReasons() {
        let invalid = [
            #"{"schemaVersion":1,"kind":"response","event":"stream_failed","streamId":"s","source":"mic","generation":1,"eventSequence":1,"reason":"inference_failed"}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_unknown","streamId":"s","source":"mic","generation":1,"eventSequence":1}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_degraded","streamId":"s","source":"mic","generation":1,"eventSequence":1,"reason":"private path /tmp/a.wav"}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_failed","streamId":"s","source":"mic","generation":1,"eventSequence":1,"reason":"model said private transcript"}"#,
        ]

        assertAllEventsReject(invalid)
    }

    func testRejectsInvalidDegradedAffectedRange() {
        let invalid = [
            #"{"schemaVersion":1,"kind":"event","event":"stream_degraded","streamId":"s","source":"mic","generation":1,"eventSequence":1,"reason":"partial_window","affectedSequence":0,"chunkStartSeconds":0,"chunkEndSeconds":1}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_degraded","streamId":"s","source":"mic","generation":1,"eventSequence":1,"reason":"partial_window","affectedSequence":1,"chunkStartSeconds":2,"chunkEndSeconds":1}"#,
        ]

        assertAllEventsReject(invalid)
    }

    func testEventAndResponseEnvelopesAreDiscriminated() throws {
        let event = Data(
            #"{"schemaVersion":1,"kind":"event","event":"stream_failed","streamId":"s","source":"mic","generation":1,"eventSequence":1,"reason":"inference_failed","id":"misleading","ok":false}"#
                .utf8)
        XCTAssertThrowsError(try decoder.decode(RuntimeResponse.self, from: event))

        let response = try encoder.encode(RuntimeResponse.failure(id: "a", code: .invalidRequest))
        XCTAssertThrowsError(try decoder.decode(RuntimeEvent.self, from: response))
    }

    func testDiagnosticsNeverExposeUpdateText() {
        let update = LiveStreamUpdate(
            streamId: "s",
            source: .mic,
            generation: 1,
            eventSequence: 1,
            priorTentativeQualified: false,
            text: "private synthetic transcript",
            confidence: 0.5,
            audioEndSeconds: 1
        )
        let event = RuntimeEvent.streamUpdate(update)

        XCTAssertFalse(String(describing: update).contains("private synthetic transcript"))
        XCTAssertFalse(String(reflecting: update).contains("private synthetic transcript"))
        XCTAssertFalse(String(describing: event).contains("private synthetic transcript"))
        XCTAssertFalse(String(reflecting: event).contains("private synthetic transcript"))
    }

    func testRejectsEncodingMalformedDegradedIdentity() {
        let event = RuntimeEvent.streamDegraded(
            LiveStreamDegraded(
                streamId: "",
                source: .mic,
                generation: 1,
                eventSequence: 1,
                reason: .partialWindow
            ))

        XCTAssertThrowsError(try encoder.encode(event))
    }

    private func appendJSON(start: String, end: String) -> String {
        #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"mic","generation":1,"sequence":1,"audioPath":"/approved/a.wav","chunkStartSeconds":#(start),"chunkEndSeconds":#(end)}"#
    }

    private func assertAllReject(
        _ json: [String], file: StaticString = #filePath, line: UInt = #line
    ) {
        for value in json {
            XCTAssertThrowsError(
                try decoder.decode(RuntimeRequest.self, from: Data(value.utf8)),
                "Expected rejection: \(value)",
                file: file,
                line: line
            )
        }
    }

    private func assertAllEventsReject(
        _ json: [String], file: StaticString = #filePath, line: UInt = #line
    ) {
        for value in json {
            XCTAssertThrowsError(
                try decoder.decode(RuntimeEvent.self, from: Data(value.utf8)),
                "Expected rejection: \(value)",
                file: file,
                line: line
            )
        }
    }
}
