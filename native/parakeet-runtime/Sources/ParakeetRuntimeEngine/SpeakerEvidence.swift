import AVFoundation
@preconcurrency import FluidAudio
import Foundation
import ParakeetRuntimeCore

// Access is serialized by FluidAudioOfflineDiarizer. FluidAudio already treats its
// loaded Core ML models as read-only after initialization.
extension OfflineDiarizerManager: @retroactive @unchecked Sendable {}

public protocol OfflineSpeakerDiarizing: Sendable {
    func diarize(audioURL: URL) async throws -> [SpeakerEvidenceTurn]
}

public protocol SpeakerEvidenceDriving: Sendable {
    func analyze(
        mixedURL: URL,
        micURL: URL,
        systemURL: URL
    ) async throws -> SpeakerEvidenceOutput
}

public struct SpeakerEvidenceCoordinator: SpeakerEvidenceDriving, Sendable {
    private let diarizer: any OfflineSpeakerDiarizing
    private let energyAnalyzer: any SpeakerEnergyAnalyzing
    private let manifest: DiarizationModelManifest
    private let runtimeVersion: String

    public init(
        diarizer: any OfflineSpeakerDiarizing,
        energyAnalyzer: any SpeakerEnergyAnalyzing,
        manifest: DiarizationModelManifest,
        runtimeVersion: String
    ) {
        self.diarizer = diarizer
        self.energyAnalyzer = energyAnalyzer
        self.manifest = manifest
        self.runtimeVersion = runtimeVersion
    }

    public func analyze(
        mixedURL: URL,
        micURL: URL,
        systemURL: URL
    ) async throws -> SpeakerEvidenceOutput {
        let totalStart = ContinuousClock.now
        let diarizationStart = ContinuousClock.now
        let turns = try await diarizer.diarize(audioURL: mixedURL)
        let diarizationMs = elapsedMilliseconds(since: diarizationStart)
        try Task.checkCancellation()
        guard !turns.isEmpty else { throw RuntimeFailure.diarizationFailed }

        let energyStart = ContinuousClock.now
        let windows = try await energyAnalyzer.analyze(micURL: micURL, systemURL: systemURL)
        let energyMs = elapsedMilliseconds(since: energyStart)
        try Task.checkCancellation()
        guard !windows.isEmpty else { throw RuntimeFailure.audioAnalysisFailed }

        return SpeakerEvidenceOutput(
            turns: turns,
            energyWindows: windows,
            provenance: SpeakerEvidenceProvenance(
                modelIdentifier: manifest.identifier,
                modelRevision: manifest.revision,
                artifactDigest: manifest.artifactSHA256,
                runtimeVersion: runtimeVersion
            ),
            timings: SpeakerEvidenceTimings(
                diarizationMs: diarizationMs,
                energyAnalysisMs: energyMs,
                totalMs: elapsedMilliseconds(since: totalStart)
            ),
            windowSeconds: 0.1
        )
    }

    private func elapsedMilliseconds(since start: ContinuousClock.Instant) -> Int {
        let duration = start.duration(to: .now)
        return max(0, Int(duration.components.seconds * 1_000)
            + Int(duration.components.attoseconds / 1_000_000_000_000_000))
    }
}

