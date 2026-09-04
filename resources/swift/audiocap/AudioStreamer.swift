import Foundation

/// AudioStreamer handles rate normalization to ensure AudioCap always delivers
/// a fixed 48,000 Hz Float32 mono PCM stream to stdout, regardless of the underlying
/// hardware audio device sample rate (e.g. 44.1kHz, 48kHz, 96kHz).
public final class AudioStreamer {
    public static let targetSampleRate: Double = 48000.0
    
    public let inputSampleRate: Double
    public let outputSampleRate: Double = 48000.0
    
    private var phase: Double = 0.0
    private var carryover: [Float] = []
    
    public init(inputSampleRate: Double) {
        self.inputSampleRate = inputSampleRate
    }
    
    /// Resamples a chunk of mono Float32 PCM from `inputSampleRate` to 48,000 Hz.
    /// Preserves fractional phase and carryover samples across chunks to avoid
    /// boundary clicks or discontinuities.
    public func resampleTo48k(_ input: [Float]) -> [Float] {
        if abs(inputSampleRate - AudioStreamer.targetSampleRate) < 1.0 {
            return input
        }
        guard !input.isEmpty else { return [] }
        
        let ratio = inputSampleRate / AudioStreamer.targetSampleRate
        let carryoverNeeded = 3
        
        let prefix: [Float]
        if carryover.count >= carryoverNeeded {
            prefix = carryover
        } else {
            prefix = [Float](repeating: input[0], count: carryoverNeeded)
        }
        
        let buffer = prefix + input
        let bufferCount = buffer.count
        let prefixCount = prefix.count
        
        var output: [Float] = []
        let estimatedCount = Int(Double(input.count) / ratio) + 2
        output.reserveCapacity(estimatedCount)
        
        var pos = Double(prefixCount) + phase
        
        while pos < Double(bufferCount - 1) {
            let idx = Int(pos)
            let alpha = Float(pos - Double(idx))
            
            let y0 = buffer[max(0, idx - 1)]
            let y1 = buffer[idx]
            let y2 = buffer[min(bufferCount - 1, idx + 1)]
            let y3 = buffer[min(bufferCount - 1, idx + 2)]
            
            // 4-point cubic Hermite interpolation
            let a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3
            let a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3
            let a2 = -0.5 * y0 + 0.5 * y2
            let a3 = y1
            let sample = a0 * alpha * alpha * alpha + a1 * alpha * alpha + a2 * alpha + a3
            
            output.append(sample)
            pos += ratio
        }
        
        phase = pos - Double(bufferCount - 1)
        if input.count >= carryoverNeeded {
            carryover = Array(input[(input.count - carryoverNeeded)...])
        } else {
            carryover = Array(buffer[(buffer.count - carryoverNeeded)...])
        }
        
        return output
    }
    
    public func reset() {
        phase = 0.0
        carryover.removeAll()
    }
}
