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
        data.append(contentsOf: "RIFF".utf8)
        let subchunk2Size = sampleCount * channels * 2
        let chunkSize = Int32(36 + subchunk2Size)
        data.append(contentsOf: withUnsafeBytes(of: chunkSize.littleEndian) { Data($0) })
        data.append(contentsOf: "WAVE".utf8)
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

    private static func dataFromHex(_ hex: String) -> Data {
        var data = Data()
        var temp = ""
        for char in hex {
            temp.append(char)
            if temp.count == 2 {
                if let byte = UInt8(temp, radix: 16) {
                    data.append(byte)
                }
                temp = ""
            }
        }
        return data
    }

    private static func sha256Hex(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func findCrossLanguageVectorsURL() -> URL? {
        var dir = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 {
            dir = dir.deletingLastPathComponent()
            let candidate = dir.appendingPathComponent("tests/fixtures/crypto/crossLanguageVectors.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
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
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )

        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: capability,
                expectedOperation: "transcribe"
            )
        ) { error in
            guard case EncryptedAudioLoaderError.capabilityMismatch = error else {
                XCTFail("Expected capabilityMismatch, got \(error)")
                return
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
            meetingId: "meeting-mismatch",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )

        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: capability,
                expectedOperation: "transcribe"
            )
        ) { error in
            guard case EncryptedAudioLoaderError.capabilityMismatch = error else {
                XCTFail("Expected capabilityMismatch, got \(error)")
                return
            }
        }
    }

    func testRejectsWrongGeneration() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let wavData = makePcmWav()

        let sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-123",
            meetingId: "meeting-abc",
            generation: "gen-1"
        )
        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-2",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )

        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: capability,
                expectedOperation: "transcribe"
            )
        ) { error in
            guard case EncryptedAudioLoaderError.capabilityMismatch = error else {
                XCTFail("Expected capabilityMismatch, got \(error)")
                return
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
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 - 10) * 1000)
        )

        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: capability,
                expectedOperation: "transcribe"
            )
        ) { error in
            guard case EncryptedAudioLoaderError.capabilityExpired = error else {
                XCTFail("Expected capabilityExpired, got \(error)")
                return
            }
        }
    }

    func testRejectsUnauthorizedOperation() throws {
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
            generation: "gen-1",
            allowedOperations: ["speakerEvidence"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )

        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: capability,
                expectedOperation: "transcribe"
            )
        ) { error in
            guard case EncryptedAudioLoaderError.capabilityMismatch = error else {
                XCTFail("Expected capabilityMismatch, got \(error)")
                return
            }
        }
    }

    func testRejectsEmptyCapabilityFields() throws {
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

        // Empty generation
        let emptyGenCapability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "   ",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )
        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: emptyGenCapability,
                expectedOperation: "transcribe"
            )
        )

        // Empty allowedOperations
        let emptyOpsCapability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-1",
            allowedOperations: [],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )
        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: emptyOpsCapability,
                expectedOperation: "transcribe"
            )
        )

        // Non-positive expiresAtMs
        let invalidExpCapability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: 0
        )
        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: invalidExpCapability,
                expectedOperation: "transcribe"
            )
        )
    }

    func testFailsAuthenticationOnTamperedCiphertext() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        let wavData = makePcmWav()

        var sealed = try EncryptedAudioLoader.seal(
            plaintext: wavData,
            keyData: keyData,
            keyId: "key-123",
            meetingId: "meeting-abc"
        )

        sealed[sealed.count - 1] ^= 0xFF
        let filePath = tempDirectory.appendingPathComponent("chunk.enc").path
        try sealed.write(to: URL(fileURLWithPath: filePath))

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )

        XCTAssertThrowsError(
            try EncryptedAudioLoader.load(
                filePath: filePath,
                capability: capability,
                expectedOperation: "transcribe"
            )
        ) { error in
            guard case EncryptedAudioLoaderError.decryptionFailed = error else {
                XCTFail("Expected decryptionFailed, got \(error)")
                return
            }
        }
    }

    func testRejectsNonCanonicalHeaderJSONInSwift() throws {
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }

        // Construct envelope with unsorted JSON keys:
        let unsortedJson = """
        {"source":"mic","sequence":0,"plaintextLength":4,"meetingId":"meeting-abc","keyId":"key-123","generation":"gen-1","artifactKind":"raw"}
        """
        let headerData = Data(unsortedJson.utf8)
        let headerLen = UInt16(headerData.count)

        var aad = Data([0x50, 0x45, 0x4E, 0x43, 0x01, 0x01])
        aad.append(UInt8((headerLen >> 8) & 0xFF))
        aad.append(UInt8(headerLen & 0xFF))
        aad.append(headerData)

        let nonce = AES.GCM.Nonce()
        let sealedBox = try AES.GCM.seal(Data("test".utf8), using: key, nonce: nonce, authenticating: aad)

        var envelope = Data()
        envelope.append(aad)
        envelope.append(contentsOf: nonce)
        envelope.append(sealedBox.tag)
        envelope.append(sealedBox.ciphertext)

        let capability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-abc",
            keyId: "key-123",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 60) * 1000)
        )

        XCTAssertThrowsError(
            try EncryptedAudioLoader.decrypt(fileData: envelope, keyData: keyData, capability: capability)
        ) { error in
            guard case EncryptedAudioLoaderError.invalidEnvelope = error else {
                XCTFail("Expected invalidEnvelope error, got \(error)")
                return
            }
        }
    }

    func testCrossLanguageTestVectors() throws {
        guard let fixtureURL = findCrossLanguageVectorsURL() else {
            XCTFail("crossLanguageVectors.json fixture file not found")
            return
        }

        let fixtureData = try Data(contentsOf: fixtureURL)
        guard let json = try JSONSerialization.jsonObject(with: fixtureData) as? [String: Any],
              let keyHex = json["keyHex"] as? String,
              let wrongKeyHex = json["wrongKeyHex"] as? String,
              let nonceHex = json["nonceHex"] as? String,
              let validVectors = json["validVectors"] as? [[String: Any]],
              let tamperedVectors = json["tamperedVectors"] as? [[String: Any]] else {
            XCTFail("Malformed crossLanguageVectors.json")
            return
        }

        let keyData = Self.dataFromHex(keyHex)
        let wrongKeyData = Self.dataFromHex(wrongKeyHex)
        let nonceData = Self.dataFromHex(nonceHex)

        // 1. Verify valid vectors decrypt and match bit-for-bit
        for vec in validVectors {
            guard let name = vec["name"] as? String,
                  let sealedHex = vec["sealedHex"] as? String,
                  let expectedSha256 = vec["plaintextSha256"] as? String,
                  let headerDict = vec["header"] as? [String: Any],
                  let keyId = headerDict["keyId"] as? String,
                  let meetingId = headerDict["meetingId"] as? String,
                  let generation = headerDict["generation"] as? String else {
                XCTFail("Missing fields in valid vector")
                continue
            }

            let sealedData = Self.dataFromHex(sealedHex)
            let capability = ScopedMeetingCapability(
                version: 1,
                meetingId: meetingId,
                keyId: keyId,
                meetingKeyBase64: keyData.base64EncodedString(),
                generation: generation,
                allowedOperations: ["transcribe", "speakerEvidence"],
                expiresAtMs: Int64((Date().timeIntervalSince1970 + 3600) * 1000)
            )

            let decrypted = try EncryptedAudioLoader.decrypt(
                fileData: sealedData,
                keyData: keyData,
                capability: capability
            )

            let decryptedSha = Self.sha256Hex(decrypted)
            XCTAssertEqual(decryptedSha, expectedSha256, "Vector \(name) SHA-256 mismatch")

            // If WAV audio, verify parseAudio extracts samples
            if name == "wav_audio" {
                let parsed = try EncryptedAudioLoader.parseAudio(plaintext: decrypted)
                XCTAssertEqual(parsed.sampleRate, 16000.0)
                XCTAssertEqual(parsed.samples.count, 320)
            }

            // 2. Verify deterministic re-sealing in Swift produces identical envelope bytes
            if let plaintextBase64 = vec["plaintextBase64"] as? String,
               let plaintextData = Data(base64Encoded: plaintextBase64),
               let artifactKind = headerDict["artifactKind"] as? String,
               let source = headerDict["source"] as? String,
               let sequence = headerDict["sequence"] as? Int {

                let swiftSealed = try EncryptedAudioLoader.seal(
                    plaintext: plaintextData,
                    keyData: keyData,
                    keyId: keyId,
                    meetingId: meetingId,
                    generation: generation,
                    artifactKind: artifactKind,
                    source: source,
                    sequence: sequence,
                    nonceOverride: nonceData
                )

                let swiftSealedHex = swiftSealed.map { String(format: "%02x", $0) }.joined()
                XCTAssertEqual(swiftSealedHex, sealedHex, "Vector \(name) Swift re-seal mismatch")
            }

            // 3. Verify wrong key fails closed
            let wrongCapability = ScopedMeetingCapability(
                version: 1,
                meetingId: meetingId,
                keyId: keyId,
                meetingKeyBase64: wrongKeyData.base64EncodedString(),
                generation: generation,
                allowedOperations: ["transcribe"],
                expiresAtMs: Int64((Date().timeIntervalSince1970 + 3600) * 1000)
            )
            XCTAssertThrowsError(
                try EncryptedAudioLoader.decrypt(
                    fileData: sealedData,
                    keyData: wrongKeyData,
                    capability: wrongCapability
                ),
                "Vector \(name) should fail with wrong key"
            )
        }

        // 4. Verify all tampered and truncated vectors fail closed
        let dummyCapability = ScopedMeetingCapability(
            version: 1,
            meetingId: "meeting-test-01",
            keyId: "key-test-01",
            meetingKeyBase64: keyData.base64EncodedString(),
            generation: "gen-1",
            allowedOperations: ["transcribe"],
            expiresAtMs: Int64((Date().timeIntervalSince1970 + 3600) * 1000)
        )

        for vec in tamperedVectors {
            guard let name = vec["name"] as? String,
                  let sealedHex = vec["sealedHex"] as? String else {
                continue
            }
            let sealedData = Self.dataFromHex(sealedHex)
            XCTAssertThrowsError(
                try EncryptedAudioLoader.decrypt(
                    fileData: sealedData,
                    keyData: keyData,
                    capability: dummyCapability
                ),
                "Tampered vector \(name) should fail closed"
            )
        }
    }
}
