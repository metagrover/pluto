#if os(macOS)
import AVFoundation
import FluidAudio
import Foundation

enum AMIKaldiData {
    private static let logger = AppLogger(category: "AMIKaldiData")
    private static let requiredKaldiFiles = [
        "wav.scp", "segments", "utt2spk", "spk2utt", "reco2dur", "reco2num_spk", "utt2timestamp",
    ]
    private static let sampleRate = 8_000.0
    private static let frameShiftSamples = 80.0
    private static let defaultFrameStep = frameShiftSamples / sampleRate

    struct SegmentEntry {
        let utteranceId: String
        let recordingId: String
        let speakerId: String
        let startTime: Double
        let endTime: Double
    }

    enum Error: LocalizedError {
        case annotationsNotFound
        case missingAudio(String)
        case missingReference(String)
        case invalidKaldiData(String)

        var errorDescription: String? {
            switch self {
            case .annotationsNotFound:
                return "AMI annotations were not found. Expected Datasets/ami_public_1.6.2."
            case .missingAudio(let meetingId):
                return "AMI Kaldi data has no audio entry for \(meetingId)."
            case .missingReference(let meetingId):
                return "AMI Kaldi data has no reference segments for \(meetingId)."
            case .invalidKaldiData(let message):
                return message
            }
        }
    }

    static func splitDirectory(
        split: DiarizationBenchmarkUtils.AMISplit,
        workingDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) -> URL {
        datasetsRoot(workingDirectory: workingDirectory)
            .appendingPathComponent("ami/mhs/data/\(split.rawValue)", isDirectory: true)
    }

    static func splitExists(
        split: DiarizationBenchmarkUtils.AMISplit,
        workingDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        fileManager: FileManager = .default
    ) -> Bool {
        splitExists(
            splitDirectory: splitDirectory(split: split, workingDirectory: workingDirectory), fileManager: fileManager)
    }

    static func ensureSplitExists(
        split: DiarizationBenchmarkUtils.AMISplit,
        force: Bool = false,
        workingDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
        fileManager: FileManager = .default
    ) throws {
        let outputDirectory = splitDirectory(split: split, workingDirectory: workingDirectory)
        if !force && splitExists(splitDirectory: outputDirectory, fileManager: fileManager) {
            return
        }

        guard
            let annotationsRoot = findAnnotationsRoot(
                workingDirectory: workingDirectory,
                fileManager: fileManager
            )
        else {
            throw Error.annotationsNotFound
        }

        try buildSplit(
            split: split,
            annotationsRoot: annotationsRoot,
            audioRoot: homeDirectory.appendingPathComponent("FluidAudioDatasets/ami_official/sdm", isDirectory: true),
            outputDirectory: outputDirectory,
            fileManager: fileManager
        )
    }

    static func buildSplit(
        split: DiarizationBenchmarkUtils.AMISplit,
        annotationsRoot: URL,
        audioRoot: URL,
        outputDirectory: URL,
        fileManager: FileManager = .default
    ) throws {
        try buildSplit(
            meetingIds: DiarizationBenchmarkUtils.getAMIMeetings(split: split),
            annotationsRoot: annotationsRoot,
            audioRoot: audioRoot,
            outputDirectory: outputDirectory,
            fileManager: fileManager
        )
    }

