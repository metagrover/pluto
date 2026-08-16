import XCTest

@testable import FluidAudio

final class LSEENDQueueTests: XCTestCase {

    func testStreamingChunkQueueRequiresExactMinimumElementsForFirstChunk() {
        var queue = StreamingChunkQueue(
            chunkLength: 8,
            leftContextLength: 3,
            rightContextLength: 2,
            stride: 1
        )

        XCTAssertFalse(queue.hasChunk)
        XCTAssertEqual(queue.readyChunks, 0)

        queue.append(repeatElement(1, count: 9))
        XCTAssertFalse(queue.hasChunk)
        XCTAssertEqual(queue.readyChunks, 0)

        queue.append([1])
        XCTAssertTrue(queue.hasChunk)
        XCTAssertEqual(queue.readyChunks, 1)

        let firstChunk = queue.popNextChunk()
        XCTAssertEqual(firstChunk.map(Array.init), [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
        XCTAssertEqual(queue.readyChunks, 0)
    }

    func testPopAllChunksConsumesOnlyWholeChunksAndPreservesTrailingContext() {
        var queue = StreamingChunkQueue(
            chunkLength: 4,
            leftContextLength: 2,
            rightContextLength: 1,
            stride: 1
        )

        queue.append(Array(1...10).map(Float.init))

        let combined = queue.popAllChunks()
        XCTAssertEqual(combined.map(Array.init), [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
        XCTAssertEqual(queue.readyChunks, 0)

        queue.append([11, 12, 13])
        let nextChunk = queue.popNextChunk()
        XCTAssertEqual(nextChunk.map(Array.init), [7, 8, 9, 10, 11, 12, 13])
    }
}
