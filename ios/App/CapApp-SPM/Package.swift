// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.1"),
        .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
        .package(name: "CapacitorAppLauncher", path: "../../../node_modules/@capacitor/app-launcher"),
        .package(name: "CapacitorBrowser", path: "../../../node_modules/@capacitor/browser"),
        .package(name: "CapacitorDevice", path: "../../../node_modules/@capacitor/device"),
        .package(name: "CapacitorHaptics", path: "../../../node_modules/@capacitor/haptics"),
        .package(name: "CapacitorPushNotifications", path: "../../../node_modules/@capacitor/push-notifications"),
        .package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share"),
        .package(name: "CapgoCapacitorUpdater", path: "../../../node_modules/@capgo/capacitor-updater"),
        // Transitive remote deps of CapgoCapacitorUpdater.
        // cap sync regenerates Package.swift without these — re-run this script if
        // it's overwritten. See: https://github.com/mieweb/timehuddle/pull/492
        .package(url: "https://github.com/Alamofire/Alamofire.git", .upToNextMajor(from: "5.12.0")),
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.20"),
        .package(url: "https://github.com/mrackwitz/Version.git", exact: "0.8.0"),
        .package(url: "https://github.com/attaswift/BigInt.git", from: "5.7.0"),
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorAppLauncher", package: "CapacitorAppLauncher"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorDevice", package: "CapacitorDevice"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapgoCapacitorUpdater", package: "CapgoCapacitorUpdater"),
                // Explicit links pull transitive deps into the build graph so
                // xcodebuild compiles them before CapgoCapacitorUpdater
                .product(name: "Alamofire", package: "Alamofire"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation"),
                .product(name: "Version", package: "Version"),
                .product(name: "BigInt", package: "BigInt"),
            ]
        )
    ]
)
