#!/bin/bash
# Streamed installers must be parsed completely before any action runs.
set -euo pipefail
main() {
  fail() { printf 'Pluto: %s\n' "$*" >&2; exit 1; }
  applications=/Applications
  verify_only=false
  fresh_profile=false
  requested_tag=''
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tag) [[ $# -ge 2 ]] || fail 'Missing release tag.'; requested_tag=$2; shift 2 ;;
      --verify-only) verify_only=true; shift ;;
      --fresh-profile) fresh_profile=true; shift ;;
      --directory) [[ $# -ge 2 ]] || fail 'Missing installation directory.'; applications=$2; shift 2 ;;
      *) fail "Unknown option: $1" ;;
    esac
  done
  [[ -z $requested_tag || $requested_tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+|\.rc\.[0-9]+)?$ ]] || fail 'Invalid release tag.'
  [[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || fail 'An Apple Silicon Mac is required. Run Terminal without Rosetta.'
  os_version=$(sw_vers -productVersion)
  os_major=${os_version%%.*}
  os_minor=${os_version#*.}; os_minor=${os_minor%%.*}
  (( os_major > 14 || (os_major == 14 && os_minor >= 2) )) || fail 'macOS 14.2 or later is required.'
  if ! "$verify_only"; then
    ! pgrep -x Pluto >/dev/null || fail 'Quit Pluto before upgrading, then run this command again.'
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
  printf 'Downloading Pluto from its GitHub release.\nRunning this installer trusts the unnotarized app and removes only Pluto’s quarantine.\n'
  download() { curl --fail --location --retry 3 --connect-timeout 30 --proto '=https' --proto-redir '=https' "$1" -o "$2"; }
  # The public list includes RCs; /releases/latest excludes them.
  public=false
  if curl --fail --silent --show-error --location --retry 3 --connect-timeout 30 --proto '=https' --proto-redir '=https' \
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
    previous_requirement=$(codesign -dr - "$destination" 2>&1 | sed -n 's/^# designated => //p')
  fi
  staging=$(mktemp -d "$applications/.pluto-install.XXXXXX")
  ditto "$app" "$staging/Pluto.app"
  codesign --verify --deep --strict "$staging/Pluto.app"
  xattr -dr com.apple.quarantine "$staging/Pluto.app"
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
  if "$fresh_profile"; then
    mkdir -p "$HOME/Library/Application Support"
    profile=$(mktemp -d "$HOME/Library/Application Support/pluto-first-run.XXXXXX")
    printf 'Launching first-run onboarding with a separate empty profile: %s\nYour normal profile is preserved.\n' "$profile"
    open -na "$destination" --args "--user-data-dir=$profile"
  else
    open "$destination"
  fi
}
main "$@"
