import Foundation

public func normalizeWordTimings(
    _ words: [TranscriptionWord],
    durationSeconds: Double,
    maximumDecoderOverlapSeconds: Double = 0.25
) throws -> [TranscriptionWord] {
    guard durationSeconds.isFinite, durationSeconds >= 0 else {
        throw RuntimeFailure.transcriptionFailed
    }
    var previousEnd = 0.0
    return try words.map { word in
        guard
            !word.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            word.startSeconds.isFinite,
            word.endSeconds.isFinite,
            word.startSeconds >= 0,
            word.endSeconds >= word.startSeconds,
            word.endSeconds <= durationSeconds + maximumDecoderOverlapSeconds
        else { throw RuntimeFailure.transcriptionFailed }

        let overlap = max(0, previousEnd - word.startSeconds)
        guard overlap <= maximumDecoderOverlapSeconds else {
            throw RuntimeFailure.transcriptionFailed
        }
        let start = max(previousEnd, word.startSeconds)
        let end = min(durationSeconds, max(start, word.endSeconds))
        guard start <= durationSeconds else {
            throw RuntimeFailure.transcriptionFailed
        }
        previousEnd = end
        return TranscriptionWord(
            text: word.text,
            startSeconds: start,
            endSeconds: end,
            confidence: word.confidence
        )
    }
}
