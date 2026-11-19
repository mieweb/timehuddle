#!/usr/bin/env bash
# check-native-sync.sh — Fail if the native projects don't match the Capacitor
# plugins in package.json, i.e. someone added or removed a plugin without
# re-syncing Android and iOS (#823).
#
# Usage:
#   npm run build                    # cap sync copies dist/, so build first
#   ./scripts/check-native-sync.sh   # static check, then the sync check
#   ./scripts/check-native-sync.sh --static   # static check only (no cap sync)
#
# 1. Static check (reads files only; no build, no cap sync):
#    - every Capacitor plugin in package.json has its entries in the three
#      generated files below, and they list no plugin package.json doesn't have;
#    - a plugin installed from a vendored tarball (`file:vendor/*.tgz`) is read
#      from that tarball, and package-lock.json records the tarball as it is now;
#    - a plugin whose Package.swift downloads remote binary targets (PulseKit's
#      xcframeworks from its GitHub Release, for @mieweb/capacitor-pulse) is
#      pinned exactly, has real checksums (not the unreleased 0.0.0-dev
#      placeholder's zeros) and downloads from its own version's release
#      (scripts/patch-ios-spm.py's binary_target_problems).
# 2. Sync check: regenerates the native plugin files the way a developer would
#    (`npx cap sync` + the iOS SPM patch) and fails if any committed file
#    changed. `npx cap update` would skip the web copy, but on a fresh checkout
#    it fails writing android/app/src/main/assets/capacitor.plugins.json, which
#    only exists after a copy. It needs dist/ from `npm run build`; without it
#    the sync check is skipped locally and fails in CI.

set -euo pipefail

cd "$(dirname "$0")/.."

GENERATED_FILES=(
  android/capacitor.settings.gradle
  android/app/capacitor.build.gradle
  ios/App/CapApp-SPM/Package.swift
)
FIX_COMMAND='npx cap sync && python3 scripts/patch-ios-spm.py'

MODE=full
case "${1:-}" in
  '') ;;
  --static) MODE=static ;;
  *)
    echo "Usage: $0 [--static]" >&2
    exit 2
    ;;
esac

# ── 1. Static check ─────────────────────────────────────────────────────────
if ! python3 -I -B - <<'PY'; then
import base64
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import tarfile

spec = importlib.util.spec_from_file_location("patch_ios_spm", "scripts/patch-ios-spm.py")
patch_ios_spm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch_ios_spm)

package = json.loads(pathlib.Path("package.json").read_text())
lock = json.loads(pathlib.Path("package-lock.json").read_text())
package_swift = pathlib.Path("ios/App/CapApp-SPM/Package.swift").read_text()
settings_gradle = pathlib.Path("android/capacitor.settings.gradle").read_text()
build_gradle = pathlib.Path("android/app/capacitor.build.gradle").read_text()

EXACT_VERSION = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")


def fix_name(package_id: str) -> str:
    """The iOS package name Capacitor CLI gives a plugin (fixName in its plugin.ts)."""
    name = package_id.replace("/", "_").replace("-", "_").replace("@", "")
    name = re.sub(r"_\w", lambda m: m.group(0)[1].upper(), name)
    return name[:1].upper() + name[1:]


def gradle_name(package_id: str) -> str:
    """The Gradle project name Capacitor CLI gives a plugin (getGradlePackageName)."""
    return package_id.replace("@", "", 1).replace("/", "-", 1)


def tarball_reader(path: pathlib.Path):
    def read(member: str):
        with tarfile.open(path, "r:gz") as tar:
            try:
                handle = tar.extractfile(f"package/{member}")
            except KeyError:
                return None
            return handle.read().decode() if handle else None

    return read


def folder_reader(path: pathlib.Path):
    def read(member: str):
        file = path / member
        return file.read_text() if file.is_file() else None

    return read


problems: list[str] = []
versions: dict[str, str] = {}
ios_names: set[str] = set()
gradle_names: set[str] = set()

