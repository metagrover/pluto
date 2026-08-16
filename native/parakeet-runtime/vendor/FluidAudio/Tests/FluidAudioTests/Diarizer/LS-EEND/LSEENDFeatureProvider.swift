import Accelerate
import CoreML
import Foundation
import XCTest

@testable import FluidAudio

final class LSEENDFeatureProviderTests: XCTestCase {

    func testFeatureProviderRequiresExactMinimumAudioForFirstChunk() throws {
        let metadata = makeMetadata()
        let provider = try LSEENDFeatureProvider(from: metadata)
        let minimumSamples = minimumSamplesForFirstChunk(metadata: metadata)

        try provider.enqueueAudio(makeAudio(count: minimumSamples - 1), withSampleRate: nil)
        XCTAssertEqual(provider.readyChunks, 0)
        XCTAssertNil(try provider.emitNextChunk())

        try provider.enqueueAudio(makeAudio(count: 1), withSampleRate: nil)

        let firstChunk = try provider.emitNextChunk()
        XCTAssertNotNil(firstChunk)
        XCTAssertEqual(firstChunk?.melFeatures.count, metadata.melFrames * metadata.nMels)
        XCTAssertEqual(firstChunk?.warmupFrames, metadata.convDelay)
    }

    func testChunkedMelMatchesNonChunkedPipelineExactly() throws {
        let metadata = makeMetadata()
        let provider = try LSEENDFeatureProvider(from: metadata)
        let audio = makeAudio(count: minimumSamplesForFirstChunk(metadata: metadata) * 3 + 37)

        try provider.enqueueAudio(audio, withSampleRate: nil)
        try provider.drainRightContextWithSilence()

        var emittedChunks: [[Float]] = []
        while let input = try provider.emitNextChunk() {
            emittedChunks.append(allValues(in: input.melFeatures))
        }

        let expectedChunks = try buildExpectedChunks(audio: audio, metadata: metadata)

        XCTAssertEqual(emittedChunks.count, expectedChunks.count)
        XCTAssertFalse(emittedChunks.isEmpty)

        for (actual, expected) in zip(emittedChunks, expectedChunks) {
            XCTAssertEqual(actual.count, expected.count)
            for (index, pair) in zip(actual.indices, zip(actual, expected)) {
                XCTAssertEqual(
                    pair.0,
                    pair.1,
                    accuracy: 1e-6,
                    "Mismatch at chunk sample \(index)"
                )
            }
        }
    }

    private func buildExpectedChunks(audio: [Float], metadata: LSEENDMetadata) throws -> [[Float]] {
        let audioBuffer = buildProviderAudioBuffer(audio: audio, metadata: metadata)
        let spectrogram = AudioMelSpectrogram(
            sampleRate: metadata.sampleRate,
            nMels: metadata.nMels,
            nFFT: metadata.nFFT,
            hopLength: metadata.hopLength,
            winLength: metadata.winLength,
            preemph: 0,
            padTo: 0,
            logFloor: 1e-10,
            logFloorMode: .clamped,
            windowPeriodic: true
        )

        var (melFeatures, _, _) = spectrogram.computeFlatTransposed(
            audio: audioBuffer,
            lastAudioSample: 0,
            paddingMode: .prePadded,
            expectedFrameCount: nil
        )

        let scale: Float = 1.0 / log(10.0)
        melFeatures = melFeatures.map { $0 * scale }
        applyCumulativeMeanNormalization(to: &melFeatures, nMels: metadata.nMels)

        var melQueue = StreamingChunkQueue(
            chunkLength: metadata.subsampling * metadata.chunkSize,
            leftContextLength: metadata.contextSize,
            rightContextLength: metadata.contextSize + 1 - metadata.subsampling,
            stride: metadata.nMels
        )
        melQueue.append(melFeatures)

        var chunks: [[Float]] = []
        while let chunk = melQueue.popNextChunk() {
            chunks.append(Array(chunk))
        }

        return chunks
    }

    private func buildProviderAudioBuffer(audio: [Float], metadata: LSEENDMetadata) -> [Float] {
        let contextSamples = metadata.nFFT / 2
        let chunkSamples = metadata.hopLength * metadata.subsampling * metadata.chunkSize
        let rightSamples = metadata.nFFT / 2 - metadata.hopLength
        let flushSampleCount =
            (metadata.contextSize + metadata.convDelay * metadata.subsampling) * metadata.hopLength
            + contextSamples

        var buffer = [Float](repeating: 0, count: contextSamples)
        buffer.append(contentsOf: audio)
        buffer.append(contentsOf: repeatElement(0, count: flushSampleCount))

        let contextFloats = contextSamples + rightSamples
        let unread = buffer.count
        let overContext = max(0, unread - contextFloats)
        let shortfall = (chunkSamples - overContext % chunkSamples) % chunkSamples
        if shortfall > 0 {
            buffer.append(contentsOf: repeatElement(0, count: shortfall))
        }

        return buffer
    }

    private func applyCumulativeMeanNormalization(to melFeatures: inout [Float], nMels: Int) {
        var cmnMean = [Float](repeating: 0, count: nMels)
        var cmnCount = 0

        melFeatures.withUnsafeMutableBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }

            for frame in stride(from: 0, to: buffer.count, by: nMels) {
                cmnCount += 1
                var alpha = 1.0 / Float(cmnCount)

                vDSP_vintb(cmnMean, 1, base + frame, 1, &alpha, &cmnMean, 1, vDSP_Length(nMels))
                vDSP_vsub(cmnMean, 1, base + frame, 1, base + frame, 1, vDSP_Length(nMels))
            }
        }
    }

    private func minimumSamplesForFirstChunk(metadata: LSEENDMetadata) -> Int {
        let chunkSamples = metadata.hopLength * metadata.subsampling * metadata.chunkSize
        let rightSamples = metadata.nFFT / 2 - metadata.hopLength
        return chunkSamples + rightSamples
    }

    private func makeAudio(count: Int) -> [Float] {
        (0..<count).map { index in
            let sample = Float(index)
            let fundamental = sin(sample * 0.013) * 0.25
            let harmonic = sin(sample * 0.031) * 0.1
            return fundamental + harmonic
        }
    }

    private func allValues(in array: MLMultiArray) -> [Float] {
        var values: [Float] = []
        array.withUnsafeBufferPointer(ofType: Float.self) { buffer in
            values = Array(buffer)
        }
        return values
    }

    private func makeMetadata() -> LSEENDMetadata {
        LSEENDMetadata(
            chunkSize: 4,
            frameDurationSeconds: 0.1,
            maxSpeakers: 4,
            sampleRate: 16_000,
            maxNspks: 5,
            hopLength: 4,
            winLength: 16,
            nMels: 6,
            contextSize: 7,
            subsampling: 8,
            convDelay: 1,
            nUnits: 32,
            nHeads: 4,
            encNLayers: 2,
            decNLayers: 2,
            convKernelSize: 3
        )
    }
}
