
import Foundation
import AudioToolbox
import AVFoundation
import OSLog

let logger = Logger(subsystem: "com.metagrover.pluto.audiocap", category: "CLI")

func getAudioProcesses(includeSelf: Bool, targetPids: Set<Int32>? = nil) -> [Int32] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    let err = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    guard err == noErr else { return [] }
    
    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var processIDs = [AudioObjectID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &processIDs)
    
    var pids: [Int32] = []
    let myPid = ProcessInfo.processInfo.processIdentifier
    
    for pidObj in processIDs {
        var pidAddress = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyPID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var pid: pid_t = 0
        var pidSize = UInt32(MemoryLayout<pid_t>.size)
        
        if AudioObjectGetPropertyData(pidObj, &pidAddress, 0, nil, &pidSize, &pid) == noErr {
            let canIncludeSelf = includeSelf || pid != myPid
            let passesTargetFilter = targetPids == nil || targetPids?.contains(pid) == true
            if canIncludeSelf && passesTargetFilter {
                pids.append(pid)
            }
        }
    }
    return pids
}


class AudioCapCLI {
    let tap: ProcessTap
    let runLoop = CFRunLoopGetCurrent()
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    
    init(includeSelf: Bool, targetPids: [Int32]?) {
        let targetSet = (targetPids != nil && !(targetPids?.isEmpty ?? true)) ? Set(targetPids!) : nil

        // Dynamic discovery of PIDs
        let pids = getAudioProcesses(includeSelf: includeSelf, targetPids: targetSet)
        logger.info("Found \(pids.count) audio processes to tap.")
        if let targetSet {
            fputs("[AudioCap] Requested target PIDs: \(Array(targetSet))\n", stderr)
        }
        fputs("[AudioCap] Found \(pids.count) processes: \(pids)\n", stderr)
      
        self.tap = ProcessTap(pids: pids)
    }
    
    func start() {
        let queue = DispatchQueue(label: "AudioCapQueue")
        
        do {
            try tap.activate()
            
            // Standard Output Handle
            let stdout = FileHandle.standardOutput
            
            try tap.start(on: queue) { (inNow, inInputData, inInputTime, outOutputData, inOutputTime) in
                // Callback is on a realtime thread. Keep it light.
                // inInputData is AudioBufferList.
                // inInputData is UnsafePointer<AudioBufferList>
                let mutableInputData = UnsafeMutablePointer<AudioBufferList>(mutating: inInputData)
                let bufferList = UnsafeMutableAudioBufferListPointer(mutableInputData)
                for buffer in bufferList {
                    if let data = buffer.mData {
                        let size = Int(buffer.mDataByteSize)
                        if size > 0 {
                            let pcmData = Data(bytes: data, count: size)
                            // Writing to FileHandle might block? 
                            // In high-perf, we use a ring buffer. For CLI, explicit write is 'okay' usually.
                            try? stdout.write(contentsOf: pcmData)
                        }
                    }
                }
                return
            }
            
            // Keep runloop alive
            CFRunLoopRun()
            
        } catch {
            logger.error("Error starting capture: \(error.localizedDescription)")
            exit(1)
        }
    }

    func probe(durationMs: Int) {
        let queue = DispatchQueue(label: "AudioCapProbeQueue")
        var sawNonZero = false
        do {
            try tap.activate()
            try tap.start(on: queue) { (_inNow, inInputData, _inInputTime, _outOutputData, _inOutputTime) in
                let mutableInputData = UnsafeMutablePointer<AudioBufferList>(mutating: inInputData)
                let bufferList = UnsafeMutableAudioBufferListPointer(mutableInputData)
                for buffer in bufferList {
                    if let data = buffer.mData, buffer.mDataByteSize > 0 {
                        let bytes = data.assumingMemoryBound(to: UInt8.self)
                        let count = Int(buffer.mDataByteSize)
                        var idx = 0
                        while idx < count {
                            if bytes[idx] != 0 {
                                sawNonZero = true
                                break
                            }
                            idx += 1
                        }
                        if sawNonZero { break }
                    }
                }
                return
            }

            playProbeTone(durationMs: durationMs, frequency: 440, volume: 0.08)

            let start = Date()
            while Date().timeIntervalSince(start) < Double(durationMs) / 1000.0 {
                CFRunLoopRunInMode(.defaultMode, 0.05, false)
            }

            tap.stop()
            stopProbeTone()
            fputs("{\"status\":\"ok\",\"sawNonZero\":\(sawNonZero)}\n", stderr)
            exit(sawNonZero ? 0 : 2)
        } catch {
            stopProbeTone()
            fputs("{\"status\":\"error\",\"message\":\"\(error.localizedDescription)\"}\n", stderr)
            exit(1)
        }
    }

