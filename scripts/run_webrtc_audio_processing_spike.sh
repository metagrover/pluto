#!/usr/bin/env bash
set -euo pipefail

readonly REVISION="846fe90a289f58b7c9303a635142aa2c7caa93e5"
readonly SPIKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pluto-webrtc-apm.XXXXXX")"
trap 'rm -rf "$SPIKE_ROOT"' EXIT

python3 -m pip install --quiet --target "$SPIKE_ROOT/tooling" meson ninja
git clone --quiet --filter=blob:none https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing.git "$SPIKE_ROOT/source"
git -C "$SPIKE_ROOT/source" checkout --quiet --detach "$REVISION"
test "$(git -C "$SPIKE_ROOT/source" rev-parse HEAD)" = "$REVISION"

PATH="$SPIKE_ROOT/tooling/bin:$PATH" PYTHONPATH="$SPIKE_ROOT/tooling" python3 "$SPIKE_ROOT/tooling/bin/meson" setup "$SPIKE_ROOT/build" "$SPIKE_ROOT/source" --buildtype=release
PATH="$SPIKE_ROOT/tooling/bin:$PATH" PYTHONPATH="$SPIKE_ROOT/tooling" python3 "$SPIKE_ROOT/tooling/bin/meson" compile -C "$SPIKE_ROOT/build"

readonly SOURCE_ROOT="$SPIKE_ROOT/source"
readonly LIBRARY_ROOT="$SPIKE_ROOT/build/webrtc/modules/audio_processing"
c++ -std=c++17 -I"$SOURCE_ROOT/webrtc" -I"$SOURCE_ROOT/subprojects/abseil-cpp-20240722.0" native/aec-spike/webrtc_apm_spike.cc -L"$LIBRARY_ROOT" -lwebrtc-audio-processing-2.1 -Wl,-rpath,"$LIBRARY_ROOT" -framework Security -o "$SPIKE_ROOT/webrtc_apm_spike"
"$SPIKE_ROOT/webrtc_apm_spike"

