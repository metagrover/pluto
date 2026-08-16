#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_PATH="${PROJECT_ROOT}/native/parakeet-runtime"
OUTPUT_DIRECTORY="${PROJECT_ROOT}/resources/bin"

swift build --package-path "${PACKAGE_PATH}" --configuration release --product parakeet-runtime
swift build --package-path "${PACKAGE_PATH}" --configuration release --product parakeet-resource-probe
SWIFT_BIN_DIRECTORY="$(swift build --package-path "${PACKAGE_PATH}" --configuration release --show-bin-path)"

if [[ -z "${SWIFT_BIN_DIRECTORY}" || "${SWIFT_BIN_DIRECTORY}" != "${PACKAGE_PATH}/.build/"* ]]; then
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