public actor FluidAudioOfflineDiarizer: OfflineSpeakerDiarizing {
    private let modelsRoot: URL
    private let manifest: DiarizationModelManifest
    private let manager: OfflineDiarizerManager
    private var prepared = false

    public init(
        modelsRoot: URL,
        manifest: DiarizationModelManifest = ProductionDiarizationManifest.current,
        manager: OfflineDiarizerManager = OfflineDiarizerManager()
    ) {
        self.modelsRoot = modelsRoot.standardizedFileURL
        self.manifest = manifest
        self.manager = manager
    }

    public func diarize(audioURL: URL) async throws -> [SpeakerEvidenceTurn] {
        do {
            if !prepared {
                ModelRegistry.setPinnedRevision(manifest.revision, for: manifest.repository)
                defer { ModelRegistry.setPinnedRevision(nil, for: manifest.repository) }
                try await manager.prepareModels(directory: modelsRoot)
                try verifyInstalledModels()
                prepared = true
            }
            try Task.checkCancellation()
            let result = try await manager.process(audioURL)
            try Task.checkCancellation()
            let turns = result.segments.compactMap { segment -> SpeakerEvidenceTurn? in
                let start = Double(segment.startTimeSeconds)
                let end = Double(segment.endTimeSeconds)
                guard start.isFinite, end.isFinite, start >= 0, end > start,
                    !segment.speakerId.isEmpty
                else { return nil }
                return SpeakerEvidenceTurn(
                    startTime: start,
                    endTime: end,
                    cluster: segment.speakerId
                )
            }
            guard !turns.isEmpty else { throw RuntimeFailure.diarizationFailed }
            return turns.sorted { left, right in
                left.startTime == right.startTime
                    ? left.endTime < right.endTime
                    : left.startTime < right.startTime
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let failure as RuntimeFailure {
            throw failure
        } catch {
            throw RuntimeFailure.diarizationFailed
        }
    }

    private func verifyInstalledModels() throws {
        let repositoryDirectory = modelsRoot.appendingPathComponent(
            Repo.diarizer.folderName,
            isDirectory: true
        )
        let manager = FileManager.default
        for artifact in manifest.requiredArtifacts {
            var isDirectory: ObjCBool = false
            let path = repositoryDirectory.appendingPathComponent(artifact).path
            guard manager.fileExists(atPath: path, isDirectory: &isDirectory),
                artifact.hasSuffix(".mlmodelc") ? isDirectory.boolValue : !isDirectory.boolValue
            else { throw RuntimeFailure.modelPreparationFailed }
        }
        try ModelArtifactIntegrity.verify(
            directory: repositoryDirectory,
            expectedSHA256: manifest.artifactSHA256
        )
    }
}

public protocol SpeakerEnergyAnalyzing: Sendable {
    func analyze(micURL: URL, systemURL: URL) async throws -> [SpeakerEnergyWindow]
}

public struct SpeakerEnergyAnalyzer: SpeakerEnergyAnalyzing, Sendable {
    public let windowSeconds: Double

    public init(windowSeconds: Double = 0.1) {
        precondition(windowSeconds > 0 && windowSeconds.isFinite)
        self.windowSeconds = windowSeconds
    }

    public func analyze(micURL: URL, systemURL: URL) async throws -> [SpeakerEnergyWindow] {
        try Task.checkCancellation()
        let mic = try readWindows(from: micURL)
        try Task.checkCancellation()
        let system = try readWindows(from: systemURL)
        try Task.checkCancellation()

        let count = max(mic.count, system.count)
        return (0..<count).map { index in
            let start = Double(index) * windowSeconds
            let end = max(
                mic.indices.contains(index) ? mic[index].endTime : start,
                system.indices.contains(index) ? system[index].endTime : start
            )
            return SpeakerEnergyWindow(
                startTime: start,
                endTime: end,
                micRms: mic.indices.contains(index) ? mic[index].rms : 0,
                systemRms: system.indices.contains(index) ? system[index].rms : 0
            )
        }
    }

    private struct RmsWindow {
        let endTime: Double
        let rms: Double
    }

    private func readWindows(from url: URL) throws -> [RmsWindow] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else {
            throw RuntimeFailure.audioAnalysisFailed
        }
        let framesPerWindow = max(
            1,
            AVAudioFrameCount((format.sampleRate * windowSeconds).rounded())
        )
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: framesPerWindow
        ) else {
            throw RuntimeFailure.audioAnalysisFailed
        }

        var result: [RmsWindow] = []
        var framesRead: AVAudioFramePosition = 0
        while file.framePosition < file.length {
            try Task.checkCancellation()
            buffer.frameLength = 0
            try file.read(into: buffer, frameCount: framesPerWindow)
            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0, let channels = buffer.floatChannelData else { break }

            var sumSquares = 0.0
            for channelIndex in 0..<Int(format.channelCount) {
                let channel = channels[channelIndex]
                for frameIndex in 0..<frameLength {
                    let sample = Double(channel[frameIndex])
                    sumSquares += sample * sample
                }
            }
            let sampleCount = frameLength * Int(format.channelCount)
            framesRead += AVAudioFramePosition(frameLength)
            let endTime = Double(framesRead) / format.sampleRate
            let rms = sampleCount > 0 ? sqrt(sumSquares / Double(sampleCount)) : 0
            guard rms.isFinite, rms >= 0, endTime.isFinite else {
                throw RuntimeFailure.audioAnalysisFailed
            }
            result.append(RmsWindow(endTime: endTime, rms: rms))
        }
        return result
    }
}
