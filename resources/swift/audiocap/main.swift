
import Foundation
import AudioToolbox
import OSLog

let logger = Logger(subsystem: "com.metagrover.pluto.audiocap", category: "CLI")

// For "System Audio", tap every audio process except ourselves.
// ProcessTap requires explicit PIDs, so we scan the process object list.

func getAudioProcesses(includeSelf: Bool, targetPids: Set<Int32>? = nil) -> (pids: [Int32], excluded: [Int32]) {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    let err = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    guard err == noErr else { return ([], []) }
    
    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var processIDs = [AudioObjectID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &processIDs)
    
    var candidatePids: [Int32] = []
    let myPid = ProcessInfo.processInfo.processIdentifier
    let parentPid = getppid()
    var excluded: [Int32] = []
    
    for pidObj in processIDs {
        var pidAddress = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyPID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var pid: pid_t = 0
        var pidSize = UInt32(MemoryLayout<pid_t>.size)
        
        if AudioObjectGetPropertyData(pidObj, &pidAddress, 0, nil, &pidSize, &pid) == noErr {
            let canIncludeSelf = includeSelf || (pid != myPid && pid != parentPid)
            let passesTargetFilter = targetPids == nil || targetPids?.contains(pid) == true

            if canIncludeSelf && passesTargetFilter {
                candidatePids.append(pid)
            } else if !includeSelf && (pid == myPid || pid == parentPid) {
                excluded.append(pid)
            }
        }
    }

    return (candidatePids, excluded)
}


class AudioCapCLI {
    private var tap: ProcessTap?
    let runLoop = CFRunLoopGetCurrent()
    private var loggedMultiBufferWarning = false
    private let includeSelf: Bool
    private let targetPids: [Int32]?
    private var probePlayerProcess: Process?

    private let queue = DispatchQueue(label: "AudioCapQueue")
    private let controlQueue = DispatchQueue(label: "AudioCapControlQueue")
    private var isRunning = false
    private var isSelfModifyingDevices = false
    private var framesReceived: UInt64 = 0
    private var tapGeneration: UInt64 = 0
    private var tapFramesReceived: UInt64 = 0
    private var tapStartTime: Date = Date()
    private var watchdogTimer: DispatchSourceTimer?
    private var reconnectWorkItem: DispatchWorkItem?
    private var watchdogRetries = 0
    private let maxWatchdogRetries = 2
    private var lastFrameTime: Date = Date()
    let targetSampleRate: Double = 48000.0
    
    init(includeSelf: Bool, targetPids: [Int32]?) {
        self.includeSelf = includeSelf
        self.targetPids = targetPids
    }

    private func registerRouteListeners() {
        let selectors: [AudioObjectPropertySelector] = [
            kAudioHardwarePropertyDefaultOutputDevice,
            kAudioHardwarePropertyDefaultInputDevice,
            kAudioHardwarePropertyDevices
        ]
        for selector in selectors {
            var address = AudioObjectPropertyAddress(
                mSelector: selector,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            AudioObjectAddPropertyListenerBlock(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                controlQueue
            ) { [weak self] _, _ in
                guard let self = self, self.isRunning else { return }
                if selector == kAudioHardwarePropertyDevices && self.isSelfModifyingDevices {
                    return
                }
                self.handleRouteChangedDebounced()
            }
        }
    }

    private func handleRouteChangedDebounced() {
        if isSelfModifyingDevices { return }
        reconnectWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self, self.isRunning, !self.isSelfModifyingDevices else { return }
            fputs("[AudioCap] CoreAudio device change detected, reconfiguring tap...\n", stderr)
            self.restartTap(isExternalRouteChange: true)
        }
        reconnectWorkItem = workItem
        controlQueue.asyncAfter(deadline: .now() + 0.2, execute: workItem)
    }

