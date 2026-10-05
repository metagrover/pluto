#!/bin/bash
# Compatibility entry point. Installation and updates share the verified installer.
set -euo pipefail
main() {
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/pluto-installer.XXXXXX")
  trap 'rm -rf "$scratch"' EXIT
  curl --fail --location --retry 3 --connect-timeout 30 --proto '=https' --proto-redir '=https' \
    https://raw.githubusercontent.com/metagrover/pluto/master/scripts/install-macos.sh -o "$scratch/install.sh"
  if [[ -n ${PLUTO_VERSION:-} ]]; then set -- --tag "v${PLUTO_VERSION#v}" "$@"; fi
  /bin/bash "$scratch/install.sh" "$@"
}
main "$@"
