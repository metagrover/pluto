#!/bin/bash

# Build the standalone transcription executable
# This script assumes 'setup_python.sh' has been run and venv exists.

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
PYTHON_DIR="$PROJECT_ROOT/python"
VENV_DIR="$PYTHON_DIR/venv"
RESOURCES_DIR="$PROJECT_ROOT/resources"
BIN_DIR="$RESOURCES_DIR/bin"

echo "Building local transcription server executable..."

# Activate Virtual Env
if [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
else
    echo "Error: Virtual environment not found. Run 'pnpm run setup-python' first."
    exit 1
fi

PYINSTALLER_BIN="$VENV_DIR/bin/pyinstaller"
if [ ! -x "$PYINSTALLER_BIN" ]; then
    echo "PyInstaller not found in venv. Installing..."
    "$VENV_DIR/bin/pip" install pyinstaller
fi

# Clean previous build
rm -rf "$PYTHON_DIR/build"
rm -rf "$PYTHON_DIR/dist"

# Build with PyInstaller
# We run from python/ dir so relative paths in spec work
cd "$PYTHON_DIR"
export OMP_NUM_THREADS=1
"$PYINSTALLER_BIN" whisperx_server.spec

# Move output to resources/bin
echo "Moving executable to resources/bin..."
mkdir -p "$BIN_DIR"

# Check if it was a one-dir or one-file build
# Spec file says 'COLLECT' so it's a directory build (folder named whisperx_server)
if [ -d "dist/whisperx_server" ]; then
    rm -rf "$BIN_DIR/whisperx_server"
    cp -r "dist/whisperx_server" "$BIN_DIR/"
    echo "Build successful: $BIN_DIR/whisperx_server"
else
    echo "Error: Build artifact not found in dist/whisperx_server"
    exit 1
fi

echo "Python build complete."