    private func playProbeTone(durationMs: Int, frequency: Double, volume: Float) {
        if playProbeFileIfAvailable() { return }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)

        let outputFormat = engine.outputNode.outputFormat(forBus: 0)
        engine.connect(player, to: engine.mainMixerNode, format: outputFormat)

        let sampleRate = outputFormat.sampleRate
        let frameCount = AVAudioFrameCount(sampleRate * (Double(durationMs) / 1000.0))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: frameCount) else { return }
        buffer.frameLength = frameCount

        let channels = Int(outputFormat.channelCount)
        if let floatData = buffer.floatChannelData {
            for ch in 0..<channels {
                let channel = floatData[ch]
                for i in 0..<Int(frameCount) {
                    let t = Double(i) / sampleRate
                    channel[i] = Float(sin(2.0 * Double.pi * frequency * t)) * volume
                }
            }
        }

        do {
            try engine.start()
            player.play()
            player.scheduleBuffer(buffer, at: nil, options: .interrupts, completionHandler: nil)
            self.engine = engine
            self.player = player
        } catch {
            // Best-effort; probe still runs even if tone fails
        }
    }

    private func playProbeFileIfAvailable() -> Bool {
        let execPath = CommandLine.arguments.first ?? ""
        let execURL = URL(fileURLWithPath: execPath)
        let soundsDir = execURL.deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("sounds")
        let wavURL = soundsDir.appendingPathComponent("boot.wav")
        let mp3URL = soundsDir.appendingPathComponent("boot.mp3")
        let soundsURL = FileManager.default.fileExists(atPath: wavURL.path) ? wavURL : mp3URL

        guard FileManager.default.fileExists(atPath: soundsURL.path) else { return false }

        do {
            let file = try AVAudioFile(forReading: soundsURL)
            let engine = AVAudioEngine()
            let player = AVAudioPlayerNode()
            engine.attach(player)

            let format = file.processingFormat
            engine.connect(player, to: engine.mainMixerNode, format: format)
            player.volume = 0.25

            try engine.start()
            player.play()
            player.scheduleFile(file, at: nil, completionHandler: nil)

            self.engine = engine
            self.player = player
            return true
        } catch {
            return false
        }
    }

    private func stopProbeTone() {
        player?.stop()
        engine?.stop()
        player = nil
        engine = nil
    }
}

// Trap signals
signal(SIGINT) { _ in
    logger.info("Stopping...")
    exit(0)
}

func parseTargetPids(arguments: [String]) -> [Int32] {
    var parsed: [Int32] = []
    var idx = 0
    while idx < arguments.count {
        let arg = arguments[idx]
        if arg == "--pid", idx + 1 < arguments.count {
            if let pid = Int32(arguments[idx + 1]) {
                parsed.append(pid)
            }
            idx += 1
        } else if arg == "--pids", idx + 1 < arguments.count {
            let values = arguments[idx + 1].split(separator: ",").compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
            parsed.append(contentsOf: values)
            idx += 1
        }
        idx += 1
    }
    return Array(Set(parsed))
}

let includeSelf = CommandLine.arguments.contains("--probe-include-self")
let targetPids = parseTargetPids(arguments: CommandLine.arguments)
let cli = AudioCapCLI(includeSelf: includeSelf, targetPids: targetPids.isEmpty ? nil : targetPids)
if CommandLine.arguments.contains("--probe") {
    var durationMs = 1500
    if let idx = CommandLine.arguments.firstIndex(of: "--probe-ms"), idx + 1 < CommandLine.arguments.count {
        if let parsed = Int(CommandLine.arguments[idx + 1]) {
            durationMs = parsed
        }
    }
    cli.probe(durationMs: durationMs)
} else {
    cli.start()
}
