import CryptoKit
import Foundation

public enum EncryptedAudioLoaderError: Error, Equatable, Sendable {
    case fileNotFound(String)
    case invalidEnvelope(String)
    case capabilityMismatch(String)
    case capabilityExpired
    case decryptionFailed(String)
    case unsupportedAudioFormat(String)
}

public struct EncryptedArtifactHeader: Codable, Equatable, Sendable {
    public let artifactKind: String
    public let generation: String
    public let keyId: String
    public let meetingId: String
    public let plaintextLength: Int
    public let sequence: Int
    public let source: String

    public init(
        artifactKind: String,
        generation: String,
        keyId: String,
        meetingId: String,
        plaintextLength: Int,
        sequence: Int,
        source: String
    ) {
        self.artifactKind = artifactKind
        self.generation = generation
        self.keyId = keyId
        self.meetingId = meetingId
        self.plaintextLength = plaintextLength
        self.sequence = sequence
        self.source = source
    }
}

public enum EncryptedAudioLoader {
    private static let magic = Data([0x50, 0x45, 0x4E, 0x43]) // "PENC"
    private static let envelopeVersion: UInt8 = 1
    private static let algorithmAes256Gcm: UInt8 = 1
    public static let maximumEnvelopeBytes = 512 * 1024 * 1024

    public static let validArtifactKinds: Set<String> = [
        "raw", "repair", "manifest", "mixed", "mic", "system", "chunk", "sidecar"
    ]
    public static let validSources: Set<String> = [
        "mic", "system", "mixed", "none"
    ]

    public static func load(
        filePath: String,
        capability: ScopedMeetingCapability,
        expectedOperation: String
    ) throws -> (samples: [Float], sampleRate: Double) {
        guard capability.version == 1 else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Unsupported capability version: \(capability.version)")
        }

