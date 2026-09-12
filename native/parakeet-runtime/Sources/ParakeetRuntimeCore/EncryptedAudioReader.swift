import CryptoKit
import Foundation

public protocol EncryptedAudioReading: Sendable {
    var sampleCount: Int { get }
    var sampleRate: Double { get }
    func copySamples(
        into destination: UnsafeMutablePointer<Float>,
        offset: Int,
        count: Int
    ) throws
}

private struct EncryptedAudioIndexSegment: Decodable, Sendable {
    let relativePath: String
    let sequence: Int
    let startFrame: Int
    let frameCount: Int
    let plaintextSha256: String
}

private struct EncryptedAudioIndex: Decodable, Sendable {
    let schemaVersion: Int
    let sampleRate: Int
    let totalFrames: Int
    let segments: [EncryptedAudioIndexSegment]
}

private struct LegacyEncryptedAudioReader: EncryptedAudioReading {
    let samples: [Float]
    let sampleRate: Double

    var sampleCount: Int { samples.count }

    func copySamples(
        into destination: UnsafeMutablePointer<Float>,
        offset: Int,
        count: Int
    ) throws {
        if Task.isCancelled { throw CancellationError() }
        guard offset >= 0, count >= 0, offset + count <= samples.count else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Audio sample request is out of bounds")
        }
        guard count > 0 else { return }
        samples.withUnsafeBufferPointer { source in
            destination.update(from: source.baseAddress!.advanced(by: offset), count: count)
        }
    }
}

private final class SegmentedEncryptedAudioReader: EncryptedAudioReading, @unchecked Sendable {
    let sampleCount: Int
    let sampleRate: Double

    private let parentURL: URL
    private let segments: [EncryptedAudioIndexSegment]
    private let capability: ScopedMeetingCapability
    private let expectedOperation: String
    private let keyData: Data
    private let source: String
    private let lock = NSLock()
    private var cachedSequence: Int?
    private var cachedSamples: [Float] = []

