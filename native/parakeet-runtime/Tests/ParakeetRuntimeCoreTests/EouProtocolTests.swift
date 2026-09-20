import Foundation
@testable import ParakeetRuntimeCore
import XCTest

final class EouProtocolTests: XCTestCase {
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    func testDecodesAndRoundTripsEveryEouMethod() throws {
        let samples: [Float] = [0, 0.25, -0.5, 1]
        let pcm = Data(samples.flatMap { value in
            withUnsafeBytes(of: value.bitPattern.littleEndian, Array.init)
        }).base64EncodedString()
        let cases: [(String, RuntimeMethod, Int?)] = [
            (#"{"schemaVersion":1,"id":"o","method":"eou_open","streamId":"s","source":"mic","generation":1}"#, .eouOpen, nil),
            (#"{"schemaVersion":1,"id":"a","method":"eou_append","streamId":"s","source":"mic","generation":1,"sequence":1,"sampleRate":8000,"channelCount":1,"frameCount":4,"audioStartSeconds":0,"audioEndSeconds":0.0005,"pcmBase64":"\#(pcm)"}"#, .eouAppend, 1),
            (#"{"schemaVersion":1,"id":"f","method":"eou_finish","streamId":"s","source":"mic","generation":1}"#, .eouFinish, nil),
            (#"{"schemaVersion":1,"id":"c","method":"eou_cancel","streamId":"s","source":"mic","generation":1}"#, .eouCancel, nil),
            (#"{"schemaVersion":1,"id":"r","method":"eou_reset","streamId":"s","source":"mic","generation":2}"#, .eouReset, nil),
            (#"{"schemaVersion":1,"id":"ee","method":"eou_speaker_evidence_enable","streamId":"s","source":"system","generation":2}"#, .eouSpeakerEvidenceEnable, nil),
            (#"{"schemaVersion":1,"id":"ed","method":"eou_speaker_evidence_disable","streamId":"s","source":"system","generation":2}"#, .eouSpeakerEvidenceDisable, nil),
            (#"{"schemaVersion":1,"id":"e","method":"eou_speaker_evidence","streamId":"s","source":"system","generation":2}"#, .eouSpeakerEvidence, nil),
        ]

        for (json, method, sequence) in cases {
            let request = try decoder.decode(RuntimeRequest.self, from: Data(json.utf8))
            XCTAssertEqual(request.method, method)
            XCTAssertEqual(request.eou?.streamId, "s")
            XCTAssertEqual(request.eou?.sequence, sequence)
            XCTAssertEqual(try decoder.decode(RuntimeRequest.self, from: encoder.encode(request)), request)
        }

        let append = try decoder.decode(RuntimeRequest.self, from: Data(cases[1].0.utf8))
        XCTAssertEqual(append.eou?.frame?.samples, samples)
    }

    func testRejectsMalformedPcmAndFrameDeclarations() {
        let valid = makeAppendJSON()
        let invalid = [
            valid.replacingOccurrences(of: #""pcmBase64":"AAAAAA==""#, with: #""pcmBase64":"not-base64""#),
            valid.replacingOccurrences(of: #""frameCount":1"#, with: #""frameCount":2"#),
            valid.replacingOccurrences(of: #""channelCount":1"#, with: #""channelCount":2"#),
            valid.replacingOccurrences(of: #""sampleRate":8000"#, with: #""sampleRate":7999"#),
            valid.replacingOccurrences(of: #""sampleRate":8000"#, with: #""sampleRate":192001"#),
            valid.replacingOccurrences(of: #""audioStartSeconds":0"#, with: #""audioStartSeconds":-1"#),
            valid.replacingOccurrences(of: #""audioEndSeconds":0.000125"#, with: #""audioEndSeconds":3"#),
            makeAppendJSON(pcmBase64: floatBase64(bitPattern: 0x7f80_0000)),
            makeAppendJSON(pcmBase64: floatBase64(bitPattern: 0x7fc0_0000)),
        ]

        for json in invalid {
            XCTAssertThrowsError(try decoder.decode(RuntimeRequest.self, from: Data(json.utf8)))
        }
    }

    func testRejectsEouFieldsOnOtherMethodsAndAppendFieldsOnEouIdentityMethods() {
        let invalid = [
            #"{"schemaVersion":1,"id":"p","method":"prepare","pcmBase64":null}"#,
            #"{"schemaVersion":1,"id":"s","method":"stream_open","streamId":"s","source":"mic","generation":1,"sampleRate":null}"#,
            #"{"schemaVersion":1,"id":"o","method":"eou_open","streamId":"s","source":"mic","generation":1,"pcmBase64":null}"#,
            #"{"schemaVersion":1,"id":"f","method":"eou_finish","streamId":"s","source":"mic","generation":1,"sequence":1}"#,
        ]

        for json in invalid {
            XCTAssertThrowsError(try decoder.decode(RuntimeRequest.self, from: Data(json.utf8)))
        }
    }

    func testPcmDescriptionsNeverExposeSamplesOrBase64() throws {
        let request = try decoder.decode(RuntimeRequest.self, from: Data(makeAppendJSON().utf8))
        let description = String(describing: try XCTUnwrap(request.eou?.frame))

        XCTAssertTrue(description.contains("frameCount: 1"))
        XCTAssertTrue(description.contains("pcm: <redacted>"))
        XCTAssertFalse(description.contains("AAAAAA=="))
    }

    func testEouUpdatesRoundTripAndRejectInvalidTiming() throws {
        let update = EouUpdate(
            streamId: "s",
            source: .mic,
            generation: 1,
            revision: 2,
            processedAudioSeconds: 0.32,
            committedText: "synthetic committed",
            tentativeText: "synthetic tentative",
            tokens: [EouToken(text: "synthetic", startSeconds: 0, endSeconds: 0.2, committed: true)]
        )

        XCTAssertEqual(try decoder.decode(EouUpdate.self, from: encoder.encode(update)), update)
        XCTAssertFalse(String(describing: update).contains("synthetic"))

        let invalid = [
            #"{"streamId":"s","source":"mic","generation":0,"revision":1,"processedAudioSeconds":0.32,"committedText":"private","tentativeText":"","tokens":[]}"#,
            #"{"streamId":"s","source":"mic","generation":1,"revision":0,"processedAudioSeconds":0.32,"committedText":"private","tentativeText":"","tokens":[]}"#,
            #"{"streamId":"s","source":"mic","generation":1,"revision":1,"processedAudioSeconds":-1,"committedText":"private","tentativeText":"","tokens":[]}"#,
            #"{"streamId":"s","source":"mic","generation":1,"revision":1,"processedAudioSeconds":0.32,"committedText":"private","tentativeText":"","tokens":[{"text":"private","startSeconds":0.2,"endSeconds":0.1,"committed":true}]}"#,
        ]
        for json in invalid {
            XCTAssertThrowsError(try decoder.decode(EouUpdate.self, from: Data(json.utf8)))
        }
    }

    func testEouEventEnvelopesRoundTripWithoutFailureContent() throws {
        let events: [RuntimeEvent] = [
            .eouUpdate(EouUpdate(
                streamId: "s",
                source: .system,
                generation: 2,
                revision: 3,
                processedAudioSeconds: 1,
                committedText: "synthetic committed",
                tentativeText: "synthetic tentative",
                tokens: []
            )),
            .eouFailed(EouStreamFailed(
                streamId: "s",
                source: .system,
                generation: 2,
                revision: 4,
                reason: .inferenceFailed
            )),
        ]

        for event in events {
            let data = try encoder.encode(event)
            XCTAssertEqual(try decoder.decode(RuntimeEvent.self, from: data), event)
            let json = try XCTUnwrap(String(data: data, encoding: .utf8))
            if case .eouFailed = event {
                XCTAssertFalse(json.contains("synthetic"))
                XCTAssertFalse(json.contains("message"))
                XCTAssertFalse(json.contains("detail"))
            }
        }
    }

    private func makeAppendJSON(pcmBase64: String = "AAAAAA==") -> String {
        #"{"schemaVersion":1,"id":"a","method":"eou_append","streamId":"s","source":"system","generation":1,"sequence":1,"sampleRate":8000,"channelCount":1,"frameCount":1,"audioStartSeconds":0,"audioEndSeconds":0.000125,"pcmBase64":"\#(pcmBase64)"}"#
    }

    private func floatBase64(bitPattern: UInt32) -> String {
        var bits = bitPattern.littleEndian
        return withUnsafeBytes(of: &bits) { Data($0) }.base64EncodedString()
    }
}