dependencies = {**package.get("devDependencies", {}), **package.get("dependencies", {})}
for package_id, wanted in dependencies.items():
    if wanted.startswith("file:") and wanted.endswith((".tgz", ".tar.gz")):
        tarball = pathlib.Path(wanted[len("file:") :])
        if not tarball.is_file():
            problems.append(f"{package_id}: {tarball} doesn't exist")
            continue
        read = tarball_reader(tarball)
        locked = lock.get("packages", {}).get(f"node_modules/{package_id}", {})
        integrity = "sha512-" + base64.b64encode(hashlib.sha512(tarball.read_bytes()).digest()).decode()
        if locked.get("resolved") != wanted or locked.get("integrity") != integrity:
            problems.append(
                f"{package_id}: package-lock.json doesn't record {tarball} as it is now; run "
                "'npm install --package-lock-only --ignore-scripts' and commit the lockfile"
            )
    else:
        installed = pathlib.Path("node_modules", package_id)
        if not (installed / "package.json").is_file():
            problems.append(f"{package_id}: not installed in node_modules (run npm ci)")
            continue
        read = folder_reader(installed)

    meta = json.loads(read("package.json") or "{}")
    versions[package_id] = meta.get("version", "")
    capacitor = meta.get("capacitor")
    if not isinstance(capacitor, dict):
        continue  # not a Capacitor plugin (Cordova plugins are left to the sync check)

    if capacitor.get("ios"):
        name = fix_name(package_id)
        ios_names.add(name)
        package_line = re.compile(
            r'\.package\(name: "' + re.escape(name) + r'", path: "[^"]*/node_modules/'
            + re.escape(package_id) + r'"'
        )
        if not package_line.search(package_swift):
            problems.append(f"{package_id}: no .package(name: \"{name}\", ...) in CapApp-SPM/Package.swift")
        if f'.product(name: "{name}", package: "{name}")' not in package_swift:
            problems.append(f"{package_id}: no .product(name: \"{name}\", ...) in CapApp-SPM/Package.swift")
        manifest = read("Package.swift")
        if manifest is None:
            problems.append(f"{package_id}: has no Package.swift, so SwiftPM can't use it")
        elif patch_ios_spm.BINARY_TARGET_URL_RE.search(manifest):
            if not (wanted.startswith("file:") or EXACT_VERSION.match(wanted)):
                problems.append(
                    f"{package_id}: downloads remote binary targets, so pin an exact version "
                    f"(package.json has \"{wanted}\")"
                )
            problems.extend(
                patch_ios_spm.binary_target_problems(package_id, manifest, meta.get("version"))
            )

    if capacitor.get("android"):
        name = gradle_name(package_id)
        gradle_names.add(name)
        source = capacitor["android"].get("src") or "android"
        project_dir = f"project(':{name}').projectDir = new File('../node_modules/{package_id}/{source}')"
        if f"include ':{name}'" not in settings_gradle or project_dir not in settings_gradle:
            problems.append(f"{package_id}: no include ':{name}' with its projectDir in capacitor.settings.gradle")
        if f"implementation project(':{name}')" not in build_gradle:
            problems.append(f"{package_id}: no implementation project(':{name}') in capacitor.build.gradle")

for name, _path in patch_ios_spm.LOCAL_PACKAGE_RE.findall(package_swift):
    if name not in ios_names:
        problems.append(f"CapApp-SPM/Package.swift lists {name}, which package.json doesn't have")
for name in sorted(set(re.findall(r"include ':([^']+)'", settings_gradle)) - {"capacitor-android"}):
    if name not in gradle_names:
        problems.append(f"capacitor.settings.gradle includes :{name}, which package.json doesn't have")
for name in sorted(set(re.findall(r"implementation project\(':([^']+)'\)", build_gradle))):
    if name not in gradle_names:
        problems.append(f"capacitor.build.gradle depends on :{name}, which package.json doesn't have")

# The client and the plugin are released together; different versions work only while the
# contract's major matches, so this is a warning.
client, plugin = versions.get("@mieweb/pulse-embed"), versions.get("@mieweb/capacitor-pulse")
if client and plugin and client != plugin:
    print(
        f"warning: @mieweb/pulse-embed is {client} but @mieweb/capacitor-pulse is {plugin}; "
        "they are released together, so pin the same version",
        file=sys.stderr,
    )

if problems:
    for problem in problems:
        print(f"  {problem}", file=sys.stderr)
    sys.exit(1)
print(
    f"Static check: {len(ios_names)} iOS and {len(gradle_names)} Android Capacitor plugins in "
    "package.json match the generated native files."
)
PY
  echo "" >&2
  echo "Error: the native projects don't match the Capacitor plugins in package.json (above)." >&2
  echo "Fix each line above. For a plugin missing from (or left in) the generated files, run" >&2
  echo "'npm run build && $FIX_COMMAND' and commit the changes." >&2
  exit 1
fi

if [[ "$MODE" == static ]]; then
  exit 0
fi

# ── 2. Sync check ───────────────────────────────────────────────────────────
if [[ ! -f dist/index.html ]]; then
  if [[ -n "${CI:-}" ]]; then
    echo "Error: dist/index.html not found. Run 'npm run build' first — npx cap sync copies it." >&2
    exit 1
  fi
  echo "Skipped the sync check: dist/index.html not found. Run 'npm run build' first for it."
  exit 0
fi

npx cap sync
python3 scripts/patch-ios-spm.py

if git diff --quiet -- "${GENERATED_FILES[@]}"; then
  echo "Native projects match the Capacitor plugins in package.json."
  exit 0
fi

echo "" >&2
echo "Error: the native projects are out of sync with the Capacitor plugins in package.json." >&2
echo "These generated files changed after a sync:" >&2
git diff --name-only -- "${GENERATED_FILES[@]}" | sed 's/^/  /' >&2
echo "" >&2
git diff -- "${GENERATED_FILES[@]}" >&2
echo "" >&2
echo "Fix: run '$FIX_COMMAND' and commit the changes." >&2
exit 1
