# Pluto

Intelligent meeting assistant and "second brain" application.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v25.6+)
- **pnpm** (enable via `corepack enable` or install directly)
- **Python** (v3.9+ recommended)
    - *Note: You do NOT need to install Python libraries globally. The project handles this for you.*
- **FFmpeg** (`brew install ffmpeg` on macOS)
- **macOS only:** Xcode Command Line Tools (`xcode-select --install`) for Swift builds

### Installation (for Contributors)

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-org/pluto.git
    cd pluto
    ```

2.  **Install Dependencies**
    This will install Node packages AND set up a local Python virtual environment automatically.
    ```bash
    pnpm install
    ```

3.  **Build native audio tools (macOS)**
    This builds the Swift binaries used for microphone + system audio capture.
    ```bash
    pnpm run build-native
    ```

4.  **Run the App**
    ```bash
    pnpm run dev
    ```

### macOS Permissions

Pluto requires:
- **Microphone** access
- **System Audio Recording Only** (Privacy & Security → Screen & System Audio Recording)

If permissions change, macOS requires a full app restart.

## 📦 Building for Production

To create a DMG installer that includes the bundled Python environment (no client-side setup required):

```bash
pnpm run build
```

The output DMG will be in `release/`.

## 🛠 Project Structure

- `src/` - React/Electron source code
- `python/` - Python server (WhisperX) and requirements
- `scripts/` - Build and setup automation scripts
- `resources/` - Assets and bundled binaries (built by `pnpm run build-native`)