    init(
        index: EncryptedAudioIndex,
        indexURL: URL,
        capability: ScopedMeetingCapability,
        expectedOperation: String,
        keyData: Data,
        source: String
    ) throws {
        guard index.schemaVersion == 1, index.sampleRate == 16_000,
              index.totalFrames > 0 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Encrypted audio index metadata is invalid")
        }
        var expectedStart = 0
        for (expectedSequence, segment) in index.segments.enumerated() {
            guard segment.sequence == expectedSequence,
                  segment.startFrame == expectedStart,
                  segment.frameCount > 0,
                  segment.frameCount <= 16_000 * 60,
                  segment.relativePath == URL(fileURLWithPath: segment.relativePath).lastPathComponent,
                  segment.relativePath.range(of: "^[a-f0-9-]+\\.enc$", options: .regularExpression) != nil,
                  segment.plaintextSha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
                throw EncryptedAudioLoaderError.invalidEnvelope("Encrypted audio index segment is invalid")
            }
            expectedStart += segment.frameCount
        }
        guard expectedStart == index.totalFrames else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Encrypted audio index duration is invalid")
        }
        self.sampleCount = index.totalFrames
        self.sampleRate = Double(index.sampleRate)
        self.parentURL = indexURL.deletingLastPathComponent().standardizedFileURL
        self.segments = index.segments
        self.capability = capability
        self.expectedOperation = expectedOperation
        self.keyData = keyData
        self.source = source
    }

    func copySamples(
        into destination: UnsafeMutablePointer<Float>,
        offset: Int,
        count: Int
    ) throws {
        if Task.isCancelled { throw CancellationError() }
        guard offset >= 0, count >= 0, offset + count <= sampleCount else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Audio sample request is out of bounds")
        }
        guard count > 0 else { return }
        lock.lock()
        defer { lock.unlock() }
        let requestEnd = offset + count
        for segment in segments {
            if Task.isCancelled { throw CancellationError() }
            let segmentEnd = segment.startFrame + segment.frameCount
            let overlapStart = max(offset, segment.startFrame)
            let overlapEnd = min(requestEnd, segmentEnd)
            guard overlapEnd > overlapStart else { continue }
            let samples = try loadSegment(segment)
            let sourceOffset = overlapStart - segment.startFrame
            let destinationOffset = overlapStart - offset
            samples.withUnsafeBufferPointer { sourceBuffer in
                destination.advanced(by: destinationOffset).update(
                    from: sourceBuffer.baseAddress!.advanced(by: sourceOffset),
                    count: overlapEnd - overlapStart
                )
            }
        }
    }

    private func loadSegment(_ segment: EncryptedAudioIndexSegment) throws -> [Float] {
        if cachedSequence == segment.sequence { return cachedSamples }
        _ = try EncryptedAudioLoader.validateCapability(
            capability,
            expectedOperation: expectedOperation
        )
        let segmentURL = parentURL.appendingPathComponent(segment.relativePath).standardizedFileURL
        guard segmentURL.deletingLastPathComponent() == parentURL else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Encrypted audio segment escaped its bundle root")
        }
        let resourceValues = try segmentURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard resourceValues.isRegularFile == true, resourceValues.isSymbolicLink != true else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Encrypted audio segment is not a regular managed file")
        }
        let fileData = try EncryptedAudioLoader.readBoundedData(
            filePath: segmentURL.path,
            maximumBytes: 44 + 16_000 * 60 * 2 + 1_024
        )
        let plaintext = try EncryptedAudioLoader.decrypt(
            fileData: fileData,
            keyData: keyData,
            capability: capability
        )
        let header = try EncryptedAudioLoader.authenticatedHeader(fileData)
        guard header.artifactKind == "audio_segment", header.source == source,
              header.sequence == segment.sequence else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Encrypted audio segment metadata mismatch")
        }
        let digest = SHA256.hash(data: plaintext).map { String(format: "%02x", $0) }.joined()
        guard digest == segment.plaintextSha256 else {
            throw EncryptedAudioLoaderError.decryptionFailed("Encrypted audio segment checksum mismatch")
        }
        let decoded = try EncryptedAudioLoader.parseAudio(plaintext: plaintext)
        guard decoded.sampleRate == sampleRate, decoded.samples.count == segment.frameCount else {
            throw EncryptedAudioLoaderError.unsupportedAudioFormat("Encrypted audio segment frame contract mismatch")
        }
        cachedSequence = segment.sequence
        cachedSamples = decoded.samples
        return decoded.samples
    }
}

extension EncryptedAudioLoader {
    public static func makeReader(
        filePath: String,
        capability: ScopedMeetingCapability,
        expectedOperation: String,
        expectedSource: String? = nil
    ) throws -> any EncryptedAudioReading {
        let keyData = try validateCapability(capability, expectedOperation: expectedOperation)
        let fileData = try readBoundedData(filePath: filePath, maximumBytes: maximumEnvelopeBytes)
        let plaintext = try decrypt(fileData: fileData, keyData: keyData, capability: capability)
        let header = try authenticatedHeader(fileData)
        if let expectedSource, header.source != expectedSource {
            throw EncryptedAudioLoaderError.capabilityMismatch("Encrypted audio source mismatch")
        }
        guard ["mic", "system", "mixed"].contains(header.source) else {
            throw EncryptedAudioLoaderError.capabilityMismatch("Encrypted audio source is invalid")
        }
        if header.artifactKind != "audio_index" {
            let decoded = try load(
                filePath: filePath,
                capability: capability,
                expectedOperation: expectedOperation,
                expectedSource: expectedSource
            )
            return LegacyEncryptedAudioReader(samples: decoded.samples, sampleRate: decoded.sampleRate)
        }
        guard plaintext.count <= 1024 * 1024 else {
            throw EncryptedAudioLoaderError.invalidEnvelope("Encrypted audio index exceeds its allocation bound")
        }
        let index: EncryptedAudioIndex
        do {
            index = try JSONDecoder().decode(EncryptedAudioIndex.self, from: plaintext)
        } catch {
            throw EncryptedAudioLoaderError.invalidEnvelope("Encrypted audio index JSON is invalid")
        }
        return try SegmentedEncryptedAudioReader(
            index: index,
            indexURL: URL(fileURLWithPath: filePath),
            capability: capability,
            expectedOperation: expectedOperation,
            keyData: keyData,
            source: header.source
        )
    }
}
