
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

extension AudioDeviceID {
    static func readDefaultSystemOutputDevice() throws -> AudioDeviceID {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioDeviceID()
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let err = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID)
        guard err == noErr else { throw ProcessTapError.failedToGetDefaultOutputDevice(err) }
        return deviceID
    }
    
    func readDeviceUID() throws -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uid: CFString? = nil
        var size = UInt32(MemoryLayout<CFString?>.size)
        // Pass address of the optional CFString
        let err = withUnsafeMutablePointer(to: &uid) { ptr in
            AudioObjectGetPropertyData(self, &address, 0, nil, &size, ptr)
        }
        guard err == noErr, let actualUid = uid else { throw ProcessTapError.failedToGetDeviceUID(err) }
        return actualUid as String
    }
}

extension AudioObjectID {
    func readAudioTapStreamBasicDescription() throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var desc = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let err = AudioObjectGetPropertyData(self, &address, 0, nil, &size, &desc)
        guard err == noErr else { throw ProcessTapError.failedToGetTapDescription(err) }
        return desc
    }
}

enum ProcessTapError: Error {
    case failedToGetDefaultOutputDevice(OSStatus)
    case failedToGetDeviceUID(OSStatus)
    case failedToGetTapDescription(OSStatus)
    case processTapCreationError(OSStatus)
    case aggregateDeviceCreationError(OSStatus)
    case deviceIOProcCreationError(OSStatus)
    case deviceStartError(OSStatus)
    case tapStreamDescriptionUnavailable
    case failedToCreatePCMBuffer
}

final class ProcessTap {
    private let logger = Logger(subsystem: kAppSubsystem, category: "ProcessTap")
    
    // State
    private var processTapID: AudioObjectID = .unknown
    private var aggregateDeviceID: AudioObjectID = .unknown
    private var deviceProcID: AudioDeviceIOProcID?
    private(set) var tapStreamDescription: AudioStreamBasicDescription?
    
    private var isActivated = false
    
    // Target Processes
    let pids: [Int32]
    
    init(pids: [Int32]) {
        self.pids = pids
    }
    
    func activate() throws {
        guard !isActivated else { return }
        isActivated = true
        
        logger.info("Activating ProcessTap for PIDs: \(self.pids)")
        
        // 1. Create Process Tap
        // We map Int32 PIDs to AudioProcessID (which is implicitly generic, usually pid_t is compatible)
        // Verify CATapDescription API expects `[ProcessID]`?
        // Actually, in the newer SDK, `CATapDescription` takes `[AUAudioObjectID]` which wraps PIDs?
        // Wait, the fetched code was `CATapDescription(stereoMixdownOfProcesses: [objectID])`.
        // `objectID` there was `AudioObjectID`.
        // So we need to convert PIDs to AudioObjectIDs?
        // Or does `CATapDescription` accept PIDs directly in a different init?
        // The header says `init(stereoMixdownOfProcesses processes: [AudioObjectID])`.
        //
        // NOTE: We need to find the `AudioObjectID` for a given PID.
        // There isn't a direct "Get AudioObjectID from PID" API commonly exposed without iterating `kAudioHardwarePropertyProcessObjectList`.
        //
        // However, for Simplicity in this CLI, we might just filter *later* or tap *everything*.
        // But `CATapDescription` requires explicit processes.
        //
        // Workaround: We will implement a helper to find AudioObjectID for a PID.
        
        let processObjectIDs = try findAudioObjectIDs(for: pids)
        if processObjectIDs.isEmpty {
            logger.warning("No matching AudioObjects found for PIDs: \(self.pids)")
        }
        
        let tapDescription = CATapDescription(stereoMixdownOfProcesses: processObjectIDs)
        tapDescription.uuid = UUID()
        
        var tapID: AUAudioObjectID = .unknown
        var err = AudioHardwareCreateProcessTap(tapDescription, &tapID)
        guard err == noErr else { throw ProcessTapError.processTapCreationError(err) }
        self.processTapID = tapID
        
        // 2. Wrap in Aggregate Device
        let systemOutputID = try AudioDeviceID.readDefaultSystemOutputDevice()
        let outputUID = try systemOutputID.readDeviceUID()
        let aggregateUID = UUID().uuidString
        
        let description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "PlutoTap",
            kAudioAggregateDeviceUIDKey: aggregateUID,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [
                [ kAudioSubDeviceUIDKey: outputUID ]
            ],
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: tapDescription.uuid.uuidString
                ]
            ]
        ]
        
        self.tapStreamDescription = try tapID.readAudioTapStreamBasicDescription()
        
        err = AudioHardwareCreateAggregateDevice(description as CFDictionary, &self.aggregateDeviceID)
        guard err == noErr else { throw ProcessTapError.aggregateDeviceCreationError(err) }
        
        logger.info("Tap Created. Aggregate ID: \(self.aggregateDeviceID)")
    }
    
    func start(on queue: DispatchQueue, block: @escaping AudioDeviceIOBlock) throws {
        if !isActivated { try activate() }
        
        var err = AudioDeviceCreateIOProcIDWithBlock(&deviceProcID, aggregateDeviceID, queue, block)
        guard err == noErr else { throw ProcessTapError.deviceIOProcCreationError(err) }
        
        err = AudioDeviceStart(aggregateDeviceID, deviceProcID)
        guard err == noErr else { throw ProcessTapError.deviceStartError(err) }
        
        logger.info("Recording Started.")
    }
    
    func stop() {
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
