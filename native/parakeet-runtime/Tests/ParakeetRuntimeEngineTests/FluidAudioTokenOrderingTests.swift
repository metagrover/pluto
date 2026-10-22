import XCTest
@testable import FluidAudio

final class FluidAudioTokenOrderingTests: XCTestCase {
    func testBackwardTimestampDoesNotReorderDecodedWordPieces() {
        var tokens: [ChunkProcessor.TokenWindow] = [
            (10, 100, 0.91, 1),
            (11, 104, 0.92, 2),
            (12, 103, 0.93, 3),
            (13, 105, 0.94, 4),
        ]
        ChunkProcessor.clampTokenTimestamps(&tokens)
        XCTAssertEqual(tokens.map(\.token), [10, 11, 12, 13])
        XCTAssertEqual(tokens.map(\.timestamp), [100, 104, 104, 105])
        XCTAssertEqual(tokens.map(\.confidence), [0.91, 0.92, 0.93, 0.94])
        XCTAssertEqual(tokens.map(\.duration), [1, 2, 3, 4])
    }

    func testOrderedAndEqualTimestampsPreserveEveryToken() {
        var tokens: [ChunkProcessor.TokenWindow] = [
            (20, 2, 0.9, 1), (21, 2, 0.8, 1), (22, 3, 0.7, 1),
        ]
        ChunkProcessor.clampTokenTimestamps(&tokens)
        XCTAssertEqual(tokens.map(\.token), [20, 21, 22])
        XCTAssertEqual(tokens.map(\.timestamp), [2, 2, 3])
    }

    func testEmptyAndSingleTokenInputsAreUnchanged() {
        var tokens: [ChunkProcessor.TokenWindow] = []
        ChunkProcessor.clampTokenTimestamps(&tokens)
        XCTAssertTrue(tokens.isEmpty)
        tokens = [(30, 7, 0.9, 2)]
        ChunkProcessor.clampTokenTimestamps(&tokens)
        XCTAssertEqual(tokens.map(\.token), [30])
        XCTAssertEqual(tokens.map(\.timestamp), [7])
    }
}
