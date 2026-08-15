// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ParakeetRuntime",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ParakeetRuntimeCore", targets: ["ParakeetRuntimeCore"]),
    ],
    targets: [
        .target(name: "ParakeetRuntimeCore"),
        .testTarget(
            name: "ParakeetRuntimeCoreTests",
            dependencies: ["ParakeetRuntimeCore"]
        ),
    ]
)
