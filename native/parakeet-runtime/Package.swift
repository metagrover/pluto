// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ParakeetRuntime",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ParakeetRuntimeCore", targets: ["ParakeetRuntimeCore"]),
        .executable(name: "parakeet-runtime", targets: ["ParakeetRuntime"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git",
            exact: "0.15.5"
        ),
    ],
    targets: [
        .target(name: "ParakeetRuntimeCore"),
        .target(
            name: "ParakeetRuntimeEngine",
            dependencies: [
                "ParakeetRuntimeCore",
                .product(name: "FluidAudio", package: "FluidAudio"),
            ]
        ),
        .executableTarget(
            name: "ParakeetRuntime",
            dependencies: ["ParakeetRuntimeCore", "ParakeetRuntimeEngine"]
        ),
        .testTarget(
            name: "ParakeetRuntimeCoreTests",
            dependencies: ["ParakeetRuntimeCore"]
        ),
        .testTarget(
            name: "ParakeetRuntimeEngineTests",
            dependencies: ["ParakeetRuntimeCore", "ParakeetRuntimeEngine"]
        ),
    ]
)
