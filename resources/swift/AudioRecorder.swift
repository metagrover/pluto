import Foundation
import ScreenCaptureKit
import AVFoundation

class AudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var audioFile: AVAudioFile?
    private var stdoutHandle: FileHandle = FileHandle.standardOutput
    
    // PCM Buffer Settings
    private let outputSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 16000,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false
    ]
    
    static func checkPermissions() async -> Bool {
        // Basic check - usually SCStream.shareableContent triggers the prompt if not allowed
        do {
            _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            return true
        } catch {
            return false
        }
    }

    func start(outputPath: String?, excludeBundleId: String?) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        
        guard let display = content.displays.first else {
            throw NSError(domain: "Recorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display found"])
        }
        
        // Filters: Exclude the running app (Electron) to avoid echo
        var excludedApps = [SCRunningApplication]()
        if let bundleId = excludeBundleId {
             excludedApps = content.applications.filter { $0.bundleIdentifier == bundleId }
        }
        // Also exclude ourself (the swift process) just in case
        if let myBundleId = Bundle.main.bundleIdentifier {
             let myApps = content.applications.filter { $0.bundleIdentifier == myBundleId }
             excludedApps.append(contentsOf: myApps)
        }
        
        let filter = SCContentFilter(display: display, excludingApplications: excludedApps, exceptingWindows: [])
        
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        // config.capturesVideo doesn't exist, control via outputs
        config.sampleRate = 16000
        config.channelCount = 1
        
        // Save file setup if path provided
        if let path = outputPath {
            let url = URL(fileURLWithPath: path)
            audioFile = try AVAudioFile(forWriting: url, settings: outputSettings)
        }
        
        stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "audio.queue"))
        
        try await stream?.startCapture()
    }
    
    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
        audioFile = nil // closes file
    }
    
    // MARK: - SCStreamOutput
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        
        // Debug: Log first few buffers or periodically
        // Static var to count? Need instance var.
        // For now, let's just log every 500th buffer to keep it sane but visible
        // Actually, cleaner to verify data presence.
        
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var lengthAtOffset: Int = 0
        var totalLength: Int = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        
        if CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: &lengthAtOffset, totalLengthOut: &totalLength, dataPointerOut: &dataPointer) == kCMBlockBufferNoErr {
            if let ptr = dataPointer {
                let data = Data(bytes: ptr, count: totalLength)
                // Write data to stdout
                try? stdoutHandle.write(contentsOf: data)
            }
        }
    }
    
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("{\"error\": \"stream_stopped\", \"details\": \"\(error.localizedDescription)\"}")
        fflush(stdout)
        exit(1)
    }
    
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("{\"error\": \"stream_stopped\", \"details\": \"\(error.localizedDescription)\"}")
        fflush(stdout)
        exit(1)
    }
}
