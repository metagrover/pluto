import XCTest
@testable import FluidAudio

final class FluidAudioVocabularyBoundaryTests: XCTestCase {
    func testCorrectVocabularyPhraseCannotConsumeNeighboringWordsOrClipItsEdges() {
        let words = ["the", "Central,", "OFFICE!", "opens"]
        for indices in [[1, 2, 3], [2, 3], [0, 1], [0, 1, 2, 3]] {
            XCTAssertTrue(VocabularyRescorer.overlapsCanonicalWords(words: words, vocabularyTerm: "Central Office", candidateIndices: indices))
        }
    }

    func testAnotherOccurrenceAndMisrecognitionsRemainEligibleForCorrection() {
        let words = ["Central", "Office", "opens", "centrl", "office"]
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: words, vocabularyTerm: "Central Office", candidateIndices: [3, 4]))
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: ["Bisco", "tti", "report"], vocabularyTerm: "Biscotti", candidateIndices: [0, 1]))
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: ["Northern", "wing"], vocabularyTerm: "North Wing", candidateIndices: [0, 1]))
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: ["blueberry"], vocabularyTerm: "blue", candidateIndices: [0]))
    }

    func testEmptyOrLongerCanonicalPhraseDoesNotMatch() {
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: [], vocabularyTerm: "Central Office", candidateIndices: [0]))
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: ["Central"], vocabularyTerm: "Central Office", candidateIndices: [0]))
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: ["Central", "Office"], vocabularyTerm: "!!!", candidateIndices: [0, 1]))
        XCTAssertFalse(VocabularyRescorer.overlapsCanonicalWords(words: ["Central", "Office"], vocabularyTerm: "Central Office", candidateIndices: []))
    }
}
