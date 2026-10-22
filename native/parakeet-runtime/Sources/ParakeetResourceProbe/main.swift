import Darwin
import Foundation
import ParakeetRuntimeCore

private struct Sample: Encodable {
    let wallTimeMs: Int64
    let rssBytes: UInt64
    let thermal: ResourceProbeThermalState
}

private struct MemorySample: Encodable {
    let wallTimeMs: Int64
    let memoryPressureFreePercent: Int
}

private func memoryPressureFreePercent() -> Int? {
    var level: Int32 = 0
    var size = MemoryLayout<Int32>.size
    // memory_pressure's memorystatus_get_level reads this same kernel value.
    guard sysctlbyname("kern.memorystatus_level", &level, &size, nil, 0) == 0,
          size == MemoryLayout<Int32>.size,
          (0...100).contains(level) else { return nil }
    return Int(level)
}

private func argument(_ name: String) -> Int32? {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count,
          let value = Int32(arguments[index + 1]), value > 0 else { return nil }
    return value
}

private func alive(_ pid: Int32) -> Bool { kill(pid, 0) == 0 || errno == EPERM }

private func rssBytes(_ pid: Int32) -> UInt64? {
    var info = proc_taskinfo()
    let size = Int32(MemoryLayout<proc_taskinfo>.size)
    let result = proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, size)
    guard result == size else { return nil }
    return info.pti_resident_size
}

// Mutable sample state is confined to the dedicated serial timer queue.
private final class MemorySampler: @unchecked Sendable {
    private let targetPID: Int32
    private let parentPID: Int32
    private var lastWallTime: Int64 = 0

    init(targetPID: Int32, parentPID: Int32) {
        self.targetPID = targetPID
        self.parentPID = parentPID
    }

    func sample() {
        guard alive(targetPID), alive(parentPID) else { exit(0) }
        let wallTime = max(lastWallTime + 1, Int64(Date().timeIntervalSince1970 * 1_000))
        lastWallTime = wallTime
        guard let level = memoryPressureFreePercent(),
              let line = try? JSONEncoder().encode(MemorySample(wallTimeMs: wallTime, memoryPressureFreePercent: level)),
              line.count <= 512 else { exit(70) }
        FileHandle.standardOutput.write(line)
        FileHandle.standardOutput.write(Data([10]))
    }
}

let memoryOnly = CommandLine.arguments.contains("--memory-only")

guard let targetPID = argument("--pid"),
      let parentPID = argument("--parent-pid"),
      let intervalMilliseconds = argument("--interval-ms"),
      intervalMilliseconds >= (memoryOnly ? 25 : 100),
      alive(targetPID), alive(parentPID) else {
    exit(64)
}

if memoryOnly {
    let sampler = MemorySampler(targetPID: targetPID, parentPID: parentPID)
    let queue = DispatchQueue(label: "com.pluto.memory-resource-probe", qos: .userInitiated)
    let timer = DispatchSource.makeTimerSource(flags: .strict, queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(Int(intervalMilliseconds)), leeway: .nanoseconds(0))
    let sample: @Sendable () -> Void = { sampler.sample() }
    timer.setEventHandler(handler: sample)
    timer.resume()
    withExtendedLifetime(timer) { dispatchMain() }
}

var lastWallTime: Int64 = 0
while alive(targetPID) && alive(parentPID) {
    let wallTime = max(lastWallTime + 1, Int64(Date().timeIntervalSince1970 * 1_000))
    lastWallTime = wallTime
    guard let rss = rssBytes(targetPID), let thermal = ResourceProbeThermalState.current else { exit(0) }
    if let line = try? JSONEncoder().encode(Sample(wallTimeMs: wallTime, rssBytes: rss, thermal: thermal)), line.count <= 512 {
        FileHandle.standardOutput.write(line)
        FileHandle.standardOutput.write(Data([10]))
    }
    usleep(useconds_t(intervalMilliseconds) * 1_000)
}
