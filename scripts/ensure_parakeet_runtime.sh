#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_PATH="${PROJECT_ROOT}/native/parakeet-runtime"
OUTPUT_DIRECTORY="${PROJECT_ROOT}/resources/bin"
OUTPUTS=(
  "${OUTPUT_DIRECTORY}/parakeet-runtime"
  "${OUTPUT_DIRECTORY}/parakeet-resource-probe"
)

runtime_is_current=true
for output in "${OUTPUTS[@]}"; do
  if [[ ! -x "${output}" || -L "${output}" ]]; then
    runtime_is_current=false
    break
  fi

  if ! codesign --verify --strict "${output}" >/dev/null 2>&1; then
    runtime_is_current=false
    break
  fi

  if find "${PACKAGE_PATH}" \
    \( -path "${PACKAGE_PATH}/.build" -o -path "${PACKAGE_PATH}/.swiftpm" \) -prune -o \
    -type f \( -name '*.swift' -o -name 'Package.swift' -o -name 'Package.resolved' \) \
    -newer "${output}" -print -quit | grep -q .; then
    runtime_is_current=false
    break
  fi
done

if [[ "${runtime_is_current}" == true ]]; then
  echo "Parakeet runtime is current; skipping native build."
  exit 0
fi

echo "Parakeet runtime is missing or stale; building it before launch."
exec "${SCRIPT_DIR}/build_parakeet.sh"
