# Pluto

Electron + React + Vite desktop app with optional WhisperX transcription.

## Setup

Run **together**: one command starts the app; the app starts the Python WhisperX server automatically. You don't run the backend separately.

### 1. Node / Electron

```bash
npm install
```

### 2. Native modules (better-sqlite3, etc.)

The app uses native Node addons. They must be built for Electron's Node version, not your system Node.

**If you see** `NODE_MODULE_VERSION` / "compiled against a different Node.js version":

1. **Python for node-gyp** (needed to compile): If you use Python 3.12+, `distutils` was removed. Install setuptools so node-gyp works:
   ```bash
   pip3 install setuptools
   ```
   (Or use your venv's pip if you prefer.)

2. **Rebuild native modules for Electron:**
   ```bash
   npx @electron/rebuild
   ```

Then run the app again (`npm run dev`).

### 3. Backend (WhisperX, optional)

Only needed if you use transcription.

- **Python 3.10+**
- **ffmpeg** — required for loading/decoding audio. Install before using transcription:
  ```bash
  brew install ffmpeg
  ```
  (Linux: `apt install ffmpeg` / `dnf install ffmpeg`; Windows: [ffmpeg.org](https://ffmpeg.org/download.html) or `choco install ffmpeg`.)
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

### 4. Ollama (optional, local LLM)

Used for meeting titles, summaries, and entity extraction (people, topics, action items). Default provider in Pluto.

1. **Install:** [ollama.com](https://ollama.com) or `brew install ollama`
2. **Run the server** (if not already running as a service):
   ```bash
   ollama serve
   ```
3. **Pull a model** Pluto uses `llama3.2:3b` by default (light on M1/M2):
   ```bash
   ollama pull llama3.2:3b
   ```
   Other options: `phi3:mini`, `mistral:7b`, `llama3.1:8b`. You can switch to Gemini/OpenAI/Claude in **Settings** if you prefer.

### 5. Run

```bash
npm run dev
```

Backend runs inside the same process; no separate `python whisperx_server.py` needed.

**First run:** WhisperX can take 1–2 minutes to start (model load, font cache). If you see "WhisperX failed to start" but the server is still loading in the terminal, wait a minute and try transcription—it often works. Later runs are faster.

---

# React + TypeScript + Vite (template)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list
