# Portability Guide for Pluto

To run Pluto on a new machine, you need to ensure Python 3.10+ is installed and configured correctly.

## Prerequisites

1.  **Python 3.10+**: Ensure Python is installed and available in your system PATH as `python3` or `python`.
2.  **FFmpeg**: Required for audio conversion.

## Setup Instructions

Once you have cloned the repository or received a build, run the following command to install the required Python dependencies:

```bash
# From the project root
pip install -r python/requirements.txt
```

## Running the App

The app will dynamically detect your Python installation. If you have multiple Python versions or a custom setup, you can specify the Python path using an environment variable:

```bash
PLUTO_PYTHON_PATH=/path/to/your/python ./Pluto
```

## Troubleshooting

- **Audio issues**: Ensure `ffmpeg` is installed.
- **Transcription issues**: Verify that `whisperx` is installed in the selected Python environment.
