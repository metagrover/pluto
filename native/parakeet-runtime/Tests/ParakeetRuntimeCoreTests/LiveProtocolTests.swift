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

    func testValidBatchRequestsPreserveAllowedNullOptionals() throws {
        let requests = [
            #"{"schemaVersion":1,"id":"p","method":"prepare","modelRoot":null}"#,
            #"{"schemaVersion":1,"id":"t","method":"transcribe","audioPath":null,"language":null,"vocabulary":null}"#,
            #"{"schemaVersion":1,"id":"c","method":"cancel","targetId":null}"#,
            #"{"schemaVersion":1,"id":"s","method":"shutdown"}"#,
        ]

        for json in requests {
            XCTAssertNoThrow(
                try decoder.decode(RuntimeRequest.self, from: Data(json.utf8)))
        }
    }

    func testRejectsMethodIncompatibleKnownKeysEvenWhenNull() {
        let invalid = [
            #"{"schemaVersion":1,"id":"p","method":"prepare","audioPath":null}"#,
            #"{"schemaVersion":1,"id":"t","method":"transcribe","modelRoot":null}"#,
            #"{"schemaVersion":1,"id":"c","method":"cancel","vocabulary":null}"#,
            #"{"schemaVersion":1,"id":"s","method":"shutdown","targetId":null}"#,
            #"{"schemaVersion":1,"id":"p","method":"prepare","streamId":null}"#,
            #"{"schemaVersion":1,"id":"o","method":"stream_open","streamId":"s","source":"mic","generation":1,"audioPath":null}"#,
            #"{"schemaVersion":1,"id":"a","method":"stream_append","streamId":"s","source":"mic","generation":1,"sequence":1,"audioPath":"/approved/a.wav","chunkStartSeconds":0,"chunkEndSeconds":1,"targetId":null}"#,
        ]

        assertAllReject(invalid)
    }

    func testEncodingRejectsMethodIncompatibleProgrammaticFields() {
        let identity = LiveRequestMetadata(
            streamId: "stream-01",
            source: .mic,
            generation: 1
        )
        let append = LiveRequestMetadata(
            streamId: "stream-01",
            source: .mic,
            generation: 1,
            sequence: 1,
            chunkStartSeconds: 0,
            chunkEndSeconds: 1
        )
        let invalid = [
            RuntimeRequest(id: "p", method: .prepare, audioPath: "/approved/a.wav"),
            RuntimeRequest(id: "t", method: .transcribe, modelRoot: "/approved/models"),
            RuntimeRequest(id: "c", method: .cancel, vocabulary: ["Pluto"]),
            RuntimeRequest(id: "s", method: .shutdown, targetId: "t"),
            RuntimeRequest(id: "p-live", method: .prepare, live: identity),
            RuntimeRequest(
                id: "o",
                method: .streamOpen,
                modelRoot: "/approved/models",
                live: identity
            ),
            RuntimeRequest(
                id: "a",
                method: .streamAppend,
                audioPath: "/approved/a.wav",
                targetId: "other",
                live: append
            ),
        ]

        for request in invalid {
            XCTAssertThrowsError(
                try encoder.encode(request),
                "Expected encoding rejection for \(request.method.rawValue)"
            )
        }
    }

    func testProgrammaticRequestsRoundTripOnlyTheirAllowedFields() throws {
        let identity = LiveRequestMetadata(
            streamId: "stream-01",
            source: .system,
            generation: 1
        )
        let append = LiveRequestMetadata(
            streamId: "stream-01",
            source: .system,
            generation: 1,
            sequence: 1,
            chunkStartSeconds: 0,
            chunkEndSeconds: 1
        )
        let requests = [
            RuntimeRequest(id: "p", method: .prepare, modelRoot: "/approved/models"),
            RuntimeRequest(
                id: "t",
                method: .transcribe,
                audioPath: "/approved/a.wav",
                language: "en",
                vocabulary: ["Pluto"]
            ),
            RuntimeRequest(id: "c", method: .cancel, targetId: "t"),
            RuntimeRequest(id: "s", method: .shutdown),
            RuntimeRequest(id: "o", method: .streamOpen, live: identity),
            RuntimeRequest(id: "f", method: .streamFlush, live: identity),
            RuntimeRequest(id: "lc", method: .streamCancel, live: identity),
            RuntimeRequest(id: "r", method: .streamReset, live: identity),
            RuntimeRequest(
                id: "a",
                method: .streamAppend,
                audioPath: "/approved/a.wav",
                live: append
            ),
        ]

        for request in requests {
            let decoded = try decoder.decode(
                RuntimeRequest.self,
                from: encoder.encode(request)
            )
            XCTAssertEqual(decoded, request)
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
                    revision: 3,
                    qualifiesPriorTentative: true,
                    text: "synthetic",
                    confidence: 0.9,
                    audioEndSeconds: 25
                )),
            .streamDegraded(
                LiveStreamDegraded(
                    streamId: "s",
                    source: .system,
                    generation: 2,
                    revision: 4,
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
                    revision: 5,
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
                revision: 3,
                qualifiesPriorTentative: true,
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
        XCTAssertEqual(object["committedThroughSequence"] as? Int, 0)
        XCTAssertEqual(object["tentativeThroughSequence"] as? Int, 0)
        XCTAssertNil(object["payload"])
    }

    func testUpdateEncodesQualifiesPriorTentativeKeyExactly() throws {
        let event = RuntimeEvent.streamUpdate(
            LiveStreamUpdate(
                streamId: "stream-01",
                source: .mic,
                generation: 1,
                revision: 1,
                qualifiesPriorTentative: true,
                text: "synthetic",
                confidence: 0.5,
                audioEndSeconds: 1
            ))

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoder.encode(event)) as? [String: Any])
        XCTAssertEqual(object["qualifiesPriorTentative"] as? Bool, true)
        XCTAssertNil(object["priorTentativeQualified"])
    }

    func testRejectsUpdateWithInvalidSequenceWatermarks() {
        assertAllEventsReject([
            #"{"schemaVersion":1,"kind":"event","event":"stream_update","streamId":"s","source":"mic","generation":1,"revision":1,"qualifiesPriorTentative":false,"committedThroughSequence":1,"tentativeThroughSequence":0,"text":"synthetic","confidence":0.5,"audioEndSeconds":1}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_update","streamId":"s","source":"mic","generation":1,"revision":1,"qualifiesPriorTentative":false,"committedThroughSequence":0.5,"tentativeThroughSequence":1,"text":"synthetic","confidence":0.5,"audioEndSeconds":1}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_update","streamId":"s","source":"mic","generation":1,"revision":1,"qualifiesPriorTentative":false,"committedThroughSequence":0,"tentativeThroughSequence":9007199254740992,"text":"synthetic","confidence":0.5,"audioEndSeconds":1}"#,
        ])
    }

    func testUpdateRejectsLegacyPriorTentativeQualifiedKey() {
        let legacy = Data(
            #"{"schemaVersion":1,"kind":"event","event":"stream_update","streamId":"stream-01","source":"mic","generation":1,"revision":1,"priorTentativeQualified":false,"text":"synthetic","confidence":0.5,"audioEndSeconds":1}"#
                .utf8)

        XCTAssertThrowsError(try decoder.decode(RuntimeEvent.self, from: legacy))
    }

    func testUpdateEncodesRevisionKeyExactly() throws {
        let event = RuntimeEvent.streamUpdate(
            LiveStreamUpdate(
                streamId: "s",
                source: .mic,
                generation: 1,
                revision: 7,
                qualifiesPriorTentative: false,
                text: "synthetic",
                confidence: 0.5,
                audioEndSeconds: 1
            ))

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoder.encode(event)) as? [String: Any])
        XCTAssertEqual(object["revision"] as? Int, 7)
        XCTAssertNil(object["eventSequence"])
    }

    func testUpdateRejectsLegacyEventSequenceKey() {
        let legacy = Data(
            #"{"schemaVersion":1,"kind":"event","event":"stream_update","streamId":"s","source":"mic","generation":1,"eventSequence":1,"qualifiesPriorTentative":false,"text":"synthetic","confidence":0.5,"audioEndSeconds":1}"#
                .utf8)

        XCTAssertThrowsError(try decoder.decode(RuntimeEvent.self, from: legacy))
    }

    func testRejectsMalformedUpdateNumbersAndIdentity() {
        let base =
            #"{"schemaVersion":1,"kind":"event","event":"stream_update","streamId":"s","source":"mic","generation":1,"revision":1,"qualifiesPriorTentative":false,"text":"synthetic","confidence":0.5,"audioEndSeconds":1}"#
        let invalid = [
            base.replacingOccurrences(of: #""streamId":"s""#, with: #""streamId":"""#),
            base.replacingOccurrences(of: #""source":"mic""#, with: #""source":"mixed""#),
            base.replacingOccurrences(of: #""generation":1"#, with: #""generation":0"#),
            base.replacingOccurrences(of: #""revision":1"#, with: #""revision":0"#),
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
            #"{"schemaVersion":1,"kind":"response","event":"stream_failed","streamId":"s","source":"mic","generation":1,"revision":1,"reason":"inference_failed"}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_unknown","streamId":"s","source":"mic","generation":1,"revision":1}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_degraded","streamId":"s","source":"mic","generation":1,"revision":1,"reason":"private path /tmp/a.wav"}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_failed","streamId":"s","source":"mic","generation":1,"revision":1,"reason":"model said private transcript"}"#,
        ]

        assertAllEventsReject(invalid)
    }

    func testRejectsInvalidDegradedAffectedRange() {
        let invalid = [
            #"{"schemaVersion":1,"kind":"event","event":"stream_degraded","streamId":"s","source":"mic","generation":1,"revision":1,"reason":"partial_window","affectedSequence":0,"chunkStartSeconds":0,"chunkEndSeconds":1}"#,
            #"{"schemaVersion":1,"kind":"event","event":"stream_degraded","streamId":"s","source":"mic","generation":1,"revision":1,"reason":"partial_window","affectedSequence":1,"chunkStartSeconds":2,"chunkEndSeconds":1}"#,
        ]

        assertAllEventsReject(invalid)
    }

    func testEventAndResponseEnvelopesAreDiscriminated() throws {
        let event = Data(
            #"{"schemaVersion":1,"kind":"event","event":"stream_failed","streamId":"s","source":"mic","generation":1,"revision":1,"reason":"inference_failed","id":"misleading","ok":false}"#
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
            revision: 1,
            qualifiesPriorTentative: false,
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

    func testRejectsNonOpaqueStreamIdentifiers() {
        let tooLong = String(repeating: "a", count: 129)
        let invalid = [
            "/private/audio.wav",
            "private meeting transcript",
            "../stream",
            "stream/01",
            "stream-🔒",
            tooLong,
        ].map {
            #"{"schemaVersion":1,"id":"o","method":"stream_open","streamId":"\#($0)","source":"mic","generation":1}"#
        }

        assertAllReject(invalid)
    }

    func testAcceptsBoundedOpaqueStreamIdentifier() throws {
        let data = Data(
            #"{"schemaVersion":1,"id":"o","method":"stream_open","streamId":"stream_01:mic.v1","source":"mic","generation":1}"#
                .utf8)

        let request = try decoder.decode(RuntimeRequest.self, from: data)

        XCTAssertEqual(request.live?.streamId, "stream_01:mic.v1")
    }

    func testDiagnosticsRedactOpaqueStreamIdentifier() {
        let update = LiveStreamUpdate(
            streamId: "opaque-123",
            source: .mic,
            generation: 1,
            revision: 1,
            qualifiesPriorTentative: false,
            text: "synthetic",
            confidence: 0.5,
            audioEndSeconds: 1
        )
        let failurePayload = LiveStreamFailed(
            streamId: "opaque-123",
            source: .mic,
            generation: 1,
            revision: 2,
            reason: .inferenceFailed
        )
        let degradationPayload = LiveStreamDegraded(
            streamId: "opaque-123",
            source: .mic,
            generation: 1,
            revision: 3,
            reason: .partialWindow
        )
        let failed = RuntimeEvent.streamFailed(failurePayload)

        XCTAssertFalse(String(describing: update).contains("opaque-123"))
        XCTAssertFalse(String(reflecting: update).contains("opaque-123"))
        XCTAssertFalse(String(describing: failurePayload).contains("opaque-123"))
        XCTAssertFalse(String(reflecting: failurePayload).contains("opaque-123"))
        XCTAssertFalse(String(describing: degradationPayload).contains("opaque-123"))
        XCTAssertFalse(String(reflecting: degradationPayload).contains("opaque-123"))
        XCTAssertFalse(String(describing: failed).contains("opaque-123"))
        XCTAssertFalse(String(reflecting: failed).contains("opaque-123"))
    }

    func testRejectsEncodingMalformedDegradedIdentity() {
        let event = RuntimeEvent.streamDegraded(
            LiveStreamDegraded(
                streamId: "",
                source: .mic,
                generation: 1,
                revision: 1,
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