    private func startWatchdogTimer() {
        let timer = DispatchSource.makeTimerSource(queue: controlQueue)
        timer.schedule(deadline: .now() + 1.0, repeating: 1.0)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.isRunning else { return }
            let now = Date()
            let elapsedSinceTapStart = now.timeIntervalSince(self.tapStartTime)
            let elapsedSinceLastFrame = now.timeIntervalSince(self.lastFrameTime)
            
            let isInitialSilence = (self.tapFramesReceived == 0 && elapsedSinceTapStart >= 3.0)
            let isStalled = (self.tapFramesReceived > 0 && elapsedSinceLastFrame >= 3.0)
            
            if isInitialSilence || isStalled {
                if self.watchdogRetries < self.maxWatchdogRetries {
                    self.watchdogRetries += 1
                    let reason = isInitialSilence ? "0 frames received in 3.0s" : "audio stream stalled for 3.0s"
                    fputs("[AudioCap] Watchdog: \(reason) for tap generation \(self.tapGeneration) (retry \(self.watchdogRetries)/\(self.maxWatchdogRetries)), restarting tap...\n", stderr)
                    self.restartTap(isExternalRouteChange: false)
                } else {
                    fputs("[AudioCap] Watchdog: exceeded \(self.maxWatchdogRetries) retries for tap generation \(self.tapGeneration).\n", stderr)
                }
            } else if self.tapFramesReceived > 0 && elapsedSinceLastFrame < 1.0 {
                self.watchdogRetries = 0
            }
        }
        timer.resume()
        self.watchdogTimer = timer
    }

    private func restartTap(isExternalRouteChange: Bool = false) {
        isSelfModifyingDevices = true
        reconnectWorkItem?.cancel()
        tapGeneration += 1
        tapFramesReceived = 0
        tapStartTime = Date()
        lastFrameTime = Date()
        if isExternalRouteChange {
            watchdogRetries = 0
        }
        tap?.stop()
        tap = nil
        var attempts = 0
        while attempts < 3 {
            let foundTargets = refreshTapTargets()
            if foundTargets, let tap = self.tap {
                do {
                    try tap.activate()
                    if let desc = tap.tapStreamDescription {
                        try startTapStreaming(tap: tap, desc: desc)
                        fputs("[AudioCap] Tap restarted successfully.\n", stderr)
                        controlQueue.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                            self?.isSelfModifyingDevices = false
                        }
                        return
                    }
                } catch {
                    fputs("[AudioCap] Tap restart attempt \(attempts + 1) failed: \(error.localizedDescription)\n", stderr)
                }
            }
            attempts += 1
            Thread.sleep(forTimeInterval: 0.15)
        }
        controlQueue.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.isSelfModifyingDevices = false
        }
    }

    private func startTapStreaming(tap: ProcessTap, desc: AudioStreamBasicDescription) throws {
        let flags = desc.mFormatFlags
        let nonInterleaved = (flags & UInt32(kAudioFormatFlagIsNonInterleaved)) != 0
        fputs(
            "[AudioCap] Tap format: sampleRate=\(Int(desc.mSampleRate)), channels=\(desc.mChannelsPerFrame), " +
            "bytesPerFrame=\(desc.mBytesPerFrame), bitsPerChannel=\(desc.mBitsPerChannel), " +
            "nonInterleaved=\(nonInterleaved)\n",
            stderr
        )
        guard desc.mBitsPerChannel == 32,
              (flags & UInt32(kAudioFormatFlagIsFloat)) != 0 else {
            throw ProcessTapError.unsupportedTapFormat
        }

        let currentGeneration = self.tapGeneration
        let audioStreamer = AudioStreamer(inputSampleRate: desc.mSampleRate)
        let stdout = FileHandle.standardOutput
        let streamChannels = max(1, Int(desc.mChannelsPerFrame))
        try tap.start(on: queue) { [weak self] (_, inInputData, _, _, _) in
            let mutableInputData = UnsafeMutablePointer<AudioBufferList>(mutating: inInputData)
            let buffers = UnsafeMutableAudioBufferListPointer(mutableInputData).filter {
                $0.mData != nil && $0.mDataByteSize >= MemoryLayout<Float>.size
            }
            guard !buffers.isEmpty else { return }

            let mono: [Float]
            if nonInterleaved {
                let frameCount = buffers.map { buffer in
                    let channels = max(1, Int(buffer.mNumberChannels))
                    return Int(buffer.mDataByteSize) / MemoryLayout<Float>.size / channels
                }.min() ?? 0
                guard frameCount > 0 else { return }

                var mixed = [Float](repeating: 0, count: frameCount)
                var contributingChannels = 0
                for buffer in buffers {
                    guard let data = buffer.mData else { continue }
                    let channels = max(1, Int(buffer.mNumberChannels))
                    let samples = data.assumingMemoryBound(to: Float.self)
                    for frame in 0..<frameCount {
                        for channel in 0..<channels {
                            mixed[frame] += samples[(frame * channels) + channel]
                        }
                    }
                    contributingChannels += channels
                }
                guard contributingChannels > 0 else { return }
                let scale = 1.0 / Float(contributingChannels)
                for frame in 0..<frameCount { mixed[frame] *= scale }
                mono = mixed
            } else {
                guard let buffer = buffers.first, let data = buffer.mData else { return }
                let availableSamples = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
                let frameCount = availableSamples / streamChannels
                guard frameCount > 0 else { return }
                let samples = data.assumingMemoryBound(to: Float.self)
                var mixed = [Float](repeating: 0, count: frameCount)
                for frame in 0..<frameCount {
                    for channel in 0..<streamChannels {
                        mixed[frame] += samples[(frame * streamChannels) + channel]
                    }
                    mixed[frame] /= Float(streamChannels)
                }
                mono = mixed
            }
            let normalized = audioStreamer.resampleTo48k(mono)
            let frameCount = UInt64(normalized.count)
            self?.controlQueue.async { [weak self] in
                guard let self = self, self.tapGeneration == currentGeneration else { return }
                normalized.withUnsafeBytes { bytes in
                    try? stdout.write(contentsOf: Data(bytes))
                }
                self.framesReceived += frameCount
                self.tapFramesReceived += frameCount
                self.lastFrameTime = Date()
            }
        }
    }

    @discardableResult
    private func refreshTapTargets() -> Bool {
        let targetSet =
            (targetPids != nil && !(targetPids?.isEmpty ?? true))
            ? Set(targetPids!)
            : nil
        let processSelection = getAudioProcesses(
            includeSelf: includeSelf,
            targetPids: targetSet
        )
        let pids = processSelection.pids

        logger.info("Found \(pids.count) audio processes to tap.")
        if let targetSet {
            fputs("[AudioCap] Requested target PIDs: \(Array(targetSet))\n", stderr)
        }
        fputs("[AudioCap] Found \(pids.count) processes: \(pids)\n", stderr)
        if !processSelection.excluded.isEmpty {
            fputs("[AudioCap] Excluded process PIDs: \(processSelection.excluded)\n", stderr)
        }

        tap?.stop()
        tap = ProcessTap(pids: pids)
        return !pids.isEmpty
    }
    
    func start() {
        isRunning = true
        tapGeneration = 1
        tapFramesReceived = 0
        tapStartTime = Date()
        lastFrameTime = Date()
        registerRouteListeners()
        startWatchdogTimer()
        
        do {
            var attempts = 0
            while true {
                isSelfModifyingDevices = true
                let foundTargets = refreshTapTargets()
                if foundTargets, let tap {
                    try tap.activate()
                    if let desc = tap.tapStreamDescription {
                        try startTapStreaming(tap: tap, desc: desc)
                        controlQueue.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                            self?.isSelfModifyingDevices = false
                        }
                        break
                    }
                }

                if attempts == 0 || attempts % 10 == 0 {
                    fputs("[AudioCap] Waiting for audio processes...\n", stderr)
                }
                attempts += 1
                Thread.sleep(forTimeInterval: 0.5)
            }
            
            // Keep runloop alive
            CFRunLoopRun()
            
        } catch {
            logger.error("Error starting capture: \(error.localizedDescription)")
            exit(1)
        }
    }

    func probe(durationMs: Int, emitProbeTone: Bool) {
        let queue = DispatchQueue(label: "AudioCapProbeQueue")
        var sawNonZero = false
        do {
            if emitProbeTone {
                playProbeTone(durationMs: durationMs, frequency: 440, volume: 0.08)
                Thread.sleep(forTimeInterval: 0.15)
            }

            let foundTargets = refreshTapTargets()
            guard foundTargets, let tap else {
                stopProbeTone()
                fputs("{\"status\":\"error\",\"message\":\"No audio processes available to tap\"}\n", stderr)
                exit(1)
            }

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
        let _ = frequency
        startAfplayFallback(durationMs: durationMs, volume: volume)
    }

    private func stopProbeTone() {
        if let probePlayerProcess, probePlayerProcess.isRunning {
            probePlayerProcess.terminate()
        }
        probePlayerProcess = nil
    }

    @discardableResult
    private func startAfplayFallback(durationMs: Int? = nil, volume: Float) -> Bool {
        let fallback = URL(fileURLWithPath: "/System/Library/Sounds/Glass.aiff")
        guard FileManager.default.fileExists(atPath: fallback.path) else {
            return false
        }
        return startAfplay(url: fallback, volume: volume, durationMs: durationMs)
    }

    @discardableResult
    private func startAfplay(url: URL, volume: Float, durationMs: Int? = nil) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")

        var arguments = ["-v", String(volume), url.path]
        if let durationMs, durationMs > 0 {
            arguments = ["-t", String(Double(durationMs) / 1000.0)] + arguments
        }
        process.arguments = arguments

        do {
            try process.run()
            probePlayerProcess = process
            return true
        } catch {
            return false
        }
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
            let values = arguments[idx + 1]
                .split(separator: ",")
                .compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
            parsed.append(contentsOf: values)
            idx += 1
        }
        idx += 1
    }
    return Array(Set(parsed))
}

