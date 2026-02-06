import Foundation
import ScreenCaptureKit
import AVFoundation

// CLI Arguments:
// 1: Output File Path (Optional - if provided, writes to file, else stdout)
// 2: Exclude Bundle ID (Optional - app to exclude from capture)

let args = CommandLine.arguments

// Parse arguments
let outputPath = args.count > 1 ? args[1] : nil
// Defaults to excluding Electron if not specified, but best to pass it
let excludeBundleId = args.count > 2 ? args[2] : "com.github.electron"

let recorder = AudioRecorder()

// Keep run loop alive
let runLoop = RunLoop.current

Task {
    do {
        // checks
        // checks
        if await AudioRecorder.checkPermissions() == false {
             // Continue anyway to try and trigger prompt, but warn
             print("{\"error\": \"permission_check_failed_but_trying\"}")
        }

        try await recorder.start(outputPath: outputPath, excludeBundleId: excludeBundleId) 
        
        // Output JSON status for Electron to know we started
        print("{\"status\": \"started\"}")
        fflush(stdout)
        
    } catch {
        print("{\"error\": \"\(error.localizedDescription)\"}")
        exit(1)
    }
}

// Handle SIGINT/SIGTERM to stop cleanly
signal(SIGINT) { _ in
    Task {
        await recorder.stop()
        exit(0)
    }
}
signal(SIGTERM) { _ in
    Task {
        await recorder.stop()
        exit(0)
    }
}

runLoop.run()
