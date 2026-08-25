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

    public static func digest(directory: URL) throws -> String {
        let manager = FileManager.default
        let canonicalDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
        guard
            let enumerator = manager.enumerator(
                at: canonicalDirectory,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
                options: []
            )
        else { throw RuntimeFailure.modelPreparationFailed }
        let files = try enumerator.compactMap { entry -> URL? in
            guard let url = entry as? URL else { return nil }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            if values.isSymbolicLink == true { throw RuntimeFailure.modelPreparationFailed }
            return values.isRegularFile == true ? url : nil
        }.sorted { left, right in
            relativePath(of: left, within: canonicalDirectory)
                < relativePath(of: right, within: canonicalDirectory)
        }
        guard !files.isEmpty else { throw RuntimeFailure.modelPreparationFailed }

        var aggregate = SHA256()
        for file in files {
            let relative = relativePath(of: file, within: canonicalDirectory)
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
