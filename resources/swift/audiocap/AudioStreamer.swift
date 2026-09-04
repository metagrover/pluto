import Foundation

/// AudioStreamer handles rate normalization to ensure AudioCap always delivers
/// a fixed 48,000 Hz Float32 mono PCM stream to stdout, regardless of the underlying
/// hardware audio device sample rate (e.g. 44.1kHz, 48kHz, 96kHz).
///
/// Implements a band-limited Blackman-windowed sinc FIR low-pass filter to guarantee
/// high stopband attenuation (>40dB) and eliminate aliasing when downsampling
/// (such as 96kHz -> 48kHz).
public final class AudioStreamer {
    public static let targetSampleRate: Double = 48000.0
    
    public let inputSampleRate: Double
    public let outputSampleRate: Double = 48000.0
    
    private let ratio: Double
    private let cutoff: Double
    private let filterRadius: Int
    private var phase: Double = 0.0
    private var carryover: [Float] = []
    
    public init(inputSampleRate: Double) {
        self.inputSampleRate = inputSampleRate
        let r = inputSampleRate / AudioStreamer.targetSampleRate
        self.ratio = r
        if r > 1.0 {
            // Downsampling: cutoff below output Nyquist relative to input sample rate
            self.cutoff = 0.45 / r
            self.filterRadius = max(8, Int(round(12.0 * r)))
        } else {
            // Upsampling: cutoff below input Nyquist
            self.cutoff = 0.45
            self.filterRadius = 12
        }
        self.phase = Double(self.filterRadius)
    }
    
    @inline(__always)
    private static func sinc(_ x: Double) -> Double {
        if abs(x) < 1e-9 { return 1.0 }
        let px = Double.pi * x
        return sin(px) / px
    }
    
    /// Resamples a chunk of mono Float32 PCM from `inputSampleRate` to 48,000 Hz.
    /// Preserves fractional phase and carryover samples across chunks to eliminate
    /// boundary clicks and phase discontinuities.
    public func resampleTo48k(_ input: [Float]) -> [Float] {
        if abs(inputSampleRate - AudioStreamer.targetSampleRate) < 1.0 {
            return input
        }
        guard !input.isEmpty else { return [] }
        
        let prefix: [Float]
        if carryover.count >= filterRadius {
            prefix = carryover
        } else {
            prefix = [Float](repeating: input[0], count: filterRadius)
        }
        
        let buffer = prefix + input
        let bufferCount = buffer.count
        let r = self.ratio
        let c = self.cutoff
        let rad = Double(filterRadius)
        
        var output: [Float] = []
        let estimatedCount = Int(Double(input.count) / r) + 4
        output.reserveCapacity(estimatedCount)
        
        var pos = self.phase
        
        while pos <= Double(bufferCount - 1) {
            let center = pos
            let startIdx = max(0, Int(floor(center - rad)))
            let endIdx = min(bufferCount - 1, Int(ceil(center + rad)))
            
            var sum: Double = 0.0
            var totalWeight: Double = 0.0
            
            for i in startIdx...endIdx {
                let tau = Double(i) - center
                // Blackman window
                let w = 0.42 + 0.5 * cos(Double.pi * tau / rad) + 0.08 * cos(2.0 * Double.pi * tau / rad)
                let h = 2.0 * c * AudioStreamer.sinc(2.0 * c * tau)
                let weight = h * w
                sum += Double(buffer[i]) * weight
                totalWeight += weight
            }
            
            let sample: Float = totalWeight > 0 ? Float(sum / totalWeight) : buffer[Int(round(center))]
            output.append(sample)
            pos += r
        }
        
        // Retain filterRadius samples from the tail of buffer as carryover
        let historyCount = min(bufferCount, filterRadius)
        carryover = Array(buffer[(bufferCount - historyCount)...])
        phase = pos - Double(bufferCount - historyCount)
        
        return output
    }
    
    public func reset() {
        carryover.removeAll()
        phase = Double(filterRadius)
    }
}
