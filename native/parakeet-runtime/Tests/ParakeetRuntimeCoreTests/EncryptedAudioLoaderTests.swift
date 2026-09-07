import CryptoKit
import Foundation
import XCTest
@testable import ParakeetRuntimeCore

final class EncryptedAudioLoaderTests: XCTestCase {
    private var tempDirectory: URL!

    override func setUp() {
        super.setUp()
        tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
    }

    override func tearDown() {
        if let tempDirectory {
            try? FileManager.default.removeItem(at: tempDirectory)
        }
        super.tearDown()
    }

    private func makePcmWav(sampleRate: Int = 16000, channels: Int = 1, sampleCount: Int = 1600) -> Data {
        var data = Data()
        // RIFF header
        data.append(contentsOf: "RIFF".utf8)
        let subchunk2Size = sampleCount * channels * 2
        let chunkSize = Int32(36 + subchunk2Size)
        data.append(contentsOf: withUnsafeBytes(of: chunkSize.littleEndian) { Data($0) })
        data.append(contentsOf: "WAVE".utf8)
        // fmt chunk
        data.append(contentsOf: "fmt ".utf8)
        let subchunk1Size: Int32 = 16
        data.append(contentsOf: withUnsafeBytes(of: subchunk1Size.littleEndian) { Data($0) })
        let audioFormat: Int16 = 1 // PCM
        data.append(contentsOf: withUnsafeBytes(of: audioFormat.littleEndian) { Data($0) })
        let numChannels = Int16(channels)
        data.append(contentsOf: withUnsafeBytes(of: numChannels.littleEndian) { Data($0) })
        let sRate = Int32(sampleRate)
        data.append(contentsOf: withUnsafeBytes(of: sRate.littleEndian) { Data($0) })
        let byteRate = Int32(sampleRate * channels * 2)
        data.append(contentsOf: withUnsafeBytes(of: byteRate.littleEndian) { Data($0) })
        let blockAlign = Int16(channels * 2)
        data.append(contentsOf: withUnsafeBytes(of: blockAlign.littleEndian) { Data($0) })
        let bitsPerSample: Int16 = 16
        data.append(contentsOf: withUnsafeBytes(of: bitsPerSample.littleEndian) { Data($0) })
        // data chunk
        data.append(contentsOf: "data".utf8)
        let s2Size = Int32(subchunk2Size)
        data.append(contentsOf: withUnsafeBytes(of: s2Size.littleEndian) { Data($0) })

        for i in 0..<sampleCount {
            for c in 0..<channels {
                let val = Int16(sin(Double(i) * 0.1 + Double(c)) * 10000.0)
                data.append(contentsOf: withUnsafeBytes(of: val.littleEndian) { Data($0) })
            }
        }
        return data
    }

    func testSealsAndLoadsPencAudioSuccessfully() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let keyBase64 = keyData.base64EncodedString()
        let wavData = makePcmWav(sampleRate: 16000, channels: 1, sampleCount: 1600)

        let sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-123",
            meetingId: "meeting-abc",
            generation: "gen-1",
            artifactKind: "raw",
            source: "mic",
            sequence: 0
        )

        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyBase64,
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )

        let loaded = try EncryptedAudioLoader.load(
            filePath: filePath,
            capability: capability,
            expectedOperation: "transcribe"
        )

        XCTAssertEqual(loaded.sampleRate, 16000)
        XCTAssertEqual(loaded.samples.count, 1600)
        XCTAssertGreaterThan(loaded.samples[10], 0)
    }

    func testRejectsWrongKeyId() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let wavData = makePcmWav()

        let sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-actual",
            meetingId: "meeting-abc"
        )
        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-mismatch",
            meetingKeyBase64: keyData.base64EncodedString()
        )

        XCTAssertThrowsError(try EncryptedAudioLoader.load(filePath: filePath, capability: capability, expectedOperation: "transcribe")) { error in
            guard case EncryptedAudioLoaderError.capabilityMismatch = error else {
                return XCTFail("Expected capabilityMismatch, got: \(error)")
            }
        }
    }

    func testRejectsWrongMeetingId() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let wavData = makePcmWav()

        let sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-123",
            meetingId: "meeting-actual"
        )
        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-wrong",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString()
        )

        XCTAssertThrowsError(try EncryptedAudioLoader.load(filePath: filePath, capability: capability, expectedOperation: "transcribe")) { error in
            guard case EncryptedAudioLoaderError.capabilityMismatch = error else {
                return XCTFail("Expected capabilityMismatch, got: \(error)")
            }
        }
    }

    func testRejectsDisallowedOperation() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let wavData = makePcmWav()

        let sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-123",
            meetingId: "meeting-abc"
        )
        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            allowedOperations: ["speakerEvidence"]
        )

        XCTAssertThrowsError(try EncryptedAudioLoader.load(filePath: filePath, capability: capability, expectedOperation: "transcribe")) { error in
            guard case EncryptedAudioLoaderError.capabilityMismatch = error else {
                return XCTFail("Expected capabilityMismatch, got: \(error)")
            }
        }
    }

    func testRejectsExpiredCapability() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let wavData = makePcmWav()

        let sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-123",
            meetingId: "meeting-abc"
        )
        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            expiresAtMs: Int64((Date().timeIntervalSince1970 - 10) * 1000)
        )

        XCTAssertThrowsError(try EncryptedAudioLoader.load(filePath: filePath, capability: capability, expectedOperation: "transcribe")) { error in
            guard case EncryptedAudioLoaderError.capabilityExpired = error else {
                return XCTFail("Expected capabilityExpired, got: \(error)")
            }
        }
    }

    func testRejectsCorruptedEnvelopeOrCiphertext() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let wavData = makePcmWav()

        var sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-123",
            meetingId: "meeting-abc"
        )
        // Corrupt magic bytes
        sealed[0] = 0x00

        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString()
        )

        XCTAssertThrowsError(try EncryptedAudioLoader.load(filePath: filePath, capability: capability, expectedOperation: "transcribe")) { error in
            guard case EncryptedAudioLoaderError.invalidEnvelope = error else {
                return XCTFail("Expected invalidEnvelope, got: \(error)")
            }
        }
    }

    func testDecodesCapabilityFromRequestJson() throws {
        let json = """
        {
          "schemaVersion": 1,
          "id": "req-1",
          "method": "transcribe",
          "audioPath": "/tmp/test.enc",
          "capability": {
            "version": 1,
            "meetingId": "m-123",
            "keyId": "k-456",
            "meetingKeyBase64": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "allowedOperations": ["transcribe"],
            "expiresAtMs": 1757268000000
          }
        }
        """
        let data = Data(json.utf8)
        let request = try JSONDecoder().decode(RuntimeRequest.self, from: data)
        XCTAssertNotNil(request.capability)
        XCTAssertEqual(request.capability?.meetingId, "m-123")
        XCTAssertEqual(request.capability?.keyId, "k-456")
        XCTAssertEqual(request.capability?.allowedOperations, ["transcribe"])
        XCTAssertEqual(request.capability?.expiresAtMs, 1757268000000)
    }
}
