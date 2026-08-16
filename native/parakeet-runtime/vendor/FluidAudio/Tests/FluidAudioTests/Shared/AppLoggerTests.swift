import XCTest

@testable import FluidAudio

final class AppLoggerTests: XCTestCase {
    override func tearDown() {
        AppLogger.setProcessLogging(.disabled)
        super.tearDown()
    }

    func testProcessLoggingIsDisabledByDefault() {
        XCTAssertEqual(AppLogger.processLoggingMode, .disabled)
    }

    func testProcessLoggingModeIsThreadSafe() async {
        await withTaskGroup(of: Void.self) { group in
            for index in 0..<100 {
                group.addTask {
                    AppLogger.setProcessLogging(index.isMultiple(of: 2) ? .enabled : .disabled)
                    _ = AppLogger.processLoggingMode
                }
            }
        }

        AppLogger.setProcessLogging(.disabled)
        XCTAssertEqual(AppLogger.processLoggingMode, .disabled)
    }
}
