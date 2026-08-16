// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ParakeetRuntime",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ParakeetRuntimeCore", targets: ["ParakeetRuntimeCore"]),
        .executable(name: "parakeet-runtime", targets: ["ParakeetRuntime"]),
        .executable(name: "parakeet-resource-probe", targets: ["ParakeetResourceProbe"]),
    ],
    dependencies: [
        .package(path: "vendor/FluidAudio"),
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
        .executableTarget(
            name: "ParakeetResourceProbe",
            dependencies: ["ParakeetRuntimeCore"]
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