    static func buildSplit(
        meetingIds: [String],
        annotationsRoot: URL,
        audioRoot: URL,
        outputDirectory: URL,
        fileManager: FileManager = .default
    ) throws {
        let parser = AMIAnnotationParser()
        let meetingsFile = annotationsRoot.appendingPathComponent("corpusResources/meetings.xml")
        let segmentsDirectory = annotationsRoot.appendingPathComponent("segments", isDirectory: true)

        try fileManager.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

        var wavLines: [String] = []
        var segmentLines: [String] = []
        var utt2spkLines: [String] = []
        var utt2timestampLines: [String] = []
        var reco2durLines: [String] = []
        var reco2numSpkLines: [String] = []
        var spkToUtterances: [String: [String]] = [:]
        var generatedMeetings = 0

        for meetingId in meetingIds.sorted() {
            let audioURL = audioRoot.appendingPathComponent("\(meetingId).Mix-Headset.wav")
            guard fileManager.fileExists(atPath: audioURL.path) else {
                logger.warning("Skipping \(meetingId): audio not found at \(audioURL.path)")
                continue
            }

            guard
                let mapping = try parser.parseSpeakerMapping(
                    for: meetingId,
                    from: meetingsFile
                )
            else {
                logger.warning("Skipping \(meetingId): no AMI speaker mapping found")
                continue
            }

            let segments = try loadSegments(
                for: meetingId,
                mapping: mapping,
                parser: parser,
                segmentsDirectory: segmentsDirectory,
                fileManager: fileManager
            )

            guard !segments.isEmpty else {
                logger.warning("Skipping \(meetingId): no AMI segments found")
                continue
            }

            let duration = try audioDuration(for: audioURL)
            let speakers = Array(Set(segments.map(\.speakerId))).sorted()

            wavLines.append("\(meetingId) \(audioURL.path)")
            reco2durLines.append("\(meetingId) \(formatSeconds(duration))")
            reco2numSpkLines.append("\(meetingId) \(speakers.count)")

            for segment in segments {
                segmentLines.append(
                    "\(segment.utteranceId) \(segment.recordingId) \(formatSeconds(segment.startTime)) \(formatSeconds(segment.endTime))"
                )
                utt2spkLines.append("\(segment.utteranceId) \(segment.speakerId)")
                utt2timestampLines.append(
                    "\(segment.utteranceId) \(formatSeconds(segment.startTime)) \(formatSeconds(segment.endTime))"
                )
                spkToUtterances[segment.speakerId, default: []].append(segment.utteranceId)
            }

            generatedMeetings += 1
        }

        guard generatedMeetings > 0 else {
            throw Error.invalidKaldiData("Failed to build AMI Kaldi data: no meetings had both audio and annotations.")
        }

        let spk2uttLines = spkToUtterances.keys.sorted().map { speakerId in
            let utterances = spkToUtterances[speakerId, default: []].sorted()
            return ([speakerId] + utterances).joined(separator: " ")
        }

        try write(lines: wavLines.sorted(), to: outputDirectory.appendingPathComponent("wav.scp"))
        try write(lines: segmentLines.sorted(), to: outputDirectory.appendingPathComponent("segments"))
        try write(lines: utt2spkLines.sorted(), to: outputDirectory.appendingPathComponent("utt2spk"))
        try write(lines: spk2uttLines, to: outputDirectory.appendingPathComponent("spk2utt"))
        try write(lines: reco2durLines.sorted(), to: outputDirectory.appendingPathComponent("reco2dur"))
        try write(lines: reco2numSpkLines.sorted(), to: outputDirectory.appendingPathComponent("reco2num_spk"))
        try write(lines: utt2timestampLines.sorted(), to: outputDirectory.appendingPathComponent("utt2timestamp"))
    }

    static func recordingIDs(
        in splitDirectory: URL,
        maxFiles: Int? = nil
    ) throws -> [String] {
        let recordings = try wavEntries(in: splitDirectory).keys.sorted()
        guard let maxFiles else { return recordings }
        return Array(recordings.prefix(maxFiles))
    }

    static func audioPath(for meetingId: String, in splitDirectory: URL) throws -> String? {
        try wavEntries(in: splitDirectory)[meetingId]
    }

    static func recordingDuration(for meetingId: String, in splitDirectory: URL) throws -> Double? {
        try durationEntries(in: splitDirectory)[meetingId]
    }

