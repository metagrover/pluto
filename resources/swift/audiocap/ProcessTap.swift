
import Foundation
import CoreAudio
import AudioToolbox
import OSLog
import AVFoundation

let kAppSubsystem = "com.metagrover.pluto.audiocap"

// Extensions to make CoreAudio easier
extension AudioObjectID {
    static var unknown: AudioObjectID { 0 }
    
    var isValid: Bool { self != .unknown }
}

extension OSStatus {
    var isNoError: Bool { self == noErr }
}

enum ProcessTapError: Error {
    case processTapCreationError(OSStatus)
    case aggregateDeviceCreationError(OSStatus)
    case deviceIOProcCreationError(OSStatus)
    case deviceStartError(OSStatus)
    case failedToCreatePCMBuffer
    case unsupportedTapFormat
}

final class ProcessTap {
    private let logger = Logger(subsystem: kAppSubsystem, category: "ProcessTap")
    
    // State
    private var processTapID: AudioObjectID = .unknown
    private var aggregateDeviceID: AudioObjectID = .unknown
    private var deviceProcID: AudioDeviceIOProcID?
    private var inputStreamID: AudioObjectID = .unknown
    private var formatListener: AudioObjectPropertyListenerBlock?
    private var formatListenerQueue: DispatchQueue?
    
    private var isActivated = false
    
    // Target Processes
    let pids: [Int32]
    private let isGlobal: Bool

    init(pids: [Int32], isGlobal: Bool = false) {
        self.pids = pids
        self.isGlobal = isGlobal
    }

    static func makeDescription(processObjectIDs: [AudioObjectID], isGlobal: Bool) -> CATapDescription {
        isGlobal
            ? CATapDescription(stereoGlobalTapButExcludeProcesses: processObjectIDs)
            : CATapDescription(stereoMixdownOfProcesses: processObjectIDs)
    }
    
