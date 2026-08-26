import Foundation

public protocol ModelInstalling: Sendable {
    func install(
        manifest: ModelManifest,
        into stagingDirectory: URL,
        progressHandler: ModelPreparationProgressHandler?
    ) async throws
}

public actor ModelStore {
    private struct Activation: Codable {
        let version: String
    }

    private let root: URL
    private let installer: any ModelInstalling
    private let fileManager: FileManager

    public init(
        root: URL,
        installer: any ModelInstalling,
        fileManager: FileManager = .default
    ) {
        self.root = root.standardizedFileURL
        self.installer = installer
        self.fileManager = fileManager
    }

    public func prepare(
        manifest: ModelManifest,
        progressHandler: ModelPreparationProgressHandler? = nil
    ) async throws -> URL {
        guard isSafeComponent(manifest.version) else {
            throw RuntimeFailure.modelPreparationFailed
        }

        if try activeVersion() == manifest.version {
            let active = versionDirectory(for: manifest.version)
            if fileManager.fileExists(atPath: active.path) { return active }
        }

        let versions = root.appendingPathComponent("versions", isDirectory: true)
        let stagingRoot = root.appendingPathComponent("staging", isDirectory: true)
        let staging = stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let destination = versionDirectory(for: manifest.version)

        do {
            try fileManager.createDirectory(at: versions, withIntermediateDirectories: true)
            try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
            try await installer.install(
                manifest: manifest,
                into: staging,
                progressHandler: progressHandler
            )
            guard directoryContainsFiles(staging) else {
                throw RuntimeFailure.modelPreparationFailed
            }
            if !fileManager.fileExists(atPath: destination.path) {
                try fileManager.moveItem(at: staging, to: destination)
            }
            try writeActivation(version: manifest.version)
            try? removeEmptyStagingRoot(stagingRoot)
            return destination
        } catch {
            try? fileManager.removeItem(at: staging)
            try? removeEmptyStagingRoot(stagingRoot)
            throw RuntimeFailure.modelPreparationFailed
        }
    }

    public func activeVersion() throws -> String? {
        let state = root.appendingPathComponent("active.json")
        guard fileManager.fileExists(atPath: state.path) else { return nil }
        do {
            return try JSONDecoder().decode(Activation.self, from: Data(contentsOf: state)).version
        } catch {
            throw RuntimeFailure.modelPreparationFailed
        }
    }

    private func versionDirectory(for version: String) -> URL {
        root.appendingPathComponent("versions", isDirectory: true)
            .appendingPathComponent(version, isDirectory: true)
    }

    private func writeActivation(version: String) throws {
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(Activation(version: version))
        try data.write(to: root.appendingPathComponent("active.json"), options: .atomic)
    }

    private func directoryContainsFiles(_ directory: URL) -> Bool {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        ) else { return false }
        return !contents.isEmpty
    }

    private func removeEmptyStagingRoot(_ stagingRoot: URL) throws {
        guard fileManager.fileExists(atPath: stagingRoot.path) else { return }
        if try fileManager.contentsOfDirectory(atPath: stagingRoot.path).isEmpty {
            try fileManager.removeItem(at: stagingRoot)
        }
    }

    private func isSafeComponent(_ value: String) -> Bool {
        !value.isEmpty && value != "." && value != ".." &&
            !value.contains("/") && !value.contains("\\")
    }
}