    static func loadDERReference(
        for meetingId: String,
        in splitDirectory: URL,
        frameStep: Double = defaultFrameStep
    ) throws -> [DERSpeakerSegment] {
        let segments = try segmentEntries(in: splitDirectory)
            .filter { $0.recordingId == meetingId }

        guard !segments.isEmpty else {
            throw Error.missingReference(meetingId)
        }

        var intervalsBySpeaker: [String: [(startFrame: Int, endFrame: Int)]] = [:]
        for segment in segments {
            let startFrame = Int((segment.startTime / frameStep).rounded(.toNearestOrEven))
            let endFrame = Int((segment.endTime / frameStep).rounded(.toNearestOrEven))
            guard endFrame > startFrame else { continue }
            intervalsBySpeaker[segment.speakerId, default: []].append((startFrame, endFrame))
        }

        var references: [DERSpeakerSegment] = []
        for (speaker, intervals) in intervalsBySpeaker {
            let sortedIntervals = intervals.sorted {
                if $0.startFrame == $1.startFrame {
                    return $0.endFrame < $1.endFrame
                }
                return $0.startFrame < $1.startFrame
            }
            guard var current = sortedIntervals.first else { continue }

            for next in sortedIntervals.dropFirst() {
                if next.startFrame <= current.endFrame {
                    current.endFrame = max(current.endFrame, next.endFrame)
                    continue
                }

                references.append(
                    DERSpeakerSegment(
                        speaker: speaker,
                        start: Double(current.startFrame) * frameStep,
                        end: Double(current.endFrame) * frameStep
                    )
                )
                current = next
            }

            references.append(
                DERSpeakerSegment(
                    speaker: speaker,
                    start: Double(current.startFrame) * frameStep,
                    end: Double(current.endFrame) * frameStep
                )
            )
        }

        return references.sorted {
            if $0.start == $1.start {
                if $0.end == $1.end {
                    return $0.speaker < $1.speaker
                }
                return $0.end < $1.end
            }
            return $0.start < $1.start
        }
    }

    private static func splitExists(
        splitDirectory: URL,
        fileManager: FileManager
    ) -> Bool {
        requiredKaldiFiles.allSatisfy {
            fileManager.fileExists(atPath: splitDirectory.appendingPathComponent($0).path)
        }
    }

    private static func repositoryRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private static func datasetsRoot(
        workingDirectory: URL,
        fileManager: FileManager = .default
    ) -> URL {
        let workingDatasets = workingDirectory.appendingPathComponent("Datasets", isDirectory: true)
        if fileManager.fileExists(atPath: workingDatasets.path) {
            return workingDatasets
        }
        return repositoryRoot().appendingPathComponent("Datasets", isDirectory: true)
    }

    private static func findAnnotationsRoot(
        workingDirectory: URL,
        fileManager: FileManager
    ) -> URL? {
        let candidates = [
            datasetsRoot(workingDirectory: workingDirectory, fileManager: fileManager)
                .appendingPathComponent("ami_public_1.6.2", isDirectory: true),
            repositoryRoot().appendingPathComponent("Datasets/ami_public_1.6.2", isDirectory: true),
        ]

        for candidate in candidates {
            let segmentsDir = candidate.appendingPathComponent("segments", isDirectory: true)
            let meetingsFile = candidate.appendingPathComponent("corpusResources/meetings.xml")
            guard fileManager.fileExists(atPath: segmentsDir.path) else { continue }
            guard fileManager.fileExists(atPath: meetingsFile.path) else { continue }
            return candidate
        }

        return nil
    }

    private static func loadSegments(
        for meetingId: String,
        mapping: AMISpeakerMapping,
        parser: AMIAnnotationParser,
        segmentsDirectory: URL,
        fileManager: FileManager
    ) throws -> [SegmentEntry] {
        var segments: [SegmentEntry] = []

        for speakerCode in ["A", "B", "C", "D"] {
            let fileURL = segmentsDirectory.appendingPathComponent("\(meetingId).\(speakerCode).segments.xml")
            guard fileManager.fileExists(atPath: fileURL.path) else { continue }
            guard let participantId = mapping.participantId(for: speakerCode) else { continue }

            let parsedSegments = try parser.parseSegmentsFile(fileURL)
            for (index, segment) in parsedSegments.enumerated() where segment.duration > 0 {
                segments.append(
                    SegmentEntry(
                        utteranceId: utteranceId(meetingId: meetingId, speakerCode: speakerCode, ordinal: index + 1),
                        recordingId: meetingId,
                        speakerId: participantId,
                        startTime: segment.startTime,
                        endTime: segment.endTime
                    )
                )
            }
        }

        return segments.sorted {
            if $0.recordingId == $1.recordingId {
                if $0.startTime == $1.startTime {
                    if $0.endTime == $1.endTime {
                        return $0.utteranceId < $1.utteranceId
                    }
                    return $0.endTime < $1.endTime
                }
                return $0.startTime < $1.startTime
            }
            return $0.recordingId < $1.recordingId
        }
    }

