import Foundation

public enum ResourceProbeThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical

    public init?(processThermalRawValue: Int) {
        switch processThermalRawValue {
        case 0: self = .nominal
        case 1: self = .fair
        case 2: self = .serious
        case 3: self = .critical
        default: return nil
        }
    }

    public static var current: Self? {
        Self(processThermalRawValue: ProcessInfo.processInfo.thermalState.rawValue)
    }
}