    static func makeAggregateDescription(tapUUID: UUID) -> [String: Any] {
        [
            kAudioAggregateDeviceNameKey: "PlutoTap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            // Start IO immediately, including when every app is quiet.
            // Tap autostart instead waits for application playback before delivering PCM.
            kAudioAggregateDeviceTapAutoStartKey: false,
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: tapUUID.uuidString
                ]
            ]
        ]
    }

    func activate() throws {
        guard !isActivated else { return }
        isActivated = true
        
        logger.info("Activating ProcessTap for PIDs: \(self.pids)")
        
        // Global taps automatically include output processes created after recording starts.
        // Explicit PID probes keep their inclusion-only semantics.
        let processObjectIDs = try findAudioObjectIDs(for: pids)
        let tapDescription = Self.makeDescription(processObjectIDs: processObjectIDs, isGlobal: isGlobal)
        tapDescription.uuid = UUID()
        
        var tapID: AUAudioObjectID = .unknown
        var err = AudioHardwareCreateProcessTap(tapDescription, &tapID)
        guard err == noErr else { throw ProcessTapError.processTapCreationError(err) }
        self.processTapID = tapID
        
        // 2. Wrap in Aggregate Device with retry for transient bad object / device transitions
        var aggregateCreated = false
        var lastErr: OSStatus = noErr
        for attempt in 1...3 {
            let description = Self.makeAggregateDescription(tapUUID: tapDescription.uuid)
            err = AudioHardwareCreateAggregateDevice(description as CFDictionary, &self.aggregateDeviceID)
            if err == noErr {
                aggregateCreated = true
                break
            }
            lastErr = err
            if err == kAudioHardwareBadObjectError || err == 560947818 {
                logger.warning("Transient kAudioHardwareBadObjectError (\(err)) during aggregate device creation (attempt \(attempt)/3), retrying...")
                Thread.sleep(forTimeInterval: 0.1)
            } else {
                break
            }
        }

        guard aggregateCreated else {
            AudioHardwareDestroyProcessTap(tapID)
            self.processTapID = .unknown
            throw ProcessTapError.aggregateDeviceCreationError(lastErr)
        }
        
        isActivated = true
        logger.info("Tap Created. Aggregate ID: \(self.aggregateDeviceID)")
    }
    
    private func readInputFormat() throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        let status = AudioObjectGetPropertyDataSize(aggregateDeviceID, &address, 0, nil, &size)
        // The aggregate contains only our tap, so physical microphone streams cannot leak in.
        guard status == noErr, size == MemoryLayout<AudioObjectID>.size else {
            throw ProcessTapError.unsupportedTapFormat
        }
        var stream: AudioObjectID = .unknown
        guard AudioObjectGetPropertyData(aggregateDeviceID, &address, 0, nil, &size, &stream) == noErr else {
            throw ProcessTapError.unsupportedTapFormat
        }
        inputStreamID = stream
        return try Self.readVirtualFormat(stream)
    }

    private static func readVirtualFormat(_ stream: AudioObjectID) throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioStreamPropertyVirtualFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        guard AudioObjectGetPropertyData(stream, &address, 0, nil, &size, &format) == noErr,
              format.mSampleRate.isFinite, format.mSampleRate > 0,
              format.mFormatID == kAudioFormatLinearPCM,
              format.mBitsPerChannel == 32,
              format.mChannelsPerFrame > 0,
              (format.mFormatFlags & UInt32(kAudioFormatFlagIsFloat)) != 0 else {
            throw ProcessTapError.unsupportedTapFormat
        }
        return format
    }

    static func sameCaptureFormat(_ left: AudioStreamBasicDescription, _ right: AudioStreamBasicDescription) -> Bool {
        left.mSampleRate == right.mSampleRate &&
        left.mChannelsPerFrame == right.mChannelsPerFrame &&
        left.mFormatID == right.mFormatID && left.mFormatFlags == right.mFormatFlags &&
        left.mBytesPerFrame == right.mBytesPerFrame && left.mBitsPerChannel == right.mBitsPerChannel
    }

    func start(on queue: DispatchQueue, block: @escaping AudioDeviceIOBlock) throws {
        try start(on: queue, prepare: { _ in block })
    }

    func start(
        on queue: DispatchQueue,
        onFormatChange: @escaping () -> Void = {},
        prepare: (AudioStreamBasicDescription) throws -> AudioDeviceIOBlock
    ) throws {
        if !isActivated { try activate() }
        final class CallbackState {
            var block: AudioDeviceIOBlock?
        }
        let callback = CallbackState()
        // Read the IOProc's format after AudioDeviceStart; queued callbacks cannot
        // run until their converter and format-change guard have been installed.
        queue.suspend()
        defer { queue.resume() }
        var err = AudioDeviceCreateIOProcIDWithBlock(&deviceProcID, aggregateDeviceID, queue) { now, input, inputTime, output, outputTime in
            callback.block?(now, input, inputTime, output, outputTime)
        }
        guard err == noErr else { throw ProcessTapError.deviceIOProcCreationError(err) }
        do {
            err = AudioDeviceStart(aggregateDeviceID, deviceProcID)
            guard err == noErr else { throw ProcessTapError.deviceStartError(err) }
            let format = try readInputFormat()
            callback.block = try prepare(format)

            let stream = inputStreamID
            var address = AudioObjectPropertyAddress(
                mSelector: kAudioStreamPropertyVirtualFormat,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            let listener: AudioObjectPropertyListenerBlock = { _, _ in
                guard callback.block != nil else { return }
                if let current = try? Self.readVirtualFormat(stream), Self.sameCaptureFormat(format, current) { return }
                // This listener runs on the IO queue: stop stale-format PCM before
                // asking the control queue to construct a new tap generation.
                callback.block = nil
                onFormatChange()
            }
            err = AudioObjectAddPropertyListenerBlock(stream, &address, queue, listener)
            guard err == noErr else { throw ProcessTapError.unsupportedTapFormat }
            formatListener = listener
            formatListenerQueue = queue
            // Close the read/register window before queued IO can use the converter.
            guard let confirmedFormat = try? Self.readVirtualFormat(stream),
                  Self.sameCaptureFormat(format, confirmedFormat) else {
                callback.block = nil
                throw ProcessTapError.unsupportedTapFormat
            }
            logger.info("Recording Started.")
        } catch {
            callback.block = nil
            stop()
            throw error
        }
    }

    func stop() {
        if let listener = formatListener, let queue = formatListenerQueue {
            var address = AudioObjectPropertyAddress(
                mSelector: kAudioStreamPropertyVirtualFormat,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            AudioObjectRemovePropertyListenerBlock(inputStreamID, &address, queue, listener)
            formatListener = nil
            formatListenerQueue = nil
        }
        if let proc = deviceProcID {
            AudioDeviceStop(aggregateDeviceID, proc)
            AudioDeviceDestroyIOProcID(aggregateDeviceID, proc)
            deviceProcID = nil
        }
        // Destroy objects...
        if aggregateDeviceID != .unknown {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = .unknown
        }
        if processTapID != .unknown {
            AudioHardwareDestroyProcessTap(processTapID)
            processTapID = .unknown
        }
        isActivated = false
    }
    
    // Helper to find AudioObjectIDs for PIDs
    private func findAudioObjectIDs(for targetPids: [Int32]) throws -> [AudioObjectID] {
        // Get number of processes
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        var err = AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
        guard err == noErr else { return [] }
        
        let count = Int(size) / MemoryLayout<AudioObjectID>.size
        var processIDs = [AudioObjectID](repeating: 0, count: count)
        err = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &processIDs)
        guard err == noErr else { return [] }
        
        var matched: [AudioObjectID] = []
        
        for pidObj in processIDs {
            // Get PID for this AudioObjectID
            var pidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyPID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var pid: pid_t = 0
            var pidSize = UInt32(MemoryLayout<pid_t>.size)
            
            if AudioObjectGetPropertyData(pidObj, &pidAddress, 0, nil, &pidSize, &pid) == noErr {
                if targetPids.contains(pid) {
                    matched.append(pidObj)
                }
            }
        }
        return matched
    }
}