    private static func utteranceId(meetingId: String, speakerCode: String, ordinal: Int) -> String {
        "\(meetingId)_\(speakerCode.lowercased())_\(String(format: "%05d", ordinal))"
    }

    private static func audioDuration(for audioURL: URL) throws -> Double {
        let audioFile = try AVAudioFile(forReading: audioURL)
        return Double(audioFile.length) / audioFile.processingFormat.sampleRate
    }

    private static func write(lines: [String], to fileURL: URL) throws {
        let contents = lines.joined(separator: "\n") + "\n"
        try contents.write(to: fileURL, atomically: true, encoding: .utf8)
    }

    private static func wavEntries(in splitDirectory: URL) throws -> [String: String] {
        try parseKeyValueFile(splitDirectory.appendingPathComponent("wav.scp"))
    }

    private static func durationEntries(in splitDirectory: URL) throws -> [String: Double] {
        let lines = try String(contentsOf: splitDirectory.appendingPathComponent("reco2dur"), encoding: .utf8)
            .split(whereSeparator: \.isNewline)
        var result: [String: Double] = [:]
        for line in lines {
            let parts = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
            guard parts.count == 2, let value = Double(parts[1]) else {
                throw Error.invalidKaldiData("Invalid reco2dur line: \(line)")
            }
            result[String(parts[0])] = value
        }
        return result
    }

    private static func segmentEntries(in splitDirectory: URL) throws -> [SegmentEntry] {
        let utt2spk = try parseKeyValueFile(splitDirectory.appendingPathComponent("utt2spk"))
        let lines = try String(contentsOf: splitDirectory.appendingPathComponent("segments"), encoding: .utf8)
            .split(whereSeparator: \.isNewline)

        var entries: [SegmentEntry] = []
        entries.reserveCapacity(lines.count)

        for line in lines {
            let parts = line.split(whereSeparator: \.isWhitespace)
            guard parts.count == 4 else {
                throw Error.invalidKaldiData("Invalid segments line: \(line)")
            }

            let utteranceId = String(parts[0])
            guard let speakerId = utt2spk[utteranceId] else {
                throw Error.invalidKaldiData("utt2spk missing entry for \(utteranceId)")
            }
            guard let startTime = Double(parts[2]), let endTime = Double(parts[3]) else {
                throw Error.invalidKaldiData("Invalid segment timestamps for \(utteranceId)")
            }

            entries.append(
                SegmentEntry(
                    utteranceId: utteranceId,
                    recordingId: String(parts[1]),
                    speakerId: speakerId,
                    startTime: startTime,
                    endTime: endTime
                )
            )
        }

        return entries
    }

    private static func parseKeyValueFile(_ fileURL: URL) throws -> [String: String] {
        let lines = try String(contentsOf: fileURL, encoding: .utf8)
            .split(whereSeparator: \.isNewline)
        var result: [String: String] = [:]

        for line in lines {
            let parts = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
            guard parts.count == 2 else {
                throw Error.invalidKaldiData("Invalid key-value line in \(fileURL.lastPathComponent): \(line)")
            }
            result[String(parts[0])] = String(parts[1])
        }

        return result
    }

    private static func formatSeconds(_ value: Double) -> String {
        String(format: "%.6f", value)
    }
}
#endif
