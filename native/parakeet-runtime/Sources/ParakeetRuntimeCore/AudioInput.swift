import Foundation

public enum AudioInput: Sendable {
    case fileURL(URL)
    case pcmSamples([Float], sampleRate: Double)
    case encryptedReader(any EncryptedAudioReading)
}
