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

public struct EncryptedHeader: Codable, Sendable {
    public let v: Int
    public let k: String
    public let m: String
    public let g: String
    public let a: String
    public let s: String
    public let seq: Int
}

public enum EncryptedAudioLoader {
    private static let magic = Data([0x50, 0x45, 0x4E, 0x43]) // "PENC"

    public static func load(
        filePath: String,
        capability: ScopedMeetingCapability,
        expectedOperation: String
    ) throws -> (samples: [Float], sampleRate: Double) {
        guard capability.version == 1 else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Unsupported capability version: \(capability.version)")
        }

        if let allowed = capability.allowedOperations, !allowed.contains(expectedOperation) {
            throw EncryptedAudioLoaderError.capabilityMismatch("Operation '\(expectedOperation)' not permitted by capability")
        }

        if let expiresAtMs = capability.expiresAtMs {
            let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
            if nowMs > expiresAtMs {
                throw EncryptedAudioLoaderError.capabilityExpired
            }
        }

        guard let keyData = Data(base64Encoded: capability.meetingKeyBase64), keyData.count == 32 else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Invalid 32-byte meeting key base64")
        }

        guard FileManager.default.fileExists(atPath: filePath) else {
            throw EncryptedAudioLoaderError.fileNotFound(filePath)
        }

        let fileData = try Data(contentsOf: URL(fileURLWithPath: filePath))
        let plaintext = try decrypt(fileData: fileData, keyData: keyData, capability: capability)
        return try parseAudio(plaintext: plaintext)
    }

    public static func decrypt(
        fileData: Data,
        keyData: Data,
        capability: ScopedMeetingCapability
    ) throws -> Data {
        guard fileData.count >= 7 + 12 + 16 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("File too small to be a valid PENC envelope")
        }

        guard fileData.prefix(4) == magic else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Invalid magic bytes, expected PENC")
        }

        let envelopeVersion = fileData[4]
        guard envelopeVersion == 1 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Unsupported envelope version: \(envelopeVersion)")
        }

        let headerLength = (Int(fileData[5]) << 8) | Int(fileData[6])
        let headerEnd = 7 + headerLength
        guard fileData.count >= headerEnd + 12 + 16 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("File truncated before header/nonce")
        }

        let headerBytes = fileData.subdata(in: 7..<headerEnd)
        guard let headerString = String(data: headerBytes, encoding: .utf8) else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Malformed UTF-8 header JSON")
        }

        let decoder = JSONDecoder()
        let header: EncryptedHeader
        do {
            header = try decoder.decode(EncryptedHeader.self, from: headerBytes)
        } catch {
            throw EncryptedAudioLoaderError.invalidEnvelope("Failed to decode header JSON: \(error.localizedDescription)")
        }

        guard header.k == capability.keyId else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Key ID mismatch: header has '\(header.k)', capability has '\(capability.keyId)'")
        }
        guard header.m == capability.meetingId else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Meeting ID mismatch: header has '\(header.m)', capability has '\(capability.meetingId)'")
        }
        if let expectedGen = capability.generation, header.g != expectedGen {
            throw EncryptedAudioLoaderError.capabilityMismatch("Generation mismatch: header has '\(header.g)', capability has '\(expectedGen)'")
        }

        let nonceBytes = fileData.subdata(in: headerEnd..<(headerEnd + 12))
        let tagStart = fileData.count - 16
        let ciphertext = fileData.subdata(in: (headerEnd + 12)..<tagStart)
        let tagBytes = fileData.subdata(in: tagStart..<fileData.count)

        let aadString = "\(headerString):\(capability.keyId)"
        let aad = Data(aadString.utf8)

        do {
            let symmetricKey = SymmetricKey(data: keyData)
            let nonce = try AES.GCM.Nonce(data: nonceBytes)
            let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tagBytes)
            return try AES.GCM.open(sealedBox, using: symmetricKey, authenticating: aad)
        } catch {
            throw EncryptedAudioLoaderError.decryptionFailed("Decryption authentication failed: \(error.localizedDescription)")
        }
    }

    public static func parseAudio(plaintext: Data) throws -> (samples: [Float], sampleRate: Double) {
        if plaintext.count >= 12,
           plaintext.prefix(4) == Data("RIFF".utf8),
           plaintext.subdata(in: 8..<12) == Data("WAVE".utf8) {
            return try parseWav(data: plaintext)
        }

        let int16Count = plaintext.count / 2
        var samples = [Float](repeating: 0, count: int16Count)
        plaintext.withUnsafeBytes { rawPtr in
            guard let ptr = rawPtr.bindMemory(to: Int16.self).baseAddress else { return }
            for i in 0..<int16Count {
                samples[i] = Float(ptr[i]) / 32768.0
            }
        }
        return (samples: samples, sampleRate: 16000.0)
    }

    private static func parseWav(data: Data) throws -> (samples: [Float], sampleRate: Double) {
        var offset = 12
        var channels: Int = 1
        var sampleRate: Double = 16000.0
        var bitsPerSample: Int = 16
        var formatTag: Int = 1
        var pcmData: Data?

        while offset + 8 <= data.count {
            let chunkIdData = data.subdata(in: offset..<(offset + 4))
            guard let chunkId = String(data: chunkIdData, encoding: .ascii) else { break }
            let chunkSize = Int(data[offset + 4]) |
                            (Int(data[offset + 5]) << 8) |
                            (Int(data[offset + 6]) << 16) |
                            (Int(data[offset + 7]) << 24)
            let chunkDataStart = offset + 8
            let chunkDataEnd = min(chunkDataStart + chunkSize, data.count)

            if chunkId == "fmt " && chunkSize >= 16 {
                formatTag = Int(data[chunkDataStart]) | (Int(data[chunkDataStart + 1]) << 8)
                channels = Int(data[chunkDataStart + 2]) | (Int(data[chunkDataStart + 3]) << 8)
                let rate = Int(data[chunkDataStart + 4]) |
                           (Int(data[chunkDataStart + 5]) << 8) |
                           (Int(data[chunkDataStart + 6]) << 16) |
                           (Int(data[chunkDataStart + 7]) << 24)
                sampleRate = Double(rate)
                bitsPerSample = Int(data[chunkDataStart + 14]) | (Int(data[chunkDataStart + 15]) << 8)
            } else if chunkId == "data" {
                pcmData = data.subdata(in: chunkDataStart..<chunkDataEnd)
                break
            }

            offset = chunkDataStart + chunkSize
            if chunkSize % 2 != 0 {
                offset += 1
            }
        }

        guard let rawPcm = pcmData else {
            throw EncryptedAudioLoaderError.unsupportedAudioFormat("No 'data' chunk found in WAV")
        }

        guard channels >= 1 else {
            throw EncryptedAudioLoaderError.unsupportedAudioFormat("Invalid channel count: \(channels)")
        }

        var monoSamples: [Float] = []

        if formatTag == 1 && bitsPerSample == 16 {
            let totalSamples = rawPcm.count / 2
            let frameCount = totalSamples / channels
            monoSamples.reserveCapacity(frameCount)

            rawPcm.withUnsafeBytes { rawPtr in
                guard let ptr = rawPtr.bindMemory(to: Int16.self).baseAddress else { return }
                if channels == 1 {
                    for i in 0..<frameCount {
                        monoSamples.append(Float(ptr[i]) / 32768.0)
                    }
                } else {
                    for i in 0..<frameCount {
                        var sum: Float = 0
                        for c in 0..<channels {
                            sum += Float(ptr[i * channels + c]) / 32768.0
                        }
                        monoSamples.append(sum / Float(channels))
                    }
                }
            }
        } else if (formatTag == 3 || formatTag == 1) && bitsPerSample == 32 {
            let totalSamples = rawPcm.count / 4
            let frameCount = totalSamples / channels
            monoSamples.reserveCapacity(frameCount)

            rawPcm.withUnsafeBytes { rawPtr in
                guard let ptr = rawPtr.bindMemory(to: Float.self).baseAddress else { return }
                if channels == 1 {
                    for i in 0..<frameCount {
                        monoSamples.append(ptr[i])
                    }
                } else {
                    for i in 0..<frameCount {
                        var sum: Float = 0
                        for c in 0..<channels {
                            sum += ptr[i * channels + c]
                        }
                        monoSamples.append(sum / Float(channels))
                    }
                }
            }
        } else {
            throw EncryptedAudioLoaderError.unsupportedAudioFormat("Unsupported WAV formatTag=\(formatTag) bits=\(bitsPerSample)")
        }

        return (samples: monoSamples, sampleRate: sampleRate)
    }

    public static func seal(
        plaintext: Data,
        keyData: Data,
        keyId: String,
        meetingId: String,
        generation: String = "gen-1",
        artifactKind: String = "raw",
        source: String = "mic",
        sequence: Int = 0
    ) throws -> Data {
        let header = EncryptedHeader(
            v: 1,
            k: keyId,
            m: meetingId,
            g: generation,
            a: artifactKind,
            s: source,
            seq: sequence
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let headerData = try encoder.encode(header)
        let headerString = String(data: headerData, encoding: .utf8)!

        let symmetricKey = SymmetricKey(data: keyData)
        let nonce = AES.GCM.Nonce()
        let aad = Data("\(headerString):\(keyId)".utf8)

        let sealedBox = try AES.GCM.seal(plaintext, using: symmetricKey, nonce: nonce, authenticating: aad)

        var result = Data()
        result.append(magic)
        result.append(1) // version
        let headerLen = UInt16(headerData.count)
        result.append(UInt8((headerLen >> 8) & 0xFF))
        result.append(UInt8(headerLen & 0xFF))
        result.append(headerData)
        result.append(contentsOf: nonce)
        result.append(sealedBox.ciphertext)
        result.append(sealedBox.tag)
        return result
    }
}
