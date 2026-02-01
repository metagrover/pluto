# Pluto

Electron + React + Vite desktop app with optional WhisperX transcription.

## Setup

Run **together**: one command starts the app; the app starts the Python WhisperX server automatically. You don’t run the backend separately.

### 1. Node / Electron

```bash
npm install
```

### 2. Native modules (better-sqlite3, etc.)

The app uses native Node addons. They must be built for Electron’s Node version, not your system Node.

**If you see** `NODE_MODULE_VERSION` / “compiled against a different Node.js version”:

1. **Python for node-gyp** (needed to compile): If you use Python 3.12+, `distutils` was removed. Install setuptools so node-gyp works:
   ```bash
   pip3 install setuptools
   ```
   (Or use your venv’s pip if you prefer.)

2. **Rebuild native modules for Electron:**
   ```bash
   npx @electron/rebuild
   ```

Then run the app again (`npm run dev`).

### 3. Backend (WhisperX, optional)

Only needed if you use transcription.

- **Python 3.10+** and **ffmpeg** (e.g. `brew install ffmpeg` on macOS).
- From repo root:

```bash
cd python
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

So the app finds WhisperX, either:

- **Option A:** Activate the venv before starting the app:
  ```bash
  source python/.venv/bin/activate
  npm run dev
  ```
- **Option B:** Set the interpreter path (no need to activate each time):
  ```bash
  export PLUTO_PYTHON_PATH="<path-to-repo>/python/.venv/bin/python"
  npm run dev
  ```

**Speaker diarization:** Create a [Hugging Face](https://huggingface.co) account, accept the pyannote model licenses ([segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0), [speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)), create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens). The app will prompt for it when needed.

### 4. Run

```bash
npm run dev
```

Backend runs inside the same process; no separate `python whisperx_server.py` needed.

**First run:** WhisperX can take 1–2 minutes to start (model load, font cache). If you see “WhisperX failed to start” but the server is still loading in the terminal, wait a minute and try transcription—it often works. Later runs are faster.

---

# React + TypeScript + Vite (template)

Intelligent meeting assistant and "second brain" application.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Python** (v3.9+ recommended)
    - *Note: You do NOT need to install Python libraries globally. The project handles this for you.*
- **FFmpeg** (`brew install ffmpeg` on macOS)

### Installation (for Contributors)

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-org/pluto.git
    cd pluto
    ```

2.  **Install Dependencies**
    This will install Node packages AND set up a local Python virtual environment automatically.
    ```bash
    npm install
    ```

3.  **Run the App**
    ```bash
    npm run dev
    ```

## 📦 Building for Production

To create a DMG installer that includes the bundled Python environment (no client-side setup required):

```bash
npm run build
```

The output DMG will be in `release/`.

## 🛠 Project Structure

- `src/` - React/Electron source code
- `python/` - Python server (WhisperX) and requirements
- `scripts/` - Build and setup automation scripts
- `resources/` - Assets and bundled binaries
