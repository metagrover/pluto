#!/usr/bin/env bash

# This file is sourced by native build scripts. Some Command Line Tools updates
# temporarily leave MacOSX.sdk pointing at an SDK produced by a different Swift
# compiler build. Select the newest installed SDK that the active compiler can
# actually import instead of failing later with an opaque SwiftShims error.

if [[ -n "${PLUTO_SWIFT_ENVIRONMENT_READY:-}" ]]; then
  return 0
fi

export PLUTO_SWIFT_ENVIRONMENT_READY=1

swift_cache_root="${TMPDIR:-/private/tmp}/pluto-swift-module-cache"
mkdir -p "${swift_cache_root}"
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-${swift_cache_root}}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-${swift_cache_root}}"

swift_sdk_is_usable() {
  local candidate="$1"
  printf 'import Foundation\n' | env SDKROOT="${candidate}" \
    swiftc -typecheck -module-cache-path "${CLANG_MODULE_CACHE_PATH}" - \
    >/dev/null 2>&1
}

if [[ -n "${SDKROOT:-}" ]]; then
  if ! swift_sdk_is_usable "${SDKROOT}"; then
    echo "Configured SDKROOT is incompatible with the active Swift compiler: ${SDKROOT}" >&2
    return 1
  fi
  return 0
fi

default_sdk="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
if [[ -n "${default_sdk}" ]] && swift_sdk_is_usable "${default_sdk}"; then
  export SDKROOT="${default_sdk}"
  return 0
fi

while IFS= read -r candidate; do
  [[ -d "${candidate}" ]] || continue
  [[ "${candidate}" == "${default_sdk}" ]] && continue
  if swift_sdk_is_usable "${candidate}"; then
    export SDKROOT="${candidate}"
    echo "Default macOS SDK is incompatible; using ${SDKROOT}." >&2
    return 0
  fi
done < <(
  find /Library/Developer/CommandLineTools/SDKs /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs \
    -maxdepth 1 -type d -name 'MacOSX*.sdk' 2>/dev/null | sort -Vr
)

echo "No installed macOS SDK is compatible with $(swiftc --version | head -n 1)." >&2
echo "Reinstall or update Xcode Command Line Tools, then retry." >&2
return 1