        guard !capability.generation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Capability generation must not be empty")
        }

        guard !capability.allowedOperations.isEmpty else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Capability allowedOperations must not be empty")
        }

        guard capability.allowedOperations.contains(expectedOperation) else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Operation '\(expectedOperation)' not permitted by capability")
        }

        guard capability.expiresAtMs > 0 else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Capability expiresAtMs must be positive")
        }

        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        if nowMs > capability.expiresAtMs {
            throw EncryptedAudioLoaderError.capabilityExpired
        }

        guard let keyData = Data(base64Encoded: capability.meetingKeyBase64), keyData.count == 32 else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Invalid 32-byte meeting key base64")
        }

        guard FileManager.default.fileExists(atPath: filePath) else {
            throw EncryptedAudioLoaderError.fileNotFound(filePath)
        }

        let attributes = try FileManager.default.attributesOfItem(atPath: filePath)
        guard let fileSize = attributes[.size] as? NSNumber,
              fileSize.intValue > 0,
              fileSize.intValue <= maximumEnvelopeBytes else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Encrypted audio exceeds the allocation bound")
        }

        let fileData = try Data(contentsOf: URL(fileURLWithPath: filePath), options: .mappedIfSafe)
        let plaintext = try decrypt(fileData: fileData, keyData: keyData, capability: capability)
        let artifactKind = try authenticatedArtifactKind(fileData)
        let allowedKinds: Set<String>
        switch expectedOperation {
        case "transcribe":
            allowedKinds = ["mic", "system", "mixed", "repair"]
        case "speakerEvidence":
            allowedKinds = ["mic", "system", "mixed"]
        default:
            throw EncryptedAudioLoaderError.capabilityMismatch("Unsupported encrypted audio operation")
        }
        guard allowedKinds.contains(artifactKind) else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Artifact kind is not permitted for this operation")
        }
        return try parseAudio(plaintext: plaintext)
    }

    private static func authenticatedArtifactKind(_ fileData: Data) throws -> String {
        guard fileData.count >= 8 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("File too small to contain an envelope header")
        }
        let headerLength = (Int(fileData[6]) << 8) | Int(fileData[7])
        let headerEnd = 8 + headerLength
        guard headerEnd <= fileData.count else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Envelope header is truncated")
        }
        return try JSONDecoder().decode(
            EncryptedArtifactHeader.self,
            from: fileData.subdata(in: 8..<headerEnd)
        ).artifactKind
    }

    public static func decrypt(
        fileData: Data,
        keyData: Data,
        capability: ScopedMeetingCapability
    ) throws -> Data {
        guard fileData.count >= 8 + 12 + 16 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("File too small to be a valid PENC envelope")
        }

        guard fileData.prefix(4) == magic else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid magic bytes, expected PENC")
        }

        let version = fileData[4]
        guard version == envelopeVersion else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Unsupported envelope version: \(version)")
        }

        let algo = fileData[5]
        guard algo == algorithmAes256Gcm else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Unsupported envelope algorithm: \(algo)")
        }

        let headerLength = (Int(fileData[6]) << 8) | Int(fileData[7])
        let headerEnd = 8 + headerLength
        guard fileData.count >= headerEnd + 12 + 16 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("File truncated before header/nonce/tag boundary")
        }

        let headerBytes = fileData.subdata(in: 8..<headerEnd)
        let decoder = JSONDecoder()
        let header: EncryptedArtifactHeader
        do {
            header = try decoder.decode(EncryptedArtifactHeader.self, from: headerBytes)
        } catch {
            throw EncryptedAudioLoaderError.invalidEnvelope("Failed to decode header JSON: \(error.localizedDescription)")
        }

        guard validArtifactKinds.contains(header.artifactKind) else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid artifactKind in envelope header: \(header.artifactKind)")
        }
        guard !header.generation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid or empty generation in envelope header")
        }
        guard !header.keyId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid or empty keyId in envelope header")
        }
        guard !header.meetingId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid or empty meetingId in envelope header")
        }
        guard header.sequence >= 0 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid sequence in envelope header: must be non-negative integer")
        }
        guard validSources.contains(header.source) else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid source in envelope header: \(header.source)")
        }
        guard header.plaintextLength >= 0 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid plaintextLength in envelope header: must be non-negative integer")
        }
        guard header.plaintextLength <= maximumEnvelopeBytes else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Plaintext length exceeds the allocation bound")
        }

        let canonicalEncoder = JSONEncoder()
        canonicalEncoder.outputFormatting = .sortedKeys
        guard let canonicalHeaderBytes = try? canonicalEncoder.encode(header),
              canonicalHeaderBytes == headerBytes else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Header JSON is not in canonical byte-for-byte format")
        }

        guard header.keyId == capability.keyId else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Key ID mismatch: header has '\(header.keyId)', capability has '\(capability.keyId)'")
        }
        guard header.meetingId == capability.meetingId else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Meeting ID mismatch: header has '\(header.meetingId)', capability has '\(capability.meetingId)'")
        }
        guard header.generation == capability.generation else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Generation mismatch: header has '\(header.generation)', capability has '\(capability.generation)'")
        }

        let nonceBytes = fileData.subdata(in: headerEnd..<(headerEnd + 12))
        let tagBytes = fileData.subdata(in: (headerEnd + 12)..<(headerEnd + 28))
        let ciphertext = fileData.subdata(in: (headerEnd + 28)..<fileData.count)

        if ciphertext.count != header.plaintextLength {
            throw EncryptedAudioLoaderError.invalidEnvelope("Ciphertext length (\(ciphertext.count)) does not match header plaintextLength (\(header.plaintextLength))")
        }

        let aad = fileData.subdata(in: 0..<headerEnd)

        do {
            let symmetricKey = SymmetricKey(data: keyData)
            let nonce = try AES.GCM.Nonce(data: nonceBytes)
            let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tagBytes)
            let plaintext = try AES.GCM.open(sealedBox, using: symmetricKey, authenticating: aad)
            guard plaintext.count == header.plaintextLength else {
                throw EncryptedAudioLoaderError.invalidEnvelope("Decrypted plaintext length mismatch")
            }
            return plaintext
        } catch {
            throw EncryptedAudioLoaderError.decryptionFailed("Decryption authentication failed: \(error.localizedDescription)")
        }
    }

    public static func seal(
        plaintext: Data,
        keyData: Data,
        keyId: String,
        meetingId: String,
        generation: String = "gen-1",
        artifactKind: String = "raw",
        source: String = "mic",
        sequence: Int = 0,
        nonceOverride: Data? = nil
    ) throws -> Data {
        guard keyData.count == 32 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid key length: expected 32 bytes, got \(keyData.count)")
        }
        guard validArtifactKinds.contains(artifactKind) else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid artifactKind: \(artifactKind)")
        }
        guard validSources.contains(source) else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid source: \(source)")
        }
        guard sequence >= 0 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Sequence must be non-negative")
        }
        guard !generation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Generation must not be empty")
        }
        guard !keyId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Key ID must not be empty")
        }
        guard !meetingId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Meeting ID must not be empty")
        }
        let header = EncryptedArtifactHeader(
            artifactKind: artifactKind,
            generation: generation,
            keyId: keyId,
            meetingId: meetingId,
            plaintextLength: plaintext.count,
            sequence: sequence,
            source: source
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let headerData = try encoder.encode(header)
        guard headerData.count <= 65535 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Header JSON exceeds 64KB envelope limit")
        }

        let headerLen = UInt16(headerData.count)
        var prefix = Data()
        prefix.append(magic)
        prefix.append(envelopeVersion)
        prefix.append(algorithmAes256Gcm)
        prefix.append(UInt8((headerLen >> 8) & 0xFF))
        prefix.append(UInt8(headerLen & 0xFF))

        var aad = Data()
        aad.append(prefix)
        aad.append(headerData)

        let symmetricKey = SymmetricKey(data: keyData)
        let nonce: AES.GCM.Nonce
        if let nonceOverride {
            guard nonceOverride.count == 12 else {
                throw EncryptedAudioLoaderError.invalidEnvelope("Nonce must be exactly 12 bytes")
            }
            nonce = try AES.GCM.Nonce(data: nonceOverride)
        } else {
            nonce = AES.GCM.Nonce()
        }

        let sealedBox = try AES.GCM.seal(plaintext, using: symmetricKey, nonce: nonce, authenticating: aad)

        var result = Data()
        result.append(aad)
        result.append(contentsOf: nonce)
        result.append(sealedBox.tag)
        result.append(sealedBox.ciphertext)
        return result
    }

    public static func parseAudio(plaintext: Data) throws -> (samples: [Float], sampleRate: Double) {
        if plaintext.count >= 12,
           plaintext.prefix(4) == Data("RIFF".utf8),
           plaintext.subdata(in: 8..<12) == Data("WAVE".utf8) {
            return try parseWav(data: plaintext)
        }

        // Raw 16-bit PCM fallback (assumes 16000Hz mono)
        let sampleCount = plaintext.count / 2
        var samples = [Float](repeating: 0, count: sampleCount)
        plaintext.withUnsafeBytes { rawBuffer in
            let int16Buffer = rawBuffer.bindMemory(to: Int16.self)
            for i in 0..<sampleCount {
                samples[i] = Float(int16Buffer[i]) / 32768.0
            }
        }
        return (samples: samples, sampleRate: 16000.0)
    }

    private static func parseWav(data: Data) throws -> (samples: [Float], sampleRate: Double) {
        guard data.count >= 44 else {
            throw EncryptedAudioLoaderError.unsupportedAudioFormat("WAV file too short")
        }

        var offset = 12
        var formatTag: Int = 0
        var channels: Int = 1
        var sampleRate: Double = 16000
        var bitsPerSample: Int = 16
        var dataChunkOffset = 0
        var dataChunkSize = 0

        while offset + 8 <= data.count {
            let chunkId = String(data: data.subdata(in: offset..<(offset + 4)), encoding: .ascii) ?? ""
            let chunkSize = Int(data.subdata(in: (offset + 4)..<(offset + 8)).withUnsafeBytes {
                $0.load(as: UInt32.self).littleEndian
            })

            if chunkId == "fmt " && chunkSize >= 16 {
                let fmtData = data.subdata(in: (offset + 8)..<(offset + 8 + chunkSize))
                formatTag = Int(fmtData.subdata(in: 0..<2).withUnsafeBytes { $0.load(as: UInt16.self).littleEndian })
                channels = Int(fmtData.subdata(in: 2..<4).withUnsafeBytes { $0.load(as: UInt16.self).littleEndian })
                sampleRate = Double(fmtData.subdata(in: 4..<8).withUnsafeBytes { $0.load(as: UInt32.self).littleEndian })
                bitsPerSample = Int(fmtData.subdata(in: 14..<16).withUnsafeBytes { $0.load(as: UInt16.self).littleEndian })
            } else if chunkId == "data" {
                dataChunkOffset = offset + 8
                dataChunkSize = min(chunkSize, data.count - dataChunkOffset)
                break
            }

            offset += 8 + chunkSize
        }

        guard dataChunkOffset > 0, dataChunkSize > 0 else {
            throw EncryptedAudioLoaderError.unsupportedAudioFormat("WAV missing data chunk")
        }

        let audioData = data.subdata(in: dataChunkOffset..<(dataChunkOffset + dataChunkSize))
        var monoSamples: [Float] = []

        if formatTag == 1 && bitsPerSample == 16 {
            let sampleCount = audioData.count / 2
            let channelCount = max(1, channels)
            let frameCount = sampleCount / channelCount
            monoSamples.reserveCapacity(frameCount)

            audioData.withUnsafeBytes { rawBuffer in
                let int16Buffer = rawBuffer.bindMemory(to: Int16.self)
                for f in 0..<frameCount {
                    var sum: Float = 0
                    for c in 0..<channelCount {
                        sum += Float(int16Buffer[f * channelCount + c]) / 32768.0
                    }
                    monoSamples.append(sum / Float(channelCount))
                }
            }
        } else if formatTag == 3 && bitsPerSample == 32 {
            let sampleCount = audioData.count / 4
            let channelCount = max(1, channels)
            let frameCount = sampleCount / channelCount
            monoSamples.reserveCapacity(frameCount)

            audioData.withUnsafeBytes { rawBuffer in
                let floatBuffer = rawBuffer.bindMemory(to: Float.self)
                for f in 0..<frameCount {
                    var sum: Float = 0
                    for c in 0..<channelCount {
                        sum += floatBuffer[f * channelCount + c]
                    }
                    monoSamples.append(sum / Float(channelCount))
                }
            }
        } else {
            throw EncryptedAudioLoaderError.unsupportedAudioFormat("Unsupported WAV formatTag=\(formatTag) bits=\(bitsPerSample)")
        }

        return (samples: monoSamples, sampleRate: sampleRate)
    }
}