let includeSelf = CommandLine.arguments.contains("--probe-include-self")
let probeSilent = CommandLine.arguments.contains("--probe-silent")
let targetPids = parseTargetPids(arguments: CommandLine.arguments)
let cli = AudioCapCLI(includeSelf: includeSelf, targetPids: targetPids.isEmpty ? nil : targetPids)

if CommandLine.arguments.contains("--test-stopband") {
    let streamer = AudioStreamer(inputSampleRate: 96000.0)
    let sampleCount = 9600 // 100ms at 96kHz
    
    // 1. Generate 43kHz tone (stopband, amplitude 1.0, expected RMS ~0.707 at input)
    var stopbandSignal = [Float](repeating: 0, count: sampleCount)
    for i in 0..<sampleCount {
        stopbandSignal[i] = Float(sin(2.0 * Double.pi * 43000.0 * Double(i) / 96000.0))
    }
    let stopbandResampled = streamer.resampleTo48k(stopbandSignal)
    var stopbandSumSq: Double = 0.0
    for s in stopbandResampled {
        stopbandSumSq += Double(s * s)
    }
    let stopbandRms = stopbandResampled.isEmpty ? 0.0 : sqrt(stopbandSumSq / Double(stopbandResampled.count))
    
    // 2. Generate 5kHz tone (passband, amplitude 1.0, speech band)
    streamer.reset()
    var passbandSignal = [Float](repeating: 0, count: sampleCount)
    for i in 0..<sampleCount {
        passbandSignal[i] = Float(sin(2.0 * Double.pi * 5000.0 * Double(i) / 96000.0))
    }
    let passbandResampled = streamer.resampleTo48k(passbandSignal)
    var passbandSumSq: Double = 0.0
    for s in passbandResampled {
        passbandSumSq += Double(s * s)
    }
    let passbandRms = passbandResampled.isEmpty ? 0.0 : sqrt(passbandSumSq / Double(passbandResampled.count))
    
    let passed = (stopbandRms < 0.05) && (passbandRms > 0.65)
    print("{\"status\":\"\(passed ? "ok" : "fail")\",\"stopbandRms\":\(stopbandRms),\"passbandRms\":\(passbandRms)}")
    exit(passed ? 0 : 1)
} else if CommandLine.arguments.contains("--probe") {
    var durationMs = 1500
    if let idx = CommandLine.arguments.firstIndex(of: "--probe-ms"), idx + 1 < CommandLine.arguments.count {
        if let parsed = Int(CommandLine.arguments[idx + 1]) {
            durationMs = parsed
        }
    }
    cli.probe(durationMs: durationMs, emitProbeTone: !probeSilent)
} else {
    cli.start()
}
