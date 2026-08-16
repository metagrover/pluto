#if os(macOS)
import AVFoundation
import Foundation
import XCTest

@testable import FluidAudioCLI

final class AMIKaldiDataTests: XCTestCase {

    func testBuildSplitWritesExpectedKaldiFiles() throws {
        let fixture = try makeFixture(meetingId: "ES2004a")

        try AMIKaldiData.buildSplit(
            meetingIds: ["ES2004a"],
            annotationsRoot: fixture.annotationsRoot,
            audioRoot: fixture.audioRoot,
            outputDirectory: fixture.outputDirectory
        )

        for fileName in ["wav.scp", "segments", "utt2spk", "spk2utt", "reco2dur", "reco2num_spk", "utt2timestamp"] {
            let fileURL = fixture.outputDirectory.appendingPathComponent(fileName)
            XCTAssertTrue(FileManager.default.fileExists(atPath: fileURL.path), "\(fileName) should exist")
        }

        let segments = try String(contentsOf: fixture.outputDirectory.appendingPathComponent("segments"))
        XCTAssertTrue(segments.contains("ES2004a_a_00001 ES2004a 0.004000 0.126000"))
        XCTAssertTrue(segments.contains("ES2004a_b_00001 ES2004a 1.001000 1.019000"))

        let utt2spk = try String(contentsOf: fixture.outputDirectory.appendingPathComponent("utt2spk"))
        XCTAssertTrue(utt2spk.contains("ES2004a_a_00001 SpeakerA"))
        XCTAssertTrue(utt2spk.contains("ES2004a_b_00001 SpeakerB"))

        let spk2utt = try String(contentsOf: fixture.outputDirectory.appendingPathComponent("spk2utt"))
        XCTAssertTrue(spk2utt.contains("SpeakerA ES2004a_a_00001 ES2004a_a_00002 ES2004a_a_00003"))
        XCTAssertTrue(spk2utt.contains("SpeakerB ES2004a_b_00001"))

        let reco2dur = try String(contentsOf: fixture.outputDirectory.appendingPathComponent("reco2dur"))
        XCTAssertTrue(reco2dur.contains("ES2004a 2.000000"))

        let reco2numSpk = try String(contentsOf: fixture.outputDirectory.appendingPathComponent("reco2num_spk"))
        XCTAssertTrue(reco2numSpk.contains("ES2004a 2"))

        let utt2timestamp = try String(contentsOf: fixture.outputDirectory.appendingPathComponent("utt2timestamp"))
        XCTAssertTrue(utt2timestamp.contains("ES2004a_a_00003 0.601000 0.799000"))
        XCTAssertTrue(utt2timestamp.contains("ES2004a_b_00001 1.001000 1.019000"))
    }

    func testLoadDERReferenceMatchesOriginalKaldiQuantization() throws {
        let fixture = try makeFixture(meetingId: "ZZ0001")

        try AMIKaldiData.buildSplit(
            meetingIds: ["ZZ0001"],
            annotationsRoot: fixture.annotationsRoot,
            audioRoot: fixture.audioRoot,
            outputDirectory: fixture.outputDirectory
        )

        let meetingIds = try AMIKaldiData.recordingIDs(in: fixture.outputDirectory)
        XCTAssertEqual(meetingIds, ["ZZ0001"])
        XCTAssertEqual(
            try AMIKaldiData.audioPath(for: "ZZ0001", in: fixture.outputDirectory),
            fixture.audioRoot.appendingPathComponent("ZZ0001.Mix-Headset.wav").path
        )
        XCTAssertEqual(
            try XCTUnwrap(AMIKaldiData.recordingDuration(for: "ZZ0001", in: fixture.outputDirectory)),
            2.0,
            accuracy: 0.0001
        )

        let segments = try AMIKaldiData.loadDERReference(for: "ZZ0001", in: fixture.outputDirectory)
        XCTAssertEqual(segments.count, 3)

        XCTAssertEqual(segments[0].speaker, "SpeakerA")
        XCTAssertEqual(segments[0].start, 0.00, accuracy: 0.0001)
        XCTAssertEqual(segments[0].end, 0.25, accuracy: 0.0001)

        XCTAssertEqual(segments[1].speaker, "SpeakerA")
        XCTAssertEqual(segments[1].start, 0.60, accuracy: 0.0001)
        XCTAssertEqual(segments[1].end, 0.80, accuracy: 0.0001)

        XCTAssertEqual(segments[2].speaker, "SpeakerB")
        XCTAssertEqual(segments[2].start, 1.00, accuracy: 0.0001)
        XCTAssertEqual(segments[2].end, 1.02, accuracy: 0.0001)
    }

