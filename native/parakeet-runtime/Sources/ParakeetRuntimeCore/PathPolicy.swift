import Foundation

public struct PathPolicy: Sendable {
    public enum Kind: Sendable {
        case regularFile
        case directory
    }

    private let rootPath: String

    public init(root: String) {
        self.rootPath = root
    }

    public func approve(path: String, kind: Kind) throws -> URL {
        guard path.hasPrefix("/"), rootPath.hasPrefix("/") else {
            throw RuntimeFailure.pathNotAllowed
        }

        let root = URL(fileURLWithPath: rootPath, isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        let candidate = URL(fileURLWithPath: path)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        let descendantPrefix = root.path.hasSuffix("/") ? root.path : "\(root.path)/"
        guard candidate.path.hasPrefix(descendantPrefix) else {
            throw RuntimeFailure.pathNotAllowed
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory) else {
            throw RuntimeFailure.pathMissing
        }
        switch kind {
        case .regularFile where isDirectory.boolValue:
            throw RuntimeFailure.pathNotAllowed
        case .directory where !isDirectory.boolValue:
            throw RuntimeFailure.pathNotAllowed
        default:
            return candidate
        }
    }
}
