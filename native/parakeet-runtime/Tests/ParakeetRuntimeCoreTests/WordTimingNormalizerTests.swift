import XCTest
@testable import ParakeetRuntimeCore

final class WordTimingNormalizerTests: XCTestCase {
    func testClampsBoundedDecoderOverlapToPriorWordEnd() throws {
        let words = try normalizeWordTimings(
            [
                TranscriptionWord(text: "one", startSeconds: 1, endSeconds: 2),
                TranscriptionWord(text: "two", startSeconds: 1.84, endSeconds: 2.4),
            ],
            durationSeconds: 3
        )

        XCTAssertEqual(words[1].startSeconds, 2)
        XCTAssertEqual(words[1].endSeconds, 2.4)
    }

    func testRejectsLargeOverlapRatherThanInventingTiming() {
        XCTAssertThrowsError(
            try normalizeWordTimings(
                [
                    TranscriptionWord(text: "one", startSeconds: 1, endSeconds: 2),
                    TranscriptionWord(text: "two", startSeconds: 1.5, endSeconds: 2.4),
                ],
                durationSeconds: 3
            )
        )
    }

    func testClampsSmallEndOvershootToVerifiedFileDuration() throws {
        let words = try normalizeWordTimings(
            [TranscriptionWord(text: "last", startSeconds: 2.8, endSeconds: 3.1)],
            durationSeconds: 3
        )
        XCTAssertEqual(words[0].endSeconds, 3)
    }
}
