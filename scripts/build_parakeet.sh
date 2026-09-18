#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/configure_swift_environment.sh"
PACKAGE_PATH="${PROJECT_ROOT}/native/parakeet-runtime"
BUILD_PATH="${PACKAGE_PATH}/.build"
OUTPUT_DIRECTORY="${PROJECT_ROOT}/resources/bin"

SWIFT_BUILD_OPTIONS=(
  --disable-sandbox
  --sdk "${SDKROOT}"
  --package-path "${PACKAGE_PATH}"
  --scratch-path "${BUILD_PATH}"
  --configuration release
)

swift build "${SWIFT_BUILD_OPTIONS[@]}" --product parakeet-runtime
swift build "${SWIFT_BUILD_OPTIONS[@]}" --product parakeet-resource-probe
SWIFT_BIN_OUTPUT="$(swift build "${SWIFT_BUILD_OPTIONS[@]}" --show-bin-path)"
if ! SWIFT_BIN_DIRECTORY="$(node "${SCRIPT_DIR}/lib/swift_bin_path.mjs" "${BUILD_PATH}" <<<"${SWIFT_BIN_OUTPUT}")"; then
  echo "Unexpected Swift output directory" >&2
  exit 1
fi

SOURCE_BINARY="${SWIFT_BIN_DIRECTORY}/parakeet-runtime"
PROBE_BINARY="${SWIFT_BIN_DIRECTORY}/parakeet-resource-probe"
if [[ ! -f "${SOURCE_BINARY}" || -L "${SOURCE_BINARY}" ]]; then
  echo "Parakeet runtime binary was not produced" >&2
  exit 1
fi
if [[ ! -f "${PROBE_BINARY}" || -L "${PROBE_BINARY}" ]]; then
  echo "Parakeet resource probe binary was not produced" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIRECTORY}"
install -m 0755 "${SOURCE_BINARY}" "${OUTPUT_DIRECTORY}/parakeet-runtime"
install -m 0755 "${PROBE_BINARY}" "${OUTPUT_DIRECTORY}/parakeet-resource-probe"
codesign --sign - --force "${OUTPUT_DIRECTORY}/parakeet-runtime"
codesign --sign - --force "${OUTPUT_DIRECTORY}/parakeet-resource-probe"
