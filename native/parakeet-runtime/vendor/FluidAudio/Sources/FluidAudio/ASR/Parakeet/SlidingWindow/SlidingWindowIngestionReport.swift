import Foundation

/// An exact half-open range in the 16 kHz sample timeline.
public struct SlidingWindowSampleRange: Equatable, Sendable {
    public let startSample: Int
    public let endSample: Int

    public init(startSample: Int, endSample: Int) {
        precondition(startSample >= 0 && endSample >= startSample)
        self.startSample = startSample
        self.endSample = endSample
    }
}

/// Finite failure reasons suitable for privacy-safe callers and metrics.
public enum SlidingWindowFailureReason: String, Error, Equatable, Sendable {
    case decoderUnavailable
    case transcriptionUnavailable
    case processingFailed
    case cancelled
}

/// A center range that could not be transcribed.
public struct SlidingWindowFailedRange: Equatable, Sendable {
    public let centerRange: SlidingWindowSampleRange
    public let reason: SlidingWindowFailureReason

    public init(centerRange: SlidingWindowSampleRange, reason: SlidingWindowFailureReason) {
        self.centerRange = centerRange
        self.reason = reason
    }
}

/// The synchronous acknowledgement for one direct ingestion operation.
public struct SlidingWindowIngestionReport: Sendable {
    public let receipt: String
    public let acceptedSamples: SlidingWindowSampleRange
    public let attemptedCenterRanges: [SlidingWindowSampleRange]
    public let processedCenterRanges: [SlidingWindowSampleRange]
    public let failedCenterRanges: [SlidingWindowFailedRange]
    public let updates: [SlidingWindowTranscriptionUpdate]

    public init(
        receipt: String,
        acceptedSamples: SlidingWindowSampleRange,
        attemptedCenterRanges: [SlidingWindowSampleRange],
        processedCenterRanges: [SlidingWindowSampleRange],
        failedCenterRanges: [SlidingWindowFailedRange],
        updates: [SlidingWindowTranscriptionUpdate]
    ) {
        self.receipt = receipt
        self.acceptedSamples = acceptedSamples
        self.attemptedCenterRanges = attemptedCenterRanges
        self.processedCenterRanges = processedCenterRanges
        self.failedCenterRanges = failedCenterRanges
        self.updates = updates
    }
}

/// The final text plus every update and center range produced while draining the tail.
public struct SlidingWindowFinishReport: Sendable {
    public let finalTranscript: String
    public let attemptedCenterRanges: [SlidingWindowSampleRange]
    public let processedCenterRanges: [SlidingWindowSampleRange]
    public let failedCenterRanges: [SlidingWindowFailedRange]
    public let finalUpdates: [SlidingWindowTranscriptionUpdate]

    public init(
        finalTranscript: String,
        attemptedCenterRanges: [SlidingWindowSampleRange],
        processedCenterRanges: [SlidingWindowSampleRange],
        failedCenterRanges: [SlidingWindowFailedRange],
        finalUpdates: [SlidingWindowTranscriptionUpdate]
    ) {
        self.finalTranscript = finalTranscript
        self.attemptedCenterRanges = attemptedCenterRanges
        self.processedCenterRanges = processedCenterRanges
        self.failedCenterRanges = failedCenterRanges
        self.finalUpdates = finalUpdates
    }
}

/// Finite errors for acknowledged ingestion admission and lifecycle failures.
public enum SlidingWindowAcknowledgedIngestionError: Error, Equatable, Sendable {
    case emptyReceipt
    case mixedIngestionModes
    case operationInProgress
    case streamClosed
    case audioConversionFailed
    case cancelled
}
