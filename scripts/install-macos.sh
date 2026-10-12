#!/bin/bash
# Streamed installers must be parsed completely before any action runs.
set -euo pipefail
main() {
  progress() {
    [[ -z ${PLUTO_UPDATE_PROGRESS:-} ]] || { printf '%s\n' "$1" > "$PLUTO_UPDATE_PROGRESS.tmp"; mv "$PLUTO_UPDATE_PROGRESS.tmp" "$PLUTO_UPDATE_PROGRESS"; }
  }
  fail() {
    printf 'Pluto: %s\n' "$*" >&2
    [[ -z ${PLUTO_UPDATE_ERROR:-} ]] || printf '%s\n' "$*" > "$PLUTO_UPDATE_ERROR"
    exit 1
  }
  require_compatible_upgrade() {
    local previous=$1 candidate=$2 value index
    local old_parts=() new_parts=()
    for value in "$previous" "$candidate"; do
      value=${value/.rc./-rc.}
      [[ $value =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-rc\.([0-9]+))?$ ]] || fail 'Cannot verify the installed version. Nothing was replaced.'
      local parts=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" 1 0)
      if [[ -n ${BASH_REMATCH[4]} ]]; then parts[3]=0; parts[4]=${BASH_REMATCH[5]}; fi
      if [[ ${#old_parts[@]} == 0 ]]; then old_parts=("${parts[@]}"); else new_parts=("${parts[@]}"); fi
    done
    for index in 0 1 2 3 4; do
      (( 10#${new_parts[index]} > 10#${old_parts[index]} )) && return
      (( 10#${new_parts[index]} < 10#${old_parts[index]} )) && fail 'Refusing to install an older Pluto build over a newer one. Existing app and data were preserved.'
    done
    return 0
  }
  require_pluto_closed() {
    local pid command physical_applications
    physical_applications=$(cd "$applications" 2>/dev/null && pwd -P) || physical_applications=$applications
    for pid in $(pgrep -x Pluto || true); do
      command=$(ps -ww -p "$pid" -o args=) || continue
      [[ "$command" == "$applications/Pluto.app/Contents/MacOS/Pluto" || "$command" == "$applications/Pluto.app/Contents/MacOS/Pluto "* || "$command" == "$physical_applications/Pluto.app/Contents/MacOS/Pluto" || "$command" == "$physical_applications/Pluto.app/Contents/MacOS/Pluto "* ]] || continue
      # ChatGPT runs the bundled bridge using Pluto's executable as Node.
      case "$command" in
        */Contents/MacOS/Pluto\ */Contents/Resources/mcp/pluto-mcp-bridge.mjs\ --connection\ *) continue ;;
      esac
      fail 'Quit Pluto before upgrading, then run this command again.'
    done
  }
  applications=/Applications
  verify_only=false
  fresh_profile=false
  user_data_dir=''
  requested_tag=''
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tag) [[ $# -ge 2 ]] || fail 'Missing release tag.'; requested_tag=$2; shift 2 ;;
      --verify-only) verify_only=true; shift ;;
      --fresh-profile) fresh_profile=true; shift ;;
      --user-data-dir) [[ $# -ge 2 && $2 == /* ]] || fail 'An absolute user-data directory is required.'; user_data_dir=$2; shift 2 ;;
      --directory) [[ $# -ge 2 ]] || fail 'Missing installation directory.'; applications=$2; shift 2 ;;
      *) fail "Unknown option: $1" ;;
    esac
  done
  if "$fresh_profile" && [[ -n $user_data_dir ]]; then fail 'A fresh profile cannot replace the selected update profile.'; fi
  [[ -z $requested_tag || $requested_tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+|\.rc\.[0-9]+)?$ ]] || fail 'Invalid release tag.'
  [[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || fail 'An Apple Silicon Mac is required. Run Terminal without Rosetta.'
  os_version=$(sw_vers -productVersion)
  os_major=${os_version%%.*}
  os_minor=${os_version#*.}; os_minor=${os_minor%%.*}
  (( os_major > 14 || (os_major == 14 && os_minor >= 2) )) || fail 'macOS 14.2 or later is required.'
  if ! "$verify_only"; then
    [[ -n ${PLUTO_UPDATE_PARENT_PID:-} ]] || require_pluto_closed
    if [[ $applications == /Applications && ! -w $applications && ! -e $applications/Pluto.app ]]; then applications="$HOME/Applications"; fi
    mkdir -p "$applications"
    [[ -w $applications ]] || fail "Cannot write to $applications. Use --directory with a writable Applications folder."
  fi
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/pluto-install.XXXXXX")
  staging=''; installed=false; mounted=false
  cleanup() {
    if "$mounted"; then hdiutil detach "$scratch/mount" -quiet || hdiutil detach "$scratch/mount" -force -quiet || true; fi
    if [[ -n $staging ]]; then
      if ! "$installed" && [[ -d $staging/previous.app ]]; then
        mv "$staging/previous.app" "$applications/Pluto.app" || { printf 'Previous app preserved at %s\n' "$staging/previous.app" >&2; return; }
      fi
      rm -rf "$staging"
    fi
    rm -rf "$scratch"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  progress downloading
  printf 'Downloading Pluto from its GitHub release.\nRunning this installer trusts the unnotarized app and removes only Pluto’s quarantine.\n'
  download() { curl --fail --location --retry 3 --retry-max-time 600 --connect-timeout 30 --max-time 600 --proto '=https' --proto-redir '=https' "$1" -o "$2"; }
  # The public list includes RCs; /releases/latest excludes them.
  public=false
  if curl --fail --silent --show-error --location --retry 3 --retry-max-time 600 --connect-timeout 30 --max-time 600 --proto '=https' --proto-redir '=https' \
    'https://api.github.com/repos/metagrover/pluto/releases?per_page=1' -o "$scratch/releases.json" 2>"$scratch/api-error"; then
    public=true
    tag=$(plutil -extract 0.tag_name raw -o - "$scratch/releases.json")
  else
    command -v gh >/dev/null || fail 'Releases are not publicly accessible yet. GitHub CLI with repository access is required during private testing.'
    tag=$(gh release list --repo metagrover/pluto --exclude-drafts --limit 1 --json tagName --jq '.[0].tagName')
  fi
  tag=${requested_tag:-$tag}
  [[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+|\.rc\.[0-9]+)?$ ]] || fail 'No supported published release found.'
  version=${tag#v}; version=${version/.rc./-rc.}
  filename="Pluto-Mac-${version}-Installer.dmg"
  if "$public"; then
    base="https://github.com/metagrover/pluto/releases/download/$tag"
    download "$base/SHA256SUMS.txt" "$scratch/SHA256SUMS.txt"
    download "$base/$filename" "$scratch/$filename"
  else
    gh release download "$tag" --repo metagrover/pluto --dir "$scratch" --pattern "$filename" --pattern SHA256SUMS.txt
  fi
  progress verifying
  expected=$(awk -v name="$filename" '$2 == name { print $1 }' "$scratch/SHA256SUMS.txt")
  [[ $expected =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Missing or ambiguous installer checksum.'
  actual=$(shasum -a 256 "$scratch/$filename"); actual=${actual%% *}
  [[ $actual == "$expected" ]] || fail 'Installer checksum mismatch. Nothing was installed.'
  hdiutil attach "$scratch/$filename" -readonly -nobrowse -mountpoint "$scratch/mount" -quiet
  mounted=true
  app="$scratch/mount/Pluto.app"
  [[ $(plutil -extract CFBundleIdentifier raw -o - "$app/Contents/Info.plist") == com.pluto.app ]] || fail 'Unexpected app identity.'
  [[ $(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist") == "$version" ]] || fail 'App version does not match the release.'
  codesign --verify --deep --strict "$app"
  if "$verify_only"; then
    printf 'Verified Pluto %s checksum, identity, version, and signature. Nothing was installed or launched.\n' "$version"
    exit 0
  fi
  destination="$applications/Pluto.app"
  previous_requirement=''
  [[ ! -L $destination ]] || fail 'The installation destination is a symbolic link.'
  if [[ -e $destination ]]; then
    [[ $(plutil -extract CFBundleIdentifier raw -o - "$destination/Contents/Info.plist") == com.pluto.app ]] || fail 'The destination contains a different app.'
    require_compatible_upgrade "$(plutil -extract CFBundleShortVersionString raw -o - "$destination/Contents/Info.plist")" "$version"
    previous_requirement=$(codesign -dr - "$destination" 2>&1 | sed -n 's/^# designated => //p')
  fi
  staging=$(mktemp -d "$applications/.pluto-install.XXXXXX")
  ditto "$app" "$staging/Pluto.app"
  codesign --verify --deep --strict "$staging/Pluto.app"
  xattr -dr com.apple.quarantine "$staging/Pluto.app"
  if [[ -n ${PLUTO_UPDATE_PARENT_PID:-} ]]; then
    [[ $PLUTO_UPDATE_PARENT_PID =~ ^[1-9][0-9]*$ && -n ${PLUTO_UPDATE_COMMIT:-} ]] || fail 'Invalid update handoff.'
    progress ready
    for ((attempt=0; attempt<30; attempt++)); do
      [[ ! -e ${PLUTO_UPDATE_CANCEL:-/nonexistent} ]] || fail 'Update cancelled before installation. Nothing was replaced.'
      [[ ! -e $PLUTO_UPDATE_COMMIT ]] || break
      kill -0 "$PLUTO_UPDATE_PARENT_PID" 2>/dev/null || fail 'Pluto exited before approving installation. Nothing was replaced.'
      sleep 1
    done
    [[ -e $PLUTO_UPDATE_COMMIT ]] || fail 'Pluto did not approve installation. Nothing was replaced.'
    progress quitting
    for ((attempt=0; attempt<15; attempt++)); do
      kill -0 "$PLUTO_UPDATE_PARENT_PID" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$PLUTO_UPDATE_PARENT_PID" 2>/dev/null && fail 'Pluto could not close for the update. Nothing was replaced. Finish saving your recording, then retry.'
  fi
  require_pluto_closed
  progress installing
  if [[ -e $destination ]]; then mv "$destination" "$staging/previous.app"; fi
  mv "$staging/Pluto.app" "$destination"
  installed=true
  printf 'Installed Pluto %s at %s. Existing meetings, settings, and models are preserved.\n' "$version" "$destination"
  requirement=$(codesign -dr - "$destination" 2>&1 | sed -n 's/^# designated => //p')
  if "$fresh_profile" || [[ -n $previous_requirement && $requirement == cdhash* && $requirement != "$previous_requirement" ]]; then
    printf 'Resetting only Pluto’s old macOS permission decisions so this build can request access directly.\n'
    tccutil reset All com.pluto.app || fail 'Could not reset Pluto permissions. Your app and data are preserved; reset Pluto permissions before launching.'
    tccutil reset All com.pluto.app.calendar-helper || printf 'Calendar helper permissions could not be reset automatically.\n' >&2
  fi
  progress restarting
  if [[ -n ${PLUTO_UPDATE_TARGET:-} ]]; then printf '%s\n' "$version" > "$PLUTO_UPDATE_TARGET"; fi
  if "$fresh_profile"; then
    mkdir -p "$HOME/Library/Application Support"
    profile=$(mktemp -d "$HOME/Library/Application Support/pluto-first-run.XXXXXX")
    printf 'Launching first-run onboarding with a separate empty profile: %s\nYour normal profile is preserved.\n' "$profile"
    open -na "$destination" --args "--user-data-dir=$profile" || fail "Pluto $version was installed, but could not reopen. Open Pluto from its installation folder."
  else
    profile=${user_data_dir:-$HOME/Library/Application Support/pluto}
    open -na "$destination" --args "--user-data-dir=$profile" || fail "Pluto $version was installed, but could not reopen. Open Pluto from its installation folder."
  fi
}
main "$@"
