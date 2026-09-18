#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$repo_root/scripts/configure_swift_environment.sh"
package_path="$repo_root/native/calendar-helper"
bundle_path="$repo_root/resources/bin/PlutoCalendarHelper.app"
executable_path="$bundle_path/Contents/MacOS/PlutoCalendarHelper"

swift build \
  --disable-sandbox \
  --sdk "${SDKROOT}" \
  -c release \
  --package-path "$package_path" \
  --product PlutoCalendarHelper
mkdir -p "$bundle_path/Contents/MacOS"
cp "$repo_root/resources/calendar-helper/Info.plist" "$bundle_path/Contents/Info.plist"
cp "$package_path/.build/release/PlutoCalendarHelper" "$executable_path"
chmod +x "$executable_path"
codesign --sign - --force --deep "$bundle_path"
