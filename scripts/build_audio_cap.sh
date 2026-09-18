#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/configure_swift_environment.sh"

mkdir -p "${PROJECT_ROOT}/resources/bin"
swiftc "${PROJECT_ROOT}"/resources/swift/audiocap/*.swift \
  -o "${PROJECT_ROOT}/resources/bin/audiocap" \
  -framework CoreAudio \
  -framework AudioToolbox \
  -framework AVFoundation
