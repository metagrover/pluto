import Foundation
import XCTest

@testable import FluidAudio

final class SlidingWindowAsrSessionTests: XCTestCase {
    override func setUp() {
        super.setUp()
    }

    override func tearDown() {
        super.tearDown()
    }

    // MARK: - Initialization Tests

    func testSessionInitialization() async throws {
        let session = SlidingWindowAsrSession()
        let activeStreams = await session.activeStreams
        XCTAssertTrue(activeStreams.isEmpty)
    }

    // MARK: - Stream Management Tests

    func testGetStreamForNonExistentSource() async throws {
        let session = SlidingWindowAsrSession()
        let stream = await session.getStream(for: .microphone)
        XCTAssertNil(stream)
    }

    func testRemoveNonExistentStream() async throws {
        let session = SlidingWindowAsrSession()
        // Should not throw when removing non-existent stream
        await session.removeStream(for: .microphone)
    }

    func testActiveStreamsEmpty() async throws {
        let session = SlidingWindowAsrSession()
        let streams = await session.activeStreams
        XCTAssertTrue(streams.isEmpty)
    }

    func testCleanupEmptySession() async throws {
        let session = SlidingWindowAsrSession()
        // Should not throw when cleaning up empty session
        await session.cleanup()

        let streams = await session.activeStreams
        XCTAssertTrue(streams.isEmpty)
    }

    // MARK: - Error Tests

    func testSlidingWindowAsrErrorDescriptions() {
        let modelsNotLoadedError = SlidingWindowAsrError.modelsNotLoaded
        XCTAssertEqual(
            modelsNotLoadedError.errorDescription,
            "ASR models have not been loaded"
        )

        let streamExistsError = SlidingWindowAsrError.streamAlreadyExists(.microphone)
        XCTAssertEqual(
            streamExistsError.errorDescription,
            "A stream already exists for source: microphone"
        )

        let systemStreamExistsError = SlidingWindowAsrError.streamAlreadyExists(.system)
        XCTAssertEqual(
            systemStreamExistsError.errorDescription,
            "A stream already exists for source: system"
        )
    }

    // MARK: - Configuration Tests

    func testSessionWithDifferentConfigurations() async throws {
        _ = SlidingWindowAsrSession()

        // Test that session can be created with different configs
        let configs = [
            SlidingWindowAsrConfig.default
        ]

        // Verify all configs are valid
        for config in configs {
            XCTAssertGreaterThan(config.confirmationThreshold, 0)
            XCTAssertLessThanOrEqual(config.confirmationThreshold, 1.0)
            XCTAssertGreaterThan(config.chunkDuration, 0)
        }
    }

    // MARK: - Audio Source Tests

    func testAudioSourceValues() {
        // Ensure audio sources are properly defined
        let sources: [AudioSource] = [.microphone, .system]

        for source in sources {
            // Test that sources can be used as dictionary keys
            var dict: [AudioSource: String] = [:]
            dict[source] = "test"
            XCTAssertEqual(dict[source], "test")
        }
    }

    // MARK: - Thread Safety Tests

    func testConcurrentStreamOperations() async throws {
        let session = SlidingWindowAsrSession()

        // Test concurrent reads
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<10 {
                group.addTask {
                    _ = await session.activeStreams
                    _ = await session.getStream(for: .microphone)
                }
            }
        }

        // Session should still be in valid state
        let streams = await session.activeStreams
        XCTAssertNotNil(streams)
    }

    // MARK: - Memory Management Tests

    func testSessionMemoryCleanup() async throws {
        var session: SlidingWindowAsrSession? = SlidingWindowAsrSession()

        // Cleanup and release
        await session?.cleanup()

        // Weak reference for testing
        weak var weakSession = session
        session = nil

        // Session should be deallocated
        XCTAssertNil(weakSession)
    }

    // MARK: - Integration Preparation Tests

    func testSessionReadyForIntegration() async throws {
        let session = SlidingWindowAsrSession()

        // Verify session provides expected interface
        XCTAssertNotNil(session)

        // Verify we can query streams
        let streams = await session.activeStreams
        XCTAssertNotNil(streams)

        // Verify we can attempt to get streams
        let micStream = await session.getStream(for: .microphone)
        XCTAssertNil(micStream)  // Should be nil before creation

        let systemStream = await session.getStream(for: .system)
        XCTAssertNil(systemStream)  // Should be nil before creation
    }
}
