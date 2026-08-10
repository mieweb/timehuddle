#!/usr/bin/env python3
"""
Patches ios/App/CapApp-SPM/Package.swift to include transitive remote SPM
dependencies of CapgoCapacitorUpdater (Alamofire, BigInt, ZIPFoundation, Version).

Run after `npx cap sync ios` because cap sync regenerates Package.swift without
these transitive deps, causing xcodebuild to fail with
"Unable to find module dependency: 'BigInt'" (and Alamofire, Version, ZIPFoundation).

Root cause: Xcode's build planner does not follow remote-dependency chains
through nested local-path packages. Declaring them at the CapApp-SPM level
makes them explicit build-graph nodes so they compile before CapgoCapacitorUpdater.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent
PACKAGE_SWIFT = ROOT / "ios" / "App" / "CapApp-SPM" / "Package.swift"

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


def main() -> int:
    content = PACKAGE_SWIFT.read_text()

    if "Alamofire" in content:
        print("Package.swift already patched — nothing to do.")
        return 0

    # Insert extra packages after the CapgoCapacitorUpdater .package(...) line.
    # cap sync writes it as the last array item (no trailing comma), so we also
    # add the comma before inserting.
    new_content = re.sub(
        r'(\.package\(name: "CapgoCapacitorUpdater"[^\n]+?)(\))\n',
        lambda m: m.group(1) + m.group(2) + ",\n" + EXTRA_PACKAGES + "\n",
        content,
        count=1,
    )
    if new_content == content:
        print("ERROR: Could not find CapgoCapacitorUpdater package line in Package.swift.", file=sys.stderr)
        return 1

    # Insert extra products after the CapgoCapacitorUpdater .product(...) line in
    # the target (also the last item without a trailing comma in cap sync output).
    new_content = re.sub(
        r'(\.product\(name: "CapgoCapacitorUpdater"[^\n]+?)(\))\n',
        lambda m: m.group(1) + m.group(2) + ",\n" + EXTRA_PRODUCTS + "\n",
        new_content,
        count=1,
    )

    PACKAGE_SWIFT.write_text(new_content)
    print(f"Patched {PACKAGE_SWIFT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
