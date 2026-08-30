// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PlutoCalendarHelper",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "CalendarBridgeCore", targets: ["CalendarBridgeCore"]),
        .executable(name: "PlutoCalendarHelper", targets: ["PlutoCalendarHelper"]),
    ],
    targets: [
        .target(name: "CalendarBridgeCore"),
        .executableTarget(
            name: "PlutoCalendarHelper",
            dependencies: ["CalendarBridgeCore"]
        ),
        .testTarget(
            name: "CalendarBridgeCoreTests",
            dependencies: ["CalendarBridgeCore"]
        ),
    ]
)
