import XCTest
@testable import ParakeetRuntimeCore

final class VocabularyTimingReconcilerTests: XCTestCase {
    func testReplacesKnownTermWithoutChangingItsTiming() {
        let words = [
            TranscriptionWord(text: "fluid", startSeconds: 0, endSeconds: 0.5),
            TranscriptionWord(text: "audio", startSeconds: 0.5, endSeconds: 1),
        ]

        let reconciled = reconcileVocabularyTimings(
            words: words,
            replacements: [VocabularyReplacement(original: "fluid audio", replacement: "FluidAudio")]
        )

        XCTAssertEqual(reconciled, [
            TranscriptionWord(text: "FluidAudio", startSeconds: 0, endSeconds: 1),
        ])
    }

    func testDistributesAOneToManyReplacementAcrossOriginalSpan() {
        let words = [
            TranscriptionWord(text: "metagrover", startSeconds: 2, endSeconds: 4),
        ]

        let reconciled = reconcileVocabularyTimings(
            words: words,
            replacements: [VocabularyReplacement(original: "metagrover", replacement: "Meta Grover")]
        )

        XCTAssertEqual(reconciled.map(\.text), ["Meta", "Grover"])
        XCTAssertEqual(reconciled.map(\.startSeconds), [2, 3])
        XCTAssertEqual(reconciled.map(\.endSeconds), [3, 4])
    }

    func testLeavesWordsUntouchedWhenOriginalPhraseCannotBeLocated() {
        let words = [TranscriptionWord(text: "Pluto", startSeconds: 0, endSeconds: 1)]

        XCTAssertEqual(
            reconcileVocabularyTimings(
                words: words,
                replacements: [VocabularyReplacement(original: "missing", replacement: "private")]
            ),
            words
        )
    }
}
