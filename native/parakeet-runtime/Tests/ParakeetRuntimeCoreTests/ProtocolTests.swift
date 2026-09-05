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

    func testDecodesSpeakerEvidenceRequestWithThreeSealedPaths() throws {
        let data = Data(#"{"schemaVersion":1,"id":"speaker-1","method":"speaker_evidence","mixedAudioPath":"/approved/mixed.wav","micAudioPath":"/approved/mic.wav","systemAudioPath":"/approved/system.wav"}"#.utf8)

        let request = try JSONDecoder().decode(RuntimeRequest.self, from: data)

        XCTAssertEqual(request.method, .speakerEvidence)
        XCTAssertEqual(request.mixedAudioPath, "/approved/mixed.wav")
        XCTAssertEqual(request.micAudioPath, "/approved/mic.wav")
        XCTAssertEqual(request.systemAudioPath, "/approved/system.wav")
    }

    func testRejectsIncompleteOrMethodIncompatibleSpeakerEvidencePaths() throws {
        let incomplete = Data(#"{"schemaVersion":1,"id":"speaker-1","method":"speaker_evidence","mixedAudioPath":"/approved/mixed.wav","micAudioPath":"/approved/mic.wav"}"#.utf8)
        let incompatible = Data(#"{"schemaVersion":1,"id":"transcribe-1","method":"transcribe","audioPath":"/approved/mixed.wav","micAudioPath":"/approved/mic.wav"}"#.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(RuntimeRequest.self, from: incomplete))
        XCTAssertThrowsError(try JSONDecoder().decode(RuntimeRequest.self, from: incompatible))
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

    func testEncodesContentFreeSpeakerEvidenceSuccessPayload() throws {
        let response = RuntimeResponse.speakerEvidence(
            id: "speaker-1",
            output: SpeakerEvidenceOutput(
                turns: [
                    SpeakerEvidenceTurn(startTime: 0, endTime: 1.25, cluster: "speaker-0")
                ],
                energyWindows: [
                    SpeakerEnergyWindow(
                        startTime: 0,
                        endTime: 0.1,
                        micRms: 0.2,
                        systemRms: 0.01
                    )
                ],
                provenance: SpeakerEvidenceProvenance(
                    modelIdentifier: "offline-diarizer",
                    modelRevision: String(repeating: "a", count: 40),
                    artifactDigest: String(repeating: "b", count: 64),
                    runtimeVersion: "fluidaudio-0.15.5"
                ),
                timings: SpeakerEvidenceTimings(
                    diarizationMs: 10,
                    energyAnalysisMs: 2,
                    totalMs: 12
                ),
                windowSeconds: 0.1
            )
        )

        let data = try JSONEncoder().encode(response)
        let decoded = try JSONDecoder().decode(RuntimeResponse.self, from: data)
        let encoded = try XCTUnwrap(String(data: data, encoding: .utf8))

        XCTAssertEqual(decoded.result?.speakerEvidence?.turns.first?.cluster, "speaker-0")
        XCTAssertEqual(decoded.result?.speakerEvidence?.energyWindows.first?.micRms, 0.2)
        XCTAssertFalse(encoded.contains("transcript"))
        XCTAssertFalse(encoded.contains("audioPath"))
        XCTAssertFalse(encoded.contains("embedding"))
    }

    func testEncodesAndDecodesSpeakerClusterEvidence() throws {
        let embedding = [Float](repeating: 0.1, count: 256)
        let clusterEvidence = [
            SpeakerClusterEvidence(
                cluster: "S1",
                embedding: embedding,
                cleanChunkCount: 3,
                cleanSegmentCount: 2,
                cleanDurationSeconds: 4.5,
                minimumChunkSimilarity: 0.82,
                meanChunkSimilarity: 0.88
            )
        ]
        let response = RuntimeResponse.speakerEvidence(
            id: "speaker-2",
            output: SpeakerEvidenceOutput(
                turns: [
                    SpeakerEvidenceTurn(startTime: 0, endTime: 2.0, cluster: "S1")
                ],
                energyWindows: [
                    SpeakerEnergyWindow(
                        startTime: 0,
                        endTime: 0.1,
                        micRms: 0.01,
                        systemRms: 0.2
                    )
                ],
                provenance: SpeakerEvidenceProvenance(
                    modelIdentifier: "offline-diarizer",
                    modelRevision: String(repeating: "a", count: 40),
                    artifactDigest: String(repeating: "b", count: 64),
                    runtimeVersion: "fluidaudio-0.15.5",
                    profileAlgorithmVersion: "v1"
                ),
                timings: SpeakerEvidenceTimings(
                    diarizationMs: 15,
                    energyAnalysisMs: 3,
                    totalMs: 18
                ),
                windowSeconds: 0.1,
                clusterEvidence: clusterEvidence
            )
        )

        let data = try JSONEncoder().encode(response)
        let decoded = try JSONDecoder().decode(RuntimeResponse.self, from: data)
        let evidence = try XCTUnwrap(decoded.result?.speakerEvidence?.clusterEvidence)

        XCTAssertEqual(evidence.count, 1)
        XCTAssertEqual(evidence[0].cluster, "S1")
        XCTAssertEqual(evidence[0].embedding.count, 256)
        XCTAssertEqual(evidence[0].cleanChunkCount, 3)
        XCTAssertEqual(evidence[0].cleanSegmentCount, 2)
        XCTAssertEqual(evidence[0].cleanDurationSeconds, 4.5, accuracy: 1e-4)
        XCTAssertEqual(evidence[0].minimumChunkSimilarity, 0.82, accuracy: 1e-4)
        XCTAssertEqual(evidence[0].meanChunkSimilarity, 0.88, accuracy: 1e-4)
        XCTAssertEqual(
            decoded.result?.speakerEvidence?.provenance.profileAlgorithmVersion,
            "v1"
        )
    }
}
