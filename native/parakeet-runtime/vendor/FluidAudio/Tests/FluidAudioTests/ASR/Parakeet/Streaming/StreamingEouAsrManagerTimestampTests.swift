import XCTest

@testable import FluidAudio

final class StreamingEouAsrManagerTimestampTests: XCTestCase {

    func testTokenTimestampCalculationMs() {
        let baseFrame = 4
        let tokenFrames = [0, 1, 3]

        let timestamps = StreamingEouAsrManager.computeTokenTimestampsMs(
            baseFrame: baseFrame,
            tokenFrames: tokenFrames,
            frameDurationMs: 80
        )

        XCTAssertEqual(timestamps, [320, 400, 560])
    }

    func testTokenTimestampCalculationEmpty() {
        let timestamps = StreamingEouAsrManager.computeTokenTimestampsMs(
            baseFrame: 10,
            tokenFrames: [],
            frameDurationMs: 80
        )

        XCTAssertTrue(timestamps.isEmpty)
    }

    func testRepeatedUtterancesPreserveCumulativeTranscriptAndTimestamps() async throws {
        let manager = StreamingEouAsrManager(chunkSize: .ms320, eouDebounceMs: 640)
        let tokenizer = try makeTokenizer()
        let callbacks = EouTranscripts()
        await manager.setEouCallback { callbacks.append($0) }

        for tokenId in 1...3 {
            // Speech may appear with or without an EOU prediction in the same chunk.
            await manager.consumeDecodeResult(
                DecodeResult(tokenIds: [tokenId], tokenFrames: [1], eouDetected: tokenId == 3),
                tokenizer: tokenizer
            )
            for _ in 0..<3 {
                await consumeSilence(manager, tokenizer: tokenizer)
            }
        }

        XCTAssertEqual(callbacks.values, ["First", "First second", "First second third"])
        let tokenTimes = await manager.getTokenTimestampsMs()
        let rawTokens = await manager.getRawTokenStrings()
        let eouTimes = await manager.getEouTimestampsMs()
        XCTAssertEqual(tokenTimes, [80, 1360, 2640])
        XCTAssertEqual(rawTokens, ["▁First", "▁second", "▁third"])
        XCTAssertEqual(eouTimes, [1280, 2560, 3840])
    }

    func testBlankOnlyChunksDoNotRearmConfirmedUtterance() async throws {
        let manager = StreamingEouAsrManager(chunkSize: .ms320, eouDebounceMs: 640)
        let tokenizer = try makeTokenizer()
        let callbacks = EouTranscripts()
        await manager.setEouCallback { callbacks.append($0) }
        await manager.consumeDecodeResult(
            DecodeResult(tokenIds: [1], tokenFrames: [1], eouDetected: false),
            tokenizer: tokenizer
        )
        for _ in 0..<8 {
            await consumeSilence(manager, tokenizer: tokenizer)
        }
        // A missing EOU prediction is not evidence of new speech.
        await consumeSilence(manager, tokenizer: tokenizer, eouDetected: false)
        for _ in 0..<8 {
            await consumeSilence(manager, tokenizer: tokenizer)
        }

        XCTAssertEqual(callbacks.values, ["First"])
        let eouTimes = await manager.getEouTimestampsMs()
        XCTAssertEqual(eouTimes, [1280])
        let detected = await manager.eouDetected
        XCTAssertTrue(detected)
    }

    func testResumedSpeechRequiresFreshSustainedSilence() async throws {
        let manager = StreamingEouAsrManager(chunkSize: .ms320, eouDebounceMs: 640)
        let tokenizer = try makeTokenizer()
        let callbacks = EouTranscripts()
        await manager.setEouCallback { callbacks.append($0) }
        await manager.consumeDecodeResult(
            DecodeResult(tokenIds: [1], tokenFrames: [0], eouDetected: false),
            tokenizer: tokenizer
        )
        for _ in 0..<3 {
            await consumeSilence(manager, tokenizer: tokenizer)
        }
        await manager.consumeDecodeResult(
            DecodeResult(tokenIds: [2], tokenFrames: [0], eouDetected: true),
            tokenizer: tokenizer
        )
        let detectedAfterSpeech = await manager.eouDetected
        XCTAssertFalse(detectedAfterSpeech)
        for _ in 0..<2 {
            await consumeSilence(manager, tokenizer: tokenizer)
        }
        XCTAssertEqual(callbacks.values, ["First"])
        // New speech interrupts the pending silence window as well.
        await manager.consumeDecodeResult(
            DecodeResult(tokenIds: [3], tokenFrames: [0], eouDetected: false),
            tokenizer: tokenizer
        )
        for _ in 0..<2 {
            await consumeSilence(manager, tokenizer: tokenizer)
        }
        XCTAssertEqual(callbacks.values, ["First"])
        await consumeSilence(manager, tokenizer: tokenizer)
        XCTAssertEqual(callbacks.values, ["First", "First second third"])
        let eouTimes = await manager.getEouTimestampsMs()
        XCTAssertEqual(eouTimes, [1280, 3520])
    }

    private func consumeSilence(
        _ manager: StreamingEouAsrManager,
        tokenizer: Tokenizer,
        eouDetected: Bool = true
    ) async {
        await manager.consumeDecodeResult(
            DecodeResult(tokenIds: [], tokenFrames: [], eouDetected: eouDetected),
            tokenizer: tokenizer
        )
    }

    private func makeTokenizer() throws -> Tokenizer {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data(#"{"1":"▁First","2":"▁second","3":"▁third"}"#.utf8).write(to: path)
        defer { try? FileManager.default.removeItem(at: path) }
        return try Tokenizer(vocabPath: path)
    }
}

private final class EouTranscripts: @unchecked Sendable {
    private let lock = NSLock()
    private var transcripts: [String] = []

    func append(_ transcript: String) {
        lock.lock()
        defer { lock.unlock() }
        transcripts.append(transcript)
    }

    var values: [String] {
        lock.lock()
        defer { lock.unlock() }
        return transcripts
    }
}
