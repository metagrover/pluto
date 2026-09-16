#!/usr/bin/env bash
set -euo pipefail

# Pluto Universal macOS Installer & Updater
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/metagrover/pluto/main/scripts/install.sh | bash
#
# Environment variables:
#   PLUTO_VERSION="0.2.0"     # Install a specific version instead of latest
#   PLUTO_NO_LAUNCH=1         # Do not automatically launch Pluto after install

REPO="metagrover/pluto"
APP_TARGET="/Applications/Pluto.app"

echo "🪐 Pluto Installer & Updater"
echo "============================="

# 1. Platform & architecture check
OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" != "Darwin" ]]; then
  echo "❌ Error: Pluto currently only supports macOS."
  exit 1
fi

if [[ "$ARCH" != "arm64" ]]; then
  echo "⚠️  Warning: Pluto is currently optimized for Apple Silicon (arm64)."
  echo "    Running on $ARCH may require Rosetta 2 or an x64 release."
fi

# 2. Resolve version to install
if [[ -n "${PLUTO_VERSION:-}" ]]; then
  TAG="v${PLUTO_VERSION#v}"
  echo "📌 Target version specified: ${TAG}"
else
  echo "🔍 Checking for latest release from GitHub..."
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
  RELEASE_JSON="$(curl -fsSL "$API_URL" 2>/dev/null || true)"

  if [[ -z "$RELEASE_JSON" ]]; then
    echo "❌ Error: Could not reach GitHub Releases API (${API_URL})."
    echo "   Check your internet connection or GitHub rate limits."
    exit 1
  fi

  TAG="$(echo "$RELEASE_JSON" | grep '"tag_name":' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ -z "$TAG" ]]; then
    echo "❌ Error: Could not find a published release tag on ${REPO}."
    exit 1
  fi
  echo "🚀 Found latest release: ${TAG}"
fi

VERSION="${TAG#v}"

# 3. Locate DMG download URL
DMG_NAME="Pluto-Mac-${VERSION}-Installer.dmg"
DMG_URL="https://github.com/${REPO}/releases/download/${TAG}/${DMG_NAME}"

# Fallback: check if standard naming was used
if ! curl --output /dev/null --silent --head --fail "$DMG_URL" 2>/dev/null; then
  # Try alternative naming Pluto-${VERSION}-arm64.dmg or extract from release JSON
  ALT_URL="https://github.com/${REPO}/releases/download/${TAG}/Pluto-${VERSION}-arm64.dmg"
  if curl --output /dev/null --silent --head --fail "$ALT_URL" 2>/dev/null; then
    DMG_URL="$ALT_URL"
  fi
fi

# 4. Download DMG
TMP_DIR="$(mktemp -d /tmp/pluto-installer.XXXXXX)"
cleanup() {
  if [[ -n "${MOUNT_DIR:-}" && -d "${MOUNT_DIR:-}" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

DMG_FILE="${TMP_DIR}/Pluto.dmg"
MOUNT_DIR="${TMP_DIR}/mount"

echo "⬇️  Downloading Pluto ${TAG}..."
if ! curl -fL --progress-bar "$DMG_URL" -o "$DMG_FILE"; then
  echo "❌ Error: Failed to download installer from ${DMG_URL}"
  exit 1
fi

# 5. Gracefully close running Pluto instance
if pgrep -x "Pluto" > /dev/null 2>&1; then
  echo "⏸️  Closing running Pluto instance..."
  osascript -e 'quit app "Pluto"' 2>/dev/null || pkill -x "Pluto" 2>/dev/null || true
  sleep 1
fi

# 6. Mount DMG silently
echo "📦 Mounting installer image..."
mkdir -p "$MOUNT_DIR"
hdiutil attach "$DMG_FILE" -mountpoint "$MOUNT_DIR" -nobrowse -quiet

if [[ ! -d "${MOUNT_DIR}/Pluto.app" ]]; then
  echo "❌ Error: Pluto.app was not found in the mounted disk image."
  exit 1
fi

# 7. Replace application bundle cleanly
echo "🔄 Installing to ${APP_TARGET}..."
rm -rf "$APP_TARGET"
cp -R "${MOUNT_DIR}/Pluto.app" /Applications/

# Detach DMG
hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true

# 8. Strip quarantine attribute to bypass Gatekeeper on unsigned builds
echo "🛡️  Clearing Gatekeeper quarantine flags..."
xattr -cr "$APP_TARGET" 2>/dev/null || true

echo "✅ Pluto ${TAG} installed successfully!"

# 9. Launch application
if [[ "${PLUTO_NO_LAUNCH:-0}" != "1" ]]; then
  echo "✨ Launching Pluto..."
  open "$APP_TARGET"
fi