    private func makeFixture(
        meetingId: String
    ) throws -> (
        root: URL, annotationsRoot: URL, audioRoot: URL, outputDirectory: URL
    ) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let annotationsRoot = root.appendingPathComponent("ami_public_1.6.2", isDirectory: true)
        let segmentsRoot = annotationsRoot.appendingPathComponent("segments", isDirectory: true)
        let corpusRoot = annotationsRoot.appendingPathComponent("corpusResources", isDirectory: true)
        let audioRoot = root.appendingPathComponent("audio", isDirectory: true)
        let outputDirectory = root.appendingPathComponent("ami/mhs/data/test", isDirectory: true)

        try FileManager.default.createDirectory(at: segmentsRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: corpusRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: audioRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

        let meetingsXML = """
            <meetings>
              <meeting observation="\(meetingId)">
                <speaker nxt_agent="A" global_name="SpeakerA"/>
                <speaker nxt_agent="B" global_name="SpeakerB"/>
                <speaker nxt_agent="C" global_name="SpeakerC"/>
                <speaker nxt_agent="D" global_name="SpeakerD"/>
              </meeting>
            </meetings>
            """
        try meetingsXML.write(
            to: corpusRoot.appendingPathComponent("meetings.xml"),
            atomically: true,
            encoding: .utf8
        )

        let speakerASegments = """
            <nite:root xmlns:nite="http://nite.sourceforge.net/">
              <segment nite:id="a1" transcriber_start="0.004" transcriber_end="0.126"/>
              <segment nite:id="a2" transcriber_start="0.129" transcriber_end="0.254"/>
              <segment nite:id="a3" transcriber_start="0.601" transcriber_end="0.799"/>
            </nite:root>
            """
        try speakerASegments.write(
            to: segmentsRoot.appendingPathComponent("\(meetingId).A.segments.xml"),
            atomically: true,
            encoding: .utf8
        )

        let speakerBSegments = """
            <nite:root xmlns:nite="http://nite.sourceforge.net/">
              <segment nite:id="b1" transcriber_start="1.001" transcriber_end="1.019"/>
            </nite:root>
            """
        try speakerBSegments.write(
            to: segmentsRoot.appendingPathComponent("\(meetingId).B.segments.xml"),
            atomically: true,
            encoding: .utf8
        )

        let emptySegments = "<nite:root xmlns:nite=\"http://nite.sourceforge.net/\"/>"
        try emptySegments.write(
            to: segmentsRoot.appendingPathComponent("\(meetingId).C.segments.xml"),
            atomically: true,
            encoding: .utf8
        )
        try emptySegments.write(
            to: segmentsRoot.appendingPathComponent("\(meetingId).D.segments.xml"),
            atomically: true,
            encoding: .utf8
        )

        try writeAudio(
            to: audioRoot.appendingPathComponent("\(meetingId).Mix-Headset.wav"),
            durationSeconds: 2.0
        )

        return (root, annotationsRoot, audioRoot, outputDirectory)
    }

    private func writeAudio(to url: URL, durationSeconds: Double) throws {
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 8_000,
            channels: 1,
            interleaved: false
        )
        let resolvedFormat = try XCTUnwrap(format)
        let totalFrames = AVAudioFrameCount(durationSeconds * resolvedFormat.sampleRate)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: resolvedFormat, frameCapacity: totalFrames))
        buffer.frameLength = totalFrames

        let channelData = try XCTUnwrap(buffer.floatChannelData?[0])
        for frame in 0..<Int(totalFrames) {
            channelData[frame] = sin(Float(frame) * 0.01) * 0.2
        }

        let audioFile = try AVAudioFile(forWriting: url, settings: resolvedFormat.settings)
        try audioFile.write(from: buffer)
    }
}
#endif
