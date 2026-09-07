import Foundation

public enum AudioInput: Sendable {
    case fileURL(URL)
    case pcmSamples([Float], sampleRate: Double)

    public var sampleCount: Int? {
        switch self {
        case .fileURL:
            return nil
        case .pcmSamples(let samples, _):
            return samples.count
        }
    }
}
