#!/bin/bash

# Setup Python Environment for Pluto

set -e

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
PYTHON_DIR="$PROJECT_ROOT/python"
VENV_DIR="$PYTHON_DIR/venv"

echo "Setup Python Environment..."

# Function to check if a command exists
command_exists () {
    type "$1" &> /dev/null ;
}

# Check for pyenv and install Python 3.10
if command -v pyenv &> /dev/null; then
    echo "Using pyenv..."
    if ! pyenv versions | grep -q "3.10"; then
        echo "Installing Python 3.10..."
        pyenv install 3.10.13 || echo "Warning: pyenv install failed. Attempting to use existing python."
    fi
    pyenv local 3.10.13 || echo "Warning: pyenv local failed."
    PYTHON_CMD=$(pyenv which python 2>/dev/null || true)
else
    echo "pyenv not found. Looking for system python..."
fi

# Fallback/Primary detection if pyenv didn't yield a specific python
if [ -z "$PYTHON_CMD" ]; then
    if [ -x "/usr/bin/python3" ]; then
        PYTHON_CMD="/usr/bin/python3"
        echo "Using System Python: $PYTHON_CMD"
    elif command_exists python3.11; then
        PYTHON_CMD="python3.11"
    elif command_exists python3; then
        PYTHON_CMD="python3"
    else
        echo "Error: Python 3 not found. Please install Python 3.9+ (3.11 recommended)."
        exit 1
    fi
fi

PYTHON_VERSION=$($PYTHON_CMD -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "Found Python version: $PYTHON_VERSION"

# Parse version into Major and Minor
IFS='.' read -r -a VERSION_PARTS <<< "$PYTHON_VERSION"
PYTHON_MAJOR=${VERSION_PARTS[0]}
PYTHON_MINOR=${VERSION_PARTS[1]}

echo "Parsed Version: Major=$PYTHON_MAJOR, Minor=$PYTHON_MINOR"

# Check if version is < 3.9
if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 9 ]); then
    echo "Error: Python 3.9+ is required. Found $PYTHON_VERSION"
    exit 1
fi

# Avoid 3.13+ if possible
if [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -ge 13 ]; then
    echo "Warning: Python $PYTHON_VERSION is very new and might not be supported by all ML libraries."
    echo "Attempting to find an older version..."
    if [ -x "/usr/bin/python3" ]; then
        SYS_PY_VER=$(/usr/bin/python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
        IFS='.' read -r -a SYS_PARTS <<< "$SYS_PY_VER"
        if [ "${SYS_PARTS[0]}" -eq 3 ] && [ "${SYS_PARTS[1]}" -ge 9 ] && [ "${SYS_PARTS[1]}" -lt 13 ]; then
            echo "Falling back to /usr/bin/python3 ($SYS_PY_VER) for better compatibility."
            PYTHON_CMD="/usr/bin/python3"
        fi
    fi
fi

# 2. Create Virtual Environment if not exists or broken
if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "Creating virtual environment in $VENV_DIR..."
    rm -rf "$VENV_DIR" # Clean up potentially broken dir
    $PYTHON_CMD -m venv "$VENV_DIR"
else
    echo "Virtual environment already exists and appears valid."
fi

# 3. Install Requirements
echo "Installing/Updating requirements..."
source "$VENV_DIR/bin/activate"
PIP_CONSTRAINT_FILE="$PYTHON_DIR/constraints.txt"
if [ -f "$PIP_CONSTRAINT_FILE" ]; then
    export PIP_CONSTRAINT="$PIP_CONSTRAINT_FILE"
fi
pip install --upgrade pip "setuptools<82" wheel

if [ -f "$PYTHON_DIR/requirements.txt" ]; then
    pip install -r "$PYTHON_DIR/requirements.txt"
else
    echo "Warning: requirements.txt not found!"
fi

echo "Python setup complete."
