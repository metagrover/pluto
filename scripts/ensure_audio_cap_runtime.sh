#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIRECTORY="${PROJECT_ROOT}/resources/swift/audiocap"
OUTPUT_DIRECTORY="${PROJECT_ROOT}/resources/bin"
OUTPUT_PATH="${OUTPUT_DIRECTORY}/audiocap"

if [[ -x "${OUTPUT_PATH}" && ! -L "${OUTPUT_PATH}" ]] && \
  codesign --verify --strict "${OUTPUT_PATH}" >/dev/null 2>&1 && \
  ! find "${SOURCE_DIRECTORY}" -type f -name '*.swift' -newer "${OUTPUT_PATH}" -print -quit | grep -q .; then
  echo "Audio capture runtime is current; skipping native build."
  exit 0
fi

echo "Audio capture runtime is missing or stale; building it before launch."
mkdir -p "${OUTPUT_DIRECTORY}"
swiftc "${SOURCE_DIRECTORY}"/*.swift \
  -o "${OUTPUT_PATH}" \
  -framework CoreAudio \
  -framework AudioToolbox \
  -framework AVFoundation
codesign --sign - --force "${OUTPUT_PATH}"
