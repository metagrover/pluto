import CryptoKit
import Foundation
import ParakeetRuntimeCore

public enum ModelArtifactIntegrity {
    public static func verify(directory: URL, expectedSHA256: String) throws {
        guard
            expectedSHA256.count == 64,
            expectedSHA256.allSatisfy({ $0.isHexDigit }),
            try digest(directory: directory) == expectedSHA256.lowercased()
        else { throw RuntimeFailure.modelPreparationFailed }
    }

    public static func verify(
        directory: URL,
        requiredArtifacts: [String],
        expectedSHA256: String
    ) throws {
        guard
            expectedSHA256.count == 64,
            expectedSHA256.allSatisfy({ $0.isHexDigit }),
            try digest(directory: directory, requiredArtifacts: requiredArtifacts)
                == expectedSHA256.lowercased()
        else { throw RuntimeFailure.modelPreparationFailed }
    }

    public static func digest(directory: URL) throws -> String {
        let canonicalDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
        return try aggregateDigest(
            files: regularFiles(at: canonicalDirectory, within: canonicalDirectory),
            within: canonicalDirectory
        )
    }

    public static func digest(directory: URL, requiredArtifacts: [String]) throws -> String {
        let canonicalDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
        guard !requiredArtifacts.isEmpty,
            Set(requiredArtifacts).count == requiredArtifacts.count
        else { throw RuntimeFailure.modelPreparationFailed }

        var filesByPath: [String: URL] = [:]
        for artifact in requiredArtifacts {
            let components = artifact.split(separator: "/", omittingEmptySubsequences: false)
            guard !artifact.hasPrefix("/"),
                !components.isEmpty,
                components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
            else { throw RuntimeFailure.modelPreparationFailed }
            let artifactURL = canonicalDirectory.appendingPathComponent(artifact)
            let values = try artifactURL.resourceValues(forKeys: [
                .isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey,
            ])
            guard values.isSymbolicLink != true else {
                throw RuntimeFailure.modelPreparationFailed
            }
            let artifactFiles: [URL]
            if values.isRegularFile == true {
                artifactFiles = [artifactURL]
            } else if values.isDirectory == true {
                artifactFiles = try regularFiles(at: artifactURL, within: canonicalDirectory)
            } else {
                throw RuntimeFailure.modelPreparationFailed
            }
            for file in artifactFiles {
                filesByPath[relativePath(of: file, within: canonicalDirectory)] = file
            }
        }
        return try aggregateDigest(
            files: Array(filesByPath.values),
            within: canonicalDirectory
        )
    }

    private static func regularFiles(at root: URL, within canonicalDirectory: URL) throws -> [URL] {
        let manager = FileManager.default
        guard
            let enumerator = manager.enumerator(
                at: root,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
                options: []
            )
        else { throw RuntimeFailure.modelPreparationFailed }
        return try enumerator.compactMap { entry -> URL? in
            guard let url = entry as? URL else { return nil }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            if values.isSymbolicLink == true { throw RuntimeFailure.modelPreparationFailed }
            guard values.isRegularFile == true else { return nil }
            let canonicalURL = url.resolvingSymlinksInPath().standardizedFileURL
            guard canonicalURL.path.hasPrefix(canonicalDirectory.path + "/") else {
                throw RuntimeFailure.modelPreparationFailed
            }
            return canonicalURL
        }
    }

    private static func aggregateDigest(files: [URL], within directory: URL) throws -> String {
        let files = files.sorted { left, right in
            relativePath(of: left, within: directory)
                < relativePath(of: right, within: directory)
        }
        guard !files.isEmpty else { throw RuntimeFailure.modelPreparationFailed }

        var aggregate = SHA256()
        for file in files {
            let relative = relativePath(of: file, within: directory)
            aggregate.update(data: Data(relative.utf8))
            aggregate.update(data: Data([0]))
            aggregate.update(data: Data(try fileDigest(file).utf8))
            aggregate.update(data: Data([10]))
        }
        return aggregate.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func relativePath(of file: URL, within directory: URL) -> String {
        String(file.path.dropFirst(directory.path.count + 1))
    }

    private static func fileDigest(_ file: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
