import AVFoundation
import Foundation
import ParakeetRuntimeCore
@testable import ParakeetRuntimeEngine
import XCTest

private actor FakeFluidEouBackend: FluidAudioEouBackend {
    private var partial: (@Sendable (String) -> Void)?
    private var eou: (@Sendable (String) -> Void)?
    private var partialTranscripts: [String]
    private let emitsEou: Bool
    private(set) var observedFormat: (Double, AVAudioChannelCount, AVAudioFrameCount)?
    private(set) var cleanedUp = false

    init(
        partialTranscripts: [String] = ["hello"],
        emitsEou: Bool = true
    ) {
        self.partialTranscripts = partialTranscripts
        self.emitsEou = emitsEou
    }

    func setPartialCallback(_ callback: @escaping @Sendable (String) -> Void) {
        partial = callback
    }

    func setEouCallback(_ callback: @escaping @Sendable (String) -> Void) {
        eou = callback
    }

    func process(audioBuffer: sending AVAudioPCMBuffer) async throws -> String {
        observedFormat = (
            audioBuffer.format.sampleRate,
            audioBuffer.format.channelCount,
            audioBuffer.frameLength
        )
        let transcript = partialTranscripts.isEmpty
            ? "hello"
            : partialTranscripts.removeFirst()
        partial?(transcript)
        if emitsEou { eou?(transcript) }
        return ""
    }

    func finish() async throws -> String { "hello final" }
    func getTokenTimestampsMs() async -> [Int] { [100] }
    func getRawTokenStrings() async -> [String] { ["hello"] }
    func getEouTimestampsMs() async -> [Int] { [320] }
    func cleanup() async { cleanedUp = true }
}

final class FluidAudioEouAdapterTests: XCTestCase {
    func testAppendPreservesDeclaredPcmFormatAndReturnsOrderedCallbacks() async throws {
        let backend = FakeFluidEouBackend()
        let manager = await FluidAudioEouManager(backend: backend)
        let samples = [Float](repeating: 0.25, count: 15_360)
        let frame = try EouPcmFrame(
            sampleRate: 48_000,
            channelCount: 1,
            frameCount: samples.count,
            audioStartSeconds: 0,
            audioEndSeconds: 0.32,
            pcmData: samples.withUnsafeBytes { Data($0) }
        )

        let snapshots = try await manager.append(frame)

        XCTAssertEqual(snapshots.map(\.kind), [.partial, .eou])
        XCTAssertEqual(snapshots.last?.tokens.first?.text, "hello")
        let observed = await backend.observedFormat
        XCTAssertEqual(observed?.0, 48_000)
        XCTAssertEqual(observed?.1, 1)
        XCTAssertEqual(observed?.2, 15_360)
    }

    func testFinishCommitsTailAndCleansModels() async throws {
        let backend = FakeFluidEouBackend()
        let manager = await FluidAudioEouManager(backend: backend)

        let snapshots = try await manager.finish()

        XCTAssertEqual(snapshots.last?.kind, .final)
        XCTAssertEqual(snapshots.last?.transcript, "hello final")
        let cleanedUp = await backend.cleanedUp
        XCTAssertTrue(cleanedUp)
    }

    func testBoundsAProvisionalRunWhenTheModelDoesNotEmitEou() async throws {
        let backend = FakeFluidEouBackend(
            partialTranscripts: ["one", "one two", "one two three", "one two three four"],
            emitsEou: false
        )
        let manager = await FluidAudioEouManager(
            backend: backend,
            maxPendingSeconds: 0.5
        )
        let samples = [Float](repeating: 0.25, count: 15_360)
        func frame(start: Double) throws -> EouPcmFrame {
            try EouPcmFrame(
                sampleRate: 48_000,
                channelCount: 1,
                frameCount: samples.count,
                audioStartSeconds: start,
                audioEndSeconds: start + 0.32,
                pcmData: samples.withUnsafeBytes { Data($0) }
            )
        }

        let first = try await manager.append(frame(start: 0))
        let second = try await manager.append(frame(start: 0.32))
        let bounded = try await manager.append(frame(start: 0.64))
        let next = try await manager.append(frame(start: 0.96))

        XCTAssertEqual(first.map(\.kind), [.partial])
        XCTAssertEqual(second.map(\.kind), [.partial])
        XCTAssertEqual(bounded.map(\.kind), [.eou])
        XCTAssertEqual(bounded.last?.transcript, "one two three")
        XCTAssertEqual(next.map(\.kind), [.partial])
        XCTAssertEqual(next.last?.transcript, "one two three four")
    }
}
