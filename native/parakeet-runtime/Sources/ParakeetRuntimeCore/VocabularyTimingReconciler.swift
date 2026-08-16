import Foundation

public struct VocabularyReplacement: Equatable, Sendable {
    public let original: String
    public let replacement: String

    public init(original: String, replacement: String) {
        self.original = original
        self.replacement = replacement
    }
}

public func reconcileVocabularyTimings(
    words: [TranscriptionWord],
    replacements: [VocabularyReplacement]
) -> [TranscriptionWord] {
    var reconciled = words
    var searchStart = 0

    for replacement in replacements {
        let originalTokens = tokens(in: replacement.original).map(normalized)
        let replacementTokens = tokens(in: replacement.replacement)
        guard !originalTokens.isEmpty, !replacementTokens.isEmpty else { continue }

        let normalizedWords = reconciled.map { normalized($0.text) }
        guard let match = find(
            originalTokens,
            in: normalizedWords,
            startingAt: searchStart
        ) ?? find(originalTokens, in: normalizedWords, startingAt: 0) else { continue }

        let matchedWords = Array(reconciled[match])
        guard let first = matchedWords.first, let last = matchedWords.last else { continue }
        let duration = max(0, last.endSeconds - first.startSeconds)
        let step = duration / Double(replacementTokens.count)
        let confidences = matchedWords.compactMap(\.confidence)
        let confidence = confidences.isEmpty
            ? nil
            : confidences.reduce(0, +) / Double(confidences.count)
        let timedReplacement = replacementTokens.enumerated().map { index, token in
            TranscriptionWord(
                text: token,
                startSeconds: first.startSeconds + (Double(index) * step),
                endSeconds: index == replacementTokens.count - 1
                    ? last.endSeconds
                    : first.startSeconds + (Double(index + 1) * step),
                confidence: confidence
            )
        }
        reconciled.replaceSubrange(match, with: timedReplacement)
        searchStart = match.lowerBound + timedReplacement.count
    }

    return reconciled
}

private func tokens(in text: String) -> [String] {
    text.split(whereSeparator: \.isWhitespace).map(String.init)
}

private func normalized(_ text: String) -> String {
    String(text.lowercased().unicodeScalars.filter {
        CharacterSet.alphanumerics.contains($0)
    })
}

private func find(
    _ needle: [String],
    in haystack: [String],
    startingAt start: Int
) -> Range<Int>? {
    guard !needle.isEmpty, needle.count <= haystack.count else { return nil }
    let firstIndex = min(max(0, start), haystack.count - needle.count)
    for index in firstIndex...(haystack.count - needle.count) {
        if Array(haystack[index..<(index + needle.count)]) == needle {
            return index..<(index + needle.count)
        }
    }
    return nil
}
