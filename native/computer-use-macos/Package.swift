// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "HelixComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "HelixComputerUseMacOSCore",
            targets: ["HelixComputerUseMacOSCore"]
        ),
        .executable(
            name: "helix-computer-use-macos",
            targets: ["HelixComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "HelixComputerUseMacOSCore",
            path: "Sources/HelixComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "HelixComputerUseMacOS",
            dependencies: ["HelixComputerUseMacOSCore"],
            path: "Sources/HelixComputerUseMacOS"
        ),
        .testTarget(
            name: "HelixComputerUseMacOSTests",
            dependencies: ["HelixComputerUseMacOSCore"],
            path: "Tests/HelixComputerUseMacOSTests"
        )
    ]
)
