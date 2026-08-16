import Darwin
import Foundation
import ParakeetRuntimeCore

private struct Sample: Encodable {
    let wallTimeMs: Int64
    let rssBytes: UInt64
    let thermal: ResourceProbeThermalState
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

guard let targetPID = argument("--pid"),
      let parentPID = argument("--parent-pid"),
      let intervalMilliseconds = argument("--interval-ms"),
      intervalMilliseconds >= 100,
      alive(targetPID), alive(parentPID) else {
    exit(64)
}

var lastWallTime: Int64 = 0
while alive(targetPID) && alive(parentPID) {
    guard let rss = rssBytes(targetPID), let thermal = ResourceProbeThermalState.current else { exit(0) }
    let wallTime = max(lastWallTime + 1, Int64(Date().timeIntervalSince1970 * 1_000))
    lastWallTime = wallTime
    if let line = try? JSONEncoder().encode(Sample(wallTimeMs: wallTime, rssBytes: rss, thermal: thermal)), line.count <= 512 {
        FileHandle.standardOutput.write(line)
        FileHandle.standardOutput.write(Data([10]))
    }
    usleep(useconds_t(intervalMilliseconds) * 1_000)
}
