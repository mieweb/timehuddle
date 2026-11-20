#!/usr/bin/env python3
"""
Patches ios/App/CapApp-SPM/Package.swift after `npx cap sync ios`, which regenerates it.

1. CapgoCapacitorUpdater's transitive remote SPM dependencies (Alamofire, BigInt, ZIPFoundation,
   Version) are declared at the CapApp-SPM level. Without them xcodebuild fails with
   "Unable to find module dependency: 'BigInt'" (and Alamofire, Version, ZIPFoundation): Xcode's
   build planner does not follow remote-dependency chains through nested local-path packages, so
   declaring them here makes them explicit build-graph nodes that compile before
   CapgoCapacitorUpdater. They are appended at the end of both dependency lists, so the patch
   works wherever cap sync puts CapgoCapacitorUpdater. (It used to assume CapgoCapacitorUpdater
   was the last plugin; @mieweb/capacitor-pulse now sorts after it.)

2. Remote binary targets: @mieweb/capacitor-pulse declares PulseKit's xcframeworks as
   `.binaryTarget(url:checksum:)` downloads from PulseKit's GitHub Release. Those are the plugin
   package's own artifacts, not package dependencies, so nothing is hoisted into CapApp-SPM for
   them. The patch checks that they can resolve, so a bad pin fails here rather than deep inside
   xcodebuild: every checksum is a real SHA-256 (the plugin's unreleased 0.0.0-dev manifest has
   all-zero placeholders), and the release they download from is the plugin's own version.

Usage:
    npx cap sync ios && python3 scripts/patch-ios-spm.py

check-native-sync.sh imports `binary_target_problems` from this file.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent
SPM_DIR = ROOT / "ios" / "App" / "CapApp-SPM"
PACKAGE_SWIFT = SPM_DIR / "Package.swift"

EXTRA_PACKAGES = """\
        // Transitive remote deps of CapgoCapacitorUpdater.
        // cap sync regenerates Package.swift without these — re-run this script if
        // it's overwritten. See: https://github.com/mieweb/timehuddle/pull/492
        .package(url: "https://github.com/Alamofire/Alamofire.git", .upToNextMajor(from: "5.12.0")),
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.20"),
        .package(url: "https://github.com/mrackwitz/Version.git", exact: "0.8.0"),
        .package(url: "https://github.com/attaswift/BigInt.git", from: "5.7.0"),"""

EXTRA_PRODUCTS = """\
                // Explicit links pull transitive deps into the build graph so
                // xcodebuild compiles them before CapgoCapacitorUpdater
                .product(name: "Alamofire", package: "Alamofire"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation"),
                .product(name: "Version", package: "Version"),
                .product(name: "BigInt", package: "BigInt"),"""

# Where CapApp-SPM's package dependency list and its target's dependency list end, exactly as
# Capacitor CLI 8 writes them (generatePackageText in @capacitor/cli's util/spm).
DEPENDENCIES_END = "\n    ],\n    targets: ["
PRODUCTS_END = "\n            ]\n        )\n    ]\n)"

LOCAL_PACKAGE_RE = re.compile(r'\.package\(name: "([^"]+)", path: "([^"]+)"')
BINARY_TARGET_URL_RE = re.compile(r"\.binaryTarget\([^)]*\burl:", re.S)
CHECKSUM_RE = re.compile(r'"([0-9a-fA-F]{64})"')
RELEASE_DOWNLOAD_RE = re.compile(r'/releases/download/[^"/]*?v(\d+\.\d+\.\d+[^"/]*)"')
RELEASE_VERSION_RE = re.compile(r'\blet releaseVersion = "([^"]+)"')


def binary_target_problems(label: str, manifest: str, version: str | None) -> list[str]:
    """
    What would stop a package's remote binary targets from resolving: no checksums, all-zero
    placeholder checksums, or a release that is not the package's own version. Empty when the
    manifest declares no remote binary targets.
    """
    if not BINARY_TARGET_URL_RE.search(manifest):
        return []
    problems: list[str] = []
    checksums = CHECKSUM_RE.findall(manifest)
    if not checksums:
        problems.append(f"{label}: remote binary targets but no SHA-256 checksums in Package.swift")
    zero = [c for c in checksums if set(c) == {"0"}]
    if zero:
        problems.append(
            f"{label}: {len(zero)} binary target checksum(s) are the all-zero placeholder, so "
            "SwiftPM can't resolve them. Pin a released package: its Package.swift names the "
            "release's URLs and checksums."
        )
    released = set(RELEASE_DOWNLOAD_RE.findall(manifest)) | set(RELEASE_VERSION_RE.findall(manifest))
    if version and released and released != {version}:
        problems.append(
            f"{label}: Package.swift downloads from release {', '.join(sorted(released))} but the "
            f"package is {version}. The binary targets must come from the package's own release."
        )
    return problems


def check_binary_targets(content: str) -> int:
    """Checks the remote binary targets of every local plugin package CapApp-SPM lists."""
    problems: list[str] = []
    for name, rel in LOCAL_PACKAGE_RE.findall(content):
        package_dir = (SPM_DIR / rel).resolve()
        manifest_path = package_dir / "Package.swift"
        if not manifest_path.is_file():
            # Not installed (or a Cordova plugin's generated package); xcodebuild reports it.
            print(f"note: {name}: no Package.swift at {rel}; its binary targets weren't checked")
            continue
        version = None
        package_json = package_dir / "package.json"
        if package_json.is_file():
            version = json.loads(package_json.read_text()).get("version")
        problems.extend(binary_target_problems(name, manifest_path.read_text(), version))
    for problem in problems:
        print(f"ERROR: {problem}", file=sys.stderr)
    return 1 if problems else 0


def append_to_list(content: str, list_end: str, items: str, what: str) -> str | None:
    """Inserts `items` as the last entries of the list that `list_end` closes."""
    index = content.find(list_end)
    if index < 0:
        print(f"ERROR: Could not find the end of the {what} list in Package.swift.", file=sys.stderr)
        return None
    head = content[:index].rstrip()
    # cap sync writes the last item without a trailing comma.
    if not head.endswith((",", "[")):
        head += ","
    return head + "\n" + items + content[index:]


def patch(content: str) -> str | None:
    """The patched Package.swift, or None (after printing why) when it can't be patched."""
    if '.package(name: "CapgoCapacitorUpdater"' not in content:
        print(
            "ERROR: Could not find CapgoCapacitorUpdater package line in Package.swift.",
            file=sys.stderr,
        )
        return None
    patched = append_to_list(content, DEPENDENCIES_END, EXTRA_PACKAGES, "package dependencies")
    if patched is None:
        return None
    return append_to_list(patched, PRODUCTS_END, EXTRA_PRODUCTS, "CapApp-SPM target dependencies")


def main() -> int:
    content = PACKAGE_SWIFT.read_text()

    if "Alamofire" in content:
        print("Package.swift already patched — nothing to do.")
    else:
        patched = patch(content)
        if patched is None:
            return 1
        PACKAGE_SWIFT.write_text(patched)
        content = patched
        print(f"Patched {PACKAGE_SWIFT.relative_to(ROOT)}")

    return check_binary_targets(content)


if __name__ == "__main__":
    sys.exit(main())
